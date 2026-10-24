import type { Character, CombatLine, SaveFile } from './engine/types';
import { dayKey, daysBetween, gameRules, toRoman } from './engine/rules';
import { emptySave } from './engine/save';
import { buildStartingCharacter, validateName } from './engine/creation';
import { progressResidents } from './engine/pvp';
import { createRng } from './engine/rng';
import { titleForLevel } from './content/strings';
import { itemById } from './content/items';
import * as flow from './flow';
import type { Screen, SlotSummary } from './wire';

/**
 * THE AUTHORITY.
 *
 * This module owns every rule. The browser holds no game code at all — it
 * sends a keypress and receives a rendered screen. Everything here runs on
 * Node, which is the whole point: turns, dice, gold and death are decided
 * somewhere the player cannot edit.
 *
 * The engine and flow layers are imported unchanged. They were already pure
 * functions over plain data, so "make it authoritative" is a matter of running
 * them on the other side of a socket, not rewriting them.
 */

const DIGITS = '123456789';

export interface StoredSession {
  token: string;
  save: SaveFile;
  view: flowView;
  /** Residents' last progression day, mirrored for the realm tick. */
  lastSeen: number;
}

/** The screens a player can be on. Mirrors flow's View kinds. */
export type flowView =
  | { kind: 'title' }
  | { kind: 'create'; step: 'name' | 'sex' | 'class' }
  | { kind: 'hub' }
  | { kind: 'forest'; phase: 'encounter-prompt'; encounterId: string }
  | { kind: 'shop'; tab: 'weapon' | 'armor' }
  | { kind: 'bank' }
  | { kind: 'healer' }
  | { kind: 'inn' }
  | { kind: 'pvp' }
  | { kind: 'dragon' }
  | { kind: 'character' }
  | { kind: 'who' }
  | { kind: 'hall' };

/**
 * A realm lives on the server. One node, one realm, several characters —
 * which is now genuinely enforced rather than merely assumed.
 */
export class Realm {
  private sessions = new Map<string, StoredSession>();
  private byName = new Map<string, string>();
  private residents: ReturnType<typeof emptySave>['residents'];
  private hall: SaveFile['hallOfFame'] = [];
  private feed: SaveFile['realmFeed'] = [];

  constructor(seed?: { residents?: ReturnType<typeof emptySave>['residents'] }) {
    this.residents = seed?.residents ?? emptySave(buildStartingCharacter({
      name: 'Placeholder',
      sex: 'm',
      cls: 'warrior',
    })).residents;
  }

  /* ---- slots --------------------------------------------------- */

  slots(): SlotSummary[] {
    return [...this.sessions.values()]
      /* Only characters actually created. The placeholder a session carries
         before its player names someone must never appear as a slot. */
      .filter(({ save }) => this.byName.has(save.character.name.trim().toLowerCase()))
      .map(({ save }) => save.character)
      .sort((a, b) => {
        if (a.retired !== b.retired) return a.retired ? 1 : -1;
        return b.xp - a.xp;
      })
      .map((c) => ({
        name: c.name,
        className: c.class,
        level: c.level,
        levelRoman: toRoman(c.level),
        title: titleForLevel(c.level, c.isWyrmbane),
        retired: c.retired,
        turnsRemaining: c.turnsRemaining,
      }));
  }

  /** Does a name already exist in this realm? Residents count. */
  nameTaken(name: string): boolean {
    const key = name.trim().toLowerCase();
    if (this.byName.has(key)) return true;
    return this.residents.some((r) => r.character.name.trim().toLowerCase() === key);
  }

  /* ---- session lifecycle --------------------------------------- */

  newSession(token: string): StoredSession {
    const session: StoredSession = {
      token,
      /* The save is a placeholder until the player names a character. It is
         never surfaced and never persisted as a character. */
      save: emptySave(
        buildStartingCharacter({ name: 'Unnamed', sex: 'm', cls: 'warrior' }),
      ),
      view: { kind: 'title' },
      lastSeen: Date.now(),
    };
    session.save.residents = this.residents;
    session.save.hallOfFame = this.hall;
    session.save.realmFeed = this.feed;
    this.sessions.set(token, session);
    return session;
  }

  get(token: string): StoredSession | undefined {
    return this.sessions.get(token);
  }

  attach(token: string, save: SaveFile): StoredSession {
    const session: StoredSession = {
      token,
      save,
      view: save.character.retired ? { kind: 'hall' } : { kind: 'hub' },
      lastSeen: Date.now(),
    };
    this.sessions.set(token, session);
    this.byName.set(save.character.name.trim().toLowerCase(), token);
    return session;
  }

  /* ---- resident progression ------------------------------------ */

