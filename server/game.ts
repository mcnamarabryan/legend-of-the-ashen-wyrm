import type { Character, CombatLine, SaveFile } from './engine/types';
import { dayKey, daysBetween, gameRules, toRoman } from './engine/rules';
import { emptySave } from './engine/save';
import { rolloverDay } from './engine/economy';
import { buildStartingCharacter, validateName } from './engine/creation';
import { progressResidents } from './engine/pvp';
import { createRng } from './engine/rng';
import { titleForLevel } from './content/strings';
import { itemById } from './content/items';
import type { RealmDb } from './store';
import * as flow from './flow';
import type { Screen, SlotSummary, WireEntry } from './wire';

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
 *
 * PERSISTENCE: characters and realm state live in SQLite (`store.ts`). The maps
 * below are a cache rebuilt on boot; every mutation writes through, so a restart
 * resumes exactly where it left off.
 *
 * Active *sessions* are deliberately NOT persisted. A session is a live
 * handshake — a token plus which screen you are looking at. Restart the server
 * and the token is gone, but the character is not: you reload, get a new token,
 * and pick your character from the title screen. The durable thing survives;
 * the ephemeral thing does not. That is the right split.
 */
export class Realm {
  private db: RealmDb;
  private sessions = new Map<string, StoredSession>();
  private byName = new Map<string, string>();
  /**
   * Which session created which character.
   *
   * WITHOUT THIS, ANY SESSION COULD TAKE OVER ANY CHARACTER. The title screen
   * lists every slot in the realm, and pressing a digit used to copy that
   * slot's save into the caller — including someone else's. The audit script
   * proved it: session B pressed [1] and was immediately playing session A's
   * character, spending A's turns.
   *
   * `byName` alone cannot express this, because it answers "who holds this
   * name" for PvP lookup, not "who is allowed to become this character".
   */
  private owner = new Map<string, string>();
  private residents: ReturnType<typeof emptySave>['residents'];
  private hall: SaveFile['hallOfFame'] = [];
  private feed: SaveFile['realmFeed'] = [];

  constructor(db: RealmDb) {
    this.db = db;

    const seeded = emptySave(
      buildStartingCharacter({ name: 'Placeholder', sex: 'm', cls: 'warrior' }),
    ).residents;

    const snapshot = db.snapshot(seeded);

    this.residents = snapshot.residents.length > 0 ? snapshot.residents : seeded;
    this.hall = snapshot.hall;
    this.feed = snapshot.feed;

    /*
     * Rehydrate characters into memory so they can be listed and attacked.
     *
     * Each keeps its stored owner token, which is the token that created it and
     * is long dead. That yields exactly the right behaviour: after a restart the
     * character is present and visible in Who's Who, but no *new* session can
     * load it by pressing a digit.
     */
    for (const stored of snapshot.characters) {
      const key = stored.name.trim().toLowerCase();
      this.owner.set(key, stored.owner);
      this.byName.set(key, stored.owner);
      this.sessions.set(stored.owner, {
        token: stored.owner,
        save: stored.save,
        view: stored.save.character.retired ? { kind: 'hall' } : { kind: 'hub' },
        lastSeen: 0,
      });
    }
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

  /* ---- persistence --------------------------------------------- */

  /**
   * Write the live character and realm state through to SQLite.
   *
   * Called after every command. Cheap at this scale — a few KB serialised —
   * and it means "what is in memory" and "what is on disk" cannot diverge for
   * more than a single keypress.
   */
  private persist(session: StoredSession): void {
    const c = session.save.character;
    const key = c.name.trim().toLowerCase();

    /* Only characters that were actually created. A session sitting on the
       title screen carries an "Unnamed" placeholder which must never become a
       row, or the realm slowly fills with ghosts. */
    if (this.byName.has(key)) {
      this.db.putCharacter(c.name, session.token, {
        ...session.save,
        residents: this.residents,
        hallOfFame: this.hall,
        realmFeed: this.feed,
      });
    }

    this.db.putRealm({
      residents: this.residents,
      hall: this.hall,
      feed: this.feed,
      day: dayKey(),
    });
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

    /*
     * THE DAY ROLLOVER. This was missing entirely.
     *
     * Without it, turns never came back: spend your ten and you were stuck at
     * zero forever. The central premise of a daily-turns game quietly not
     * working, and no test caught it because the tests exercise `rolloverDay`
     * directly rather than through the server.
     *
     * `rolloverDay` is idempotent, so calling it on every command is safe.
     */
    const rolled = rolloverDay(session.save.character, now);
    if (rolled.rolled) {
      session.save = { ...session.save, character: rolled.character };
    }

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

    /* Tell the player the day turned over, and what the bank paid. */
    if (rolled.rolled) {
      result.lines = [
        { text: 'A new day on the node.', tone: 'bright' },
        { text: `{dim}${gameRules.turnsPerDay} turns restored.{/}`, tone: 'dim' },
        ...(rolled.interest > 0
          ? [
              {
                text: `{gold}The bank paid you ${rolled.interest} gold in interest overnight.{/}`,
                tone: 'gold' as const,
              },
            ]
          : []),
        ...result.lines,
      ];
    }

    /* Durability. Unconditional, because the reduce above may have just created
       the character; `persist` itself decides whether a row is warranted. */
    this.persist(session);

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

          const key = slot.name.trim().toLowerCase();

          /* Only your own characters. The title screen lists the whole realm,
             but "listed" must not mean "claimable" — without this check any
             session could take over any character by pressing its digit. */
          if (this.owner.get(key) !== session.token) {
            return say(
              '{dim}That adventurer is not yours to play. Create your own with [N].{/}',
              'dim',
            );
          }

          const target = this.sessions.get(this.byName.get(key) ?? '');
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
        this.owner.set(character.name.trim().toLowerCase(), session.token);
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
      entry: entryFor(view, c.name),
      slots: this.slots(),
      feed: this.feed.slice(0, 6).map((f) => f.text),
    };
  }
}

/**
 * The live text field, if the current screen has one.
 *
 * Only the name step needs this: it is the sole place the player types free text
 * rather than pressing a single command key. Everything else is a Y/N or a digit,
 * and those are answered by the prompt bar.
 *
 * The value comes straight from the server's copy of the character, which is
 * what makes this honest — the browser is not echoing its own keystrokes back
 * at itself, it is being told what the node believes has been entered. A dropped
 * keypress therefore shows up as a dropped character instead of silently
 * diverging, and backspace behaves correctly because the server sliced the
 * string rather than the client guessing.
 */
function entryFor(view: flowView, name: string): WireEntry | null {
  if (view.kind !== 'create' || view.step !== 'name') return null;

  return {
    label: 'WHAT IS YOUR NAME?',
    value: name,
    hint: 'letters, apostrophes, spaces, hyphens',
    max: gameRules.nameMaxLength,
  };
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
    /*
     * Preserve the step.
     *
     * This returned `step: 'name'` unconditionally, so any create view routed
     * through `viewOf` snapped back to the first question. It survived only
     * because `reduce` assigns `session.view` directly for the sex and class
     * steps and never comes through here — but a future caller that did would
     * strand the player on the name prompt, which is exactly the class of bug
     * that makes a screen look like it forgot what was typed.
     */
    const step = (v as { step?: 'name' | 'sex' | 'class' }).step ?? 'name';
    return { kind: 'create', step };
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