  /** Residents spend their turns while the player is away. Server-side. */
  private tickResidents(session: StoredSession, now: number): void {
    const base = session.save;
    const today = dayKey(now);
    if (base.residentsProgressedDay === today) return;

    const missed = Math.max(
      1,
      Math.min(gameRules.realm.maxCatchUpDays, daysBetween(base.residentsProgressedDay, today)),
    );

    const { residents } = progressResidents(
      createRng(),
      base.residents,
      base.character.level,
      missed,
    );
    /* One realm-wide resident roster, not one copy per character. */
    this.residents = residents;
    for (const s of this.sessions.values()) {
      s.save = { ...s.save, residents, residentsProgressedDay: today };
    }
  }

  /* ---- the one entry point ------------------------------------- */

  /**
   * Apply a single keypress. This is the ONLY way game state changes.
   *
   * The client cannot ask for a specific outcome; it can only say "the player
   * pressed F". Everything that follows — the dice roll, the death, the loot —
   * happens here.
   */
  command(token: string, key: string, now: number = Date.now()): Screen {
    const session = this.sessions.get(token) ?? this.newSession(token);
    session.lastSeen = now;

    this.tickResidents(session, now);

    /* Two forms of the key: `k` for command matching, `raw` for text entry.
       Lowercasing a typed name turns "Aria" into "aria" — a bug the player
       would notice immediately and could never fix. */
    const raw = typeof key === 'string' ? key : '';
    const k = raw.toLowerCase();
    const result = this.reduce(session, k, raw, now);

    /* Persist realm-scoped structures back onto the session's save so the next
       request reads a consistent world. */
    session.save = {
      ...session.save,
      residents: this.residents,
      hallOfFame: this.hall,
      realmFeed: this.feed,
    };

    return this.toScreen(session, result);
  }

  /**
   * The reduction itself: keypress → new session state.
   *
   * This mirrors the old client-side router, deliberately. The difference is
   * that it now runs somewhere the player has no filesystem access to.
   */
  private reduce(
    session: StoredSession,
    k: string,
    raw: string,
    now: number,
  ): { lines: CombatLine[]; step?: flow.Step } {
    const c = session.save.character;
    const ctx = (character: Character): flow.FlowContext => ({
      rng: createRng(),
      character,
      residents: this.residents,
      hall: this.hall,
      others: [...this.sessions.values()]
        .map((s) => s.save.character)
        .filter(
          (o) =>
            o.name !== character.name &&
            o.name !== 'Unnamed' &&
            this.byName.has(o.name.trim().toLowerCase()),
        ),
      now,
    });

    const applyStep = (step: flow.Step) => {
      session.save = { ...session.save, character: step.character };
      if (step.hall) this.hall = step.hall;
      if (step.residents) this.residents = step.residents;
      if (step.feed) {
        this.feed = [
          {
            id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
            at: now,
            kind: step.feed.kind,
            text: step.feed.text,
          },
          ...this.feed,
        ].slice(0, gameRules.realm.feedLimit);
      }
      session.view = viewOf(step.view);
      return { lines: step.lines, step };
    };

    const say = (text: string, tone: CombatLine['tone'] = 'normal') => ({
      lines: [{ text, tone }],
    });

    /* ---- global keys ------------------------------------------- */
    if (k === 'escape' && session.view.kind !== 'title' && session.view.kind !== 'create') {
      session.view = { kind: 'hub' };
      return { lines: [] };
    }

    switch (session.view.kind) {
      case 'title': {
        if (k === 'n') {
          session.view = { kind: 'create', step: 'name' };
          session.save = { ...session.save, character: { ...c, name: '' } };
          return say('Name? {dim}Three to sixteen characters.{/}');
        }
        if (DIGITS.includes(k)) {
          const slot = this.slots()[DIGITS.indexOf(k)];
          if (!slot) return { lines: [] };
          const target = this.sessions.get(this.byName.get(slot.name.toLowerCase()) ?? '');
          if (target) {
            session.save = { ...target.save };
            session.view = { kind: 'hub' };
            return {
              lines: [
                { text: 'CARRIER RE-ESTABLISHED .................... OK' },
                { text: `{dim}Signed in as ${slot.name}.{/}`, tone: 'dim' },
              ],
            };
          }
        }
        return { lines: [] };
      }

      case 'create': {
        if (session.view.step === 'name') {
          if (k === 'backspace') {
            session.save = { ...session.save, character: { ...c, name: c.name.slice(0, -1) } };
            return { lines: [] };
          }
          if (k === 'enter') {
            const check = validateName(c.name);
            if (!check.ok) {
              return say(
                '{dim}Three to sixteen characters. Letters, apostrophes, spaces, hyphens.{/}',
                'dim',
              );
            }
            if (this.nameTaken(c.name)) {
              return say('That name is already on this node. The realm remembers.', 'red');
            }
            session.view = { kind: 'create', step: 'sex' };
            return {
              lines: [
                { text: 'And how shall the realm address you?' },
                { text: '[M] — as a man     [F] — as a woman', tone: 'dim' },
              ],
            };
          }
          if (raw.length === 1 && gameRules.namePattern.test(raw)) {
            const next = c.name + raw;
            if (next.length <= gameRules.nameMaxLength) {
              session.save = { ...session.save, character: { ...c, name: next } };
            }
          }
          return { lines: [] };
        }

        if (session.view.step === 'sex') {
          if (k === 'm' || k === 'f') {
            session.save = {
              ...session.save,
              character: { ...c, sex: k as 'm' | 'f' },
            };
            session.view = { kind: 'create', step: 'class' };
            return {
              lines: [
                { text: 'Every road out of this town goes through the forest.' },
                { text: '[W] Warrior   [M] Magician   [T] Thief', tone: 'dim' },
              ],
            };
          }
          return { lines: [] };
        }

        const clsMap: Record<string, 'warrior' | 'magician' | 'thief'> = {
          w: 'warrior',
          m: 'magician',
          t: 'thief',
        };
        const cls = clsMap[k];
        if (!cls) return { lines: [] };

        const character = buildStartingCharacter({
          name: c.name,
          sex: c.sex,
          cls,
          now: new Date(now).toISOString(),
        });
        session.save = { ...emptySave(character), residents: this.residents };
        this.byName.set(character.name.trim().toLowerCase(), session.token);
        session.view = { kind: 'hub' };
        return {
          lines: [
            { text: `{bright}${character.name}{/} the ${cls}. The innkeeper writes it in the ledger.` },
            { text: 'You arrive at Redgate with a rusty dagger, rags, and fifty gold.' },
            { text: 'Nobody here has heard of you. That is the point of arriving.' },
            { text: `{dim}${character.turnsRemaining} turns remaining today.{/}`, tone: 'dim' },
          ],
        };
      }

      case 'hub': {
        switch (k) {
          case 'f':
            return applyStep(flow.forestTurn(ctx(c)));
          case 'i':
            return applyStep(flow.openInn(ctx(c)));
          case 'b':
            return applyStep(flow.openBank(ctx(c)));
          case 's':
            return applyStep(flow.openShop(ctx(c)));
          case 'h':
            return applyStep(flow.openHealer(ctx(c)));
          case 'c':
            return applyStep(flow.characterSheet(ctx(c)));
          case 'w':
            return applyStep(flow.whoIsWhoScreen(ctx(c)));
          case 'p':
            return applyStep(flow.openPvp(ctx(c)));
          case 'd':
            return applyStep(flow.openDragon(ctx(c)));
          case 'q':
            session.view = { kind: 'title' };
            return say('CARRIER LOST.');
          default:
            return say(`{dim}Unknown command: ${k}. Type ? for help.{/}`, 'dim');
        }
      }

      case 'forest': {
        const id = session.view.encounterId as Parameters<typeof flow.answerEncounter>[1];
        if (k === 'y' || k === 'n') {
          return applyStep(flow.answerEncounter(ctx(c), id, k === 'y'));
        }
        return { lines: [] };
      }

      case 'shop': {
        const tab = session.view.tab;
        if (DIGITS.includes(k)) {
          return applyStep(flow.shopBuy(ctx(c), tab, DIGITS.indexOf(k)));
        }
        if (k === 'w') return applyStep(flow.openShop(ctx(c), 'weapon'));
        if (k === 'a') return applyStep(flow.openShop(ctx(c), 'armor'));
        if (k === 'x') return applyStep(flow.shopSell(ctx(c), 'weapon'));
        if (k === 'z') return applyStep(flow.shopSell(ctx(c), 'armor'));
        return { lines: [] };
      }

      case 'bank': {
        if (k === 'd') return applyStep(flow.bankAction(ctx(c), 'deposit'));
        if (k === 'w') return applyStep(flow.bankAction(ctx(c), 'withdraw'));
        return { lines: [] };
      }

      case 'healer': {
        if (k === 'y' || k === 'n') {
          return applyStep(flow.healAction(ctx(c), k === 'y'));
        }
        return { lines: [] };
      }

      case 'inn': {
        if (k === 't') return applyStep(flow.talkToWren(ctx(c)));
        return { lines: [] };
      }

      case 'pvp': {
        if (DIGITS.includes(k)) {
          return applyStep(flow.pvpAction(ctx(c), DIGITS.indexOf(k)));
        }
        return { lines: [] };
      }

      case 'dragon': {
        if (k === 'y') return applyStep(flow.faceWyrm(ctx(c)));
        if (k === 'n') {
          session.view = { kind: 'hub' };
          return say('{dim}The mountain will still be there tomorrow.{/}', 'dim');
        }
        if (k === 'r') return applyStep(flow.retireCharacter(ctx(c)));
        if (k === 'c') return applyStep(flow.continueHunting(ctx(c)));
        return { lines: [] };
      }

      default:
        return { lines: [] };
    }
  }

  /* ---- rendering ------------------------------------------------ */

  private toScreen(
    session: StoredSession,
    result: { lines: CombatLine[] },
  ): Screen {
    const view = session.view;
    const c = session.save.character;
    const created = this.byName.has(c.name.trim().toLowerCase());

    return {
      view: view.kind,
      lines: result.lines,
      character: created ? headerCharacter(c) : null,
      prompt: promptFor(view),
      menu: view.kind === 'hub' ? HUB_MENU : null,
      slots: this.slots(),
      feed: this.feed.slice(0, 6).map((f) => f.text),
    };
  }
}

/** What the header needs. No more than that crosses the wire. */
function headerCharacter(c: Character) {
  return {
    name: c.name,
    className: c.class,
    level: c.level,
    levelRoman: toRoman(c.level),
    title: titleForLevel(c.level, c.isWyrmbane),
    hp: c.hp,
    maxHp: c.maxHp,
    gold: c.gold,
    gems: c.gems,
    turnsRemaining: c.turnsRemaining,
    weaponPower: itemById(c.weaponId).power,
    armorPower: itemById(c.armorId).power,
    retired: c.retired,
  };
}

export const HUB_MENU = [
  { key: 'F', label: 'Fight' },
  { key: 'I', label: 'Inn' },
  { key: 'B', label: 'Bank' },
  { key: 'S', label: 'Shop' },
  { key: 'H', label: 'Healer' },
  { key: 'C', label: 'Character' },
  { key: 'W', label: "Who's Who" },
  { key: 'P', label: 'Attack' },
  { key: 'D', label: 'Wyrm' },
];

/**
 * The keys a screen is waiting for. Returning `null` is meaningful: it tells
 * the shell "this screen has no pending question", which is what lets the hub
 * render its command summary instead of a one-line hint.
 *
 * This used to fall through to a catch-all `{ keys: ['escape'] }`, so EVERY
 * screen had a prompt object and the footer preferred it over the menu — the
 * hub could never show its own menu. `null` is the fix, not a shortcut.
 */
function promptFor(view: flowView): Screen['prompt'] {
  switch (view.kind) {
    /* Screens with no question: the shell shows the menu, or the ESC hint. */
    case 'title':
    case 'hub':
    case 'character':
    case 'who':
    case 'hall':
      return null;

    case 'create':
      return view.step === 'name'
        ? { label: 'Type a name, then Enter', keys: ['enter'], hint: 'letters, spaces, hyphens' }
        : view.step === 'sex'
          ? { label: 'Man or woman?', keys: ['m', 'f'] }
          : { label: 'Choose a class', keys: ['w', 'm', 't'] };

    case 'forest':
      return { label: 'Answer', keys: ['y', 'n'] };

    /* The label carries the detail; the key list stays short enough to read. */
    case 'shop':
      return { label: 'Buy with 1-9', keys: ['w', 'a', 'x', 'z', 'escape'] };

    case 'bank':
      return { label: 'Deposit / withdraw', keys: ['d', 'w', 'escape'] };

    case 'healer':
      return { label: 'Pay for healing?', keys: ['y', 'n'] };

    case 'inn':
      /* `escape` is already in the key list, so it needs no hint repeating it. */
      return { label: 'Talk to Wren', keys: ['t', 'escape'] };

    case 'pvp':
      return { label: 'Choose a target', keys: ['1-9', 'escape'] };

    case 'dragon':
      return { label: 'Face the wyrm?', keys: ['y', 'n'], hint: 'R retire · C continue' };
  }
}

function viewOf(v: { kind: string } & Record<string, unknown>): flowView {
  const kind = v.kind as flowView['kind'];
  if (kind === 'forest') {
    const enc = (v as { encounterId?: string }).encounterId ?? 'shrine';
    return { kind: 'forest', phase: 'encounter-prompt', encounterId: enc };
  }
  if (kind === 'shop') {
    return { kind: 'shop', tab: ((v as { tab?: 'weapon' | 'armor' }).tab ?? 'weapon') };
  }
  if (kind === 'create') {
    return { kind: 'create', step: 'name' };
  }
  const allowed: flowView['kind'][] = [
    'title',
    'hub',
    'bank',
    'healer',
    'inn',
    'pvp',
    'dragon',
    'character',
    'who',
    'hall',
  ];
  if (allowed.includes(kind)) return { kind } as flowView;
  return { kind: 'hub' };
}
