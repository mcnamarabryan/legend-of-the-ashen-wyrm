import type {
  Character,
  CombatLine,
  EncounterId,
  FeedEntry,
  HallEntry,
  Monster,
  Prompt,
  Resident,
  Rng,
} from './engine/types';
import { dayKey, gameRules, toRoman } from './engine/rules';
import { awardXp } from './engine/progression';
import {
  applyDeath,
  bankDeposit,
  bankWithdraw,
  buyItem,
  healCost,
  healFully,
  sellEquipped,
  spendTurn,
} from './engine/economy';
import { resolveFight } from './engine/combat';
import { describeEncounter, resolveEncounter, rollEncounter } from './engine/encounters';
import { canAttack, fightPlayer, stealFrom } from './engine/pvp';
import { attemptWyrm, continueAfterWyrm, hallRowFor, retire, wyrmAvailability } from './engine/dragon';
import { itemById, shopArmors, shopWeapons } from './content/items';
import { monstersForLevel } from './content/monsters';
import {
  bank as bankMsg,
  combat as combatMsg,
  dragon as dragonMsg,
  healer as healerMsg,
  hub,
  inn as innMsg,
  pvp as pvpMsg,
  shop as shopMsg,
  whoIsWho,
} from './content/strings';
/** The screens the flow layer can return. Presentation-agnostic. */
export type View =
  | { kind: 'hub' }
  | { kind: 'title' }
  | { kind: 'forest'; phase: string; encounterId?: EncounterId }
  | { kind: 'shop'; tab: 'weapon' | 'armor' }
  | { kind: 'bank' }
  | { kind: 'healer' }
  | { kind: 'inn' }
  | { kind: 'pvp' }
  | { kind: 'dragon'; phase: string }
  | { kind: 'character' }
  | { kind: 'who' }
  | { kind: 'hall' };

/**
 * The flow layer.
 *
 * Every player action comes in as a context plus a decision and leaves as a
 * Step: new narrative lines, the new character, the next screen, and any
 * prompt. No React, no storage, no clock reads beyond what is passed in.
 * That makes the whole game playable headlessly in tests.
 */

export interface FlowContext {
  rng: Rng;
  character: Character;
  residents: Resident[];
  hall: HallEntry[];
  /** Characters from other tabs, for PvP and Who's Who. */
  others: Character[];
  now: number;
}

export interface Step {
  lines: CombatLine[];
  character: Character;
  view: View;
  prompt?: Prompt | null;
  feed?: { text: string; kind: FeedEntry['kind'] };
  hall?: HallEntry[];
  residents?: Resident[];
}

const line = (text: string, tone: CombatLine['tone'] = 'normal'): CombatLine => ({ text, tone });

function linesFrom(strings: readonly string[], tone: CombatLine['tone'] = 'normal'): CombatLine[] {
  return strings.map((text) => ({ text, tone }));
}

/* ------------------------------------------------------------------ */
/* Hub                                                                 */
/* ------------------------------------------------------------------ */

export function greet(ctx: FlowContext): Step {
  return {
    lines: [
      line(hub.greeting[Math.floor(ctx.rng() * hub.greeting.length)]),
      line(hub.turnsLeft(ctx.character.turnsRemaining), 'dim'),
    ],
    character: ctx.character,
    view: { kind: 'hub' },
  };
}

export function hubNotice(ctx: FlowContext): Step {
  const c = ctx.character;
  if (c.turnsRemaining <= 0) {
    return {
      lines: [line(hub.noTurns[Math.floor(ctx.rng() * hub.noTurns.length)])],
      character: c,
      view: { kind: 'hub' },
    };
  }
  return { lines: [], character: c, view: { kind: 'hub' } };
}

/* ------------------------------------------------------------------ */
/* Roster                                                              */
/* ------------------------------------------------------------------ */

/**
 * One row in any list of adventurers — Who's Who, or the PvP target picker.
 *
 * `resident` is the single source of truth for "this one is simulated". Both
 * screens read it from here, so a resident can never be a person in one list
 * and a ghost in another.
 */
export interface RosterRow {
  character: Character;
  resident: boolean;
  bio?: string;
}

/**
 * Everyone currently in the realm: the six simulated residents plus every
 * other character this browser holds. The player is always included — seeing
 * yourself ranked is part of the genre.
 */
export function roster(ctx: FlowContext): RosterRow[] {
  const rows: RosterRow[] = [];
  const seen = new Set<string>();

  for (const r of ctx.residents) {
    const key = r.character.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ character: r.character, resident: true, bio: r.bio });
  }

  for (const c of ctx.others) {
    const key = c.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ character: c, resident: false });
  }

  const selfKey = ctx.character.name.trim().toLowerCase();
  if (!seen.has(selfKey)) {
    rows.push({ character: ctx.character, resident: false });
  }

  return rows;
}

/** Is this name one of the six simulated adventurers? */
export function isResident(ctx: FlowContext, name: string): boolean {
  const key = name.trim().toLowerCase();
  return ctx.residents.some((r) => r.character.name.trim().toLowerCase() === key);
}

/** The tag appended to a resident's name in any list. */
export const RESIDENT_TAG = '{dim}[sim]{/}';

/* ------------------------------------------------------------------ */
/* Forest                                                              */
/* ------------------------------------------------------------------ */

export function forestTurn(ctx: FlowContext): Step {
  const c = ctx.character;

  if (c.turnsRemaining <= 0) {
    return {
      lines: [line(hub.noTurns[Math.floor(ctx.rng() * hub.noTurns.length)])],
      character: c,
      view: { kind: 'hub' },
    };
  }

  const spent = spendTurn(c);

  /* Special encounter — one in eight forest turns. */
  if (ctx.rng() < gameRules.forest.encounterChance) {
    const encounter = rollEncounter(ctx.rng, spent);
    const isFree = encounter.free || !encounter.prompt;

    if (encounter.prompt && !encounter.free) {
      return {
        lines: [...encounter.lines, line(encounter.prompt, 'dim')],
        character: spent,
        view: { kind: 'forest', phase: 'encounter-prompt', encounterId: encounter.id },
        prompt: { label: encounter.prompt, keys: ['y', 'n'] },
      };
    }

    const resolved = resolveEncounter(ctx.rng, spent, encounter.id, 'ack');
    const refunded = isFree ? { ...resolved.character, turnsRemaining: c.turnsRemaining } : resolved.character;
    const withLevels = awardXp(refunded, 0);

    return {
      lines: [
        ...encounter.lines,
        ...resolved.lines,
        ...(isFree
          ? [line('{dim}You lost nothing but the walk. The turn is still yours.{/}', 'dim')]
          : []),
        ...(withLevels.leveled ? withLevels.lines : []),
      ],
      character: withLevels.character,
      view: { kind: 'hub' },
    };
  }

  /* A monster. */
  const pool = monstersForLevel(spent.level);
  const monster: Monster = pool[Math.floor(ctx.rng() * pool.length)] ?? pool[0];
  const fight = resolveFight({ rng: ctx.rng, character: spent, monster });

  const damageLines = fight.lines;
  const lootLine = line(
    combatMsg.xp(monster.xp, monster.gold),
    'gold',
  );

  if (!fight.won) {
    const dying: Character = { ...spent, hp: 0, mana: fight.manaLeft };
    const death = applyDeath(dying, ctx.rng);
    return {
      lines: [...damageLines, ...death.lines],
      character: death.character,
      view: { kind: 'hub' },
      prompt: null,
    };
  }

  const alive: Character = {
    ...spent,
    hp: Math.max(1, fight.playerHp),
    mana: fight.manaLeft,
    gold: spent.gold + monster.gold,
  };
  const levelled = awardXp(alive, monster.xp);

  /* Gems gate the best armor, and the best armor is what makes the wyrm
     survivable. A slow trickle from ordinary fights keeps the endgame
     reachable without a lucky encounter roll deciding the run. */
  const foundGem = ctx.rng() < gameRules.forest.gemDropChance;
  const paid: Character = foundGem
    ? { ...levelled.character, gems: levelled.character.gems + 1 }
    : levelled.character;

  return {
    lines: [
      ...damageLines,
      lootLine,
      ...(foundGem ? [line('{gold}Something hard is caught in the carcass. A gem.{/}', 'gold')] : []),
      ...(levelled.leveled ? levelled.lines : []),
      line(hub.turnsLeft(paid.turnsRemaining), 'dim'),
    ],
    character: paid,
    view: { kind: 'hub' },
  };
}

export function answerEncounter(ctx: FlowContext, id: EncounterId, yes: boolean): Step {
  /* The turn was already spent entering the forest. If this encounter could
     never have cost anything — narrative-only, or impossible to accept — it
     comes back. Charging a turn for a dead end is how a game loses a player. */
  const free = describeEncounter(id, ctx.character).free;
  const resolved = resolveEncounter(ctx.rng, ctx.character, id, yes ? 'yes' : 'no');
  const settled = free
    ? { ...resolved.character, turnsRemaining: ctx.character.turnsRemaining + 1 }
    : resolved.character;
  const withLevels = awardXp(settled, 0);

  return {
    lines: [
      ...resolved.lines,
      ...(free
        ? [line('{dim}You lost nothing but the walk. The turn is still yours.{/}', 'dim')]
        : []),
      ...(withLevels.leveled ? withLevels.lines : []),
    ],
    character: withLevels.character,
    view: { kind: 'hub' },
  };
}

/* ------------------------------------------------------------------ */
/* Shop                                                                */
/* ------------------------------------------------------------------ */

export type ShopTab = 'weapon' | 'armor';

/**
 * The shop is two pages. Eleven items do not fit behind nine digit keys, and
 * a shop you cannot see all of is a bug the player experiences as a missing
 * weapon.
 */
function stockFor(tab: ShopTab) {
  return tab === 'weapon' ? shopWeapons() : shopArmors();
}

function shopPage(c: Character, tab: ShopTab): CombatLine[] {
  const stock = stockFor(tab);
  const equippedId = tab === 'weapon' ? c.weaponId : c.armorId;

  const lines: CombatLine[] = [
    line(
      `{bright}${tab === 'weapon' ? 'WEAPONS' : 'ARMOR'}{/}   ` +
        `{dim}you carry ${c.gold}g${c.gems > 0 ? `, ${c.gems} gem${c.gems === 1 ? '' : 's'}` : ''}{/}`,
      'bright',
    ),
  ];

  stock.forEach((item, i) => {
    const affordable = c.gold >= item.price && c.gems >= item.gems;
    const isEquipped = item.id === equippedId;
    const price = item.gems ? `${item.price}g +${item.gems}\u25c7` : `${item.price}g`;

    lines.push(
      line(
        `  [${i + 1}] ${item.name.padEnd(17)}${String(item.power).padStart(3)}  ${price.padStart(11)}` +
          `${isEquipped ? '  {gold}carried{/}' : ''}`,
        affordable ? 'normal' : 'dim',
      ),
    );
  });

  lines.push(
    line(''),
    line(shopMsg.wow(itemById(c.weaponId).power, itemById(c.armorId).power), 'dim'),
    line(
      `${tab === 'weapon' ? '{dim}[W] Weapons{/} {bright}[A] Armor{/}' : '{bright}[W] Weapons{/} {dim}[A] Armor{/}'}` +
        `   {dim}[X] Sell weapon   [Z] Sell armor   [ESC] Leave{/}`,
      'dim',
    ),
  );

  return lines;
}

export function openShop(ctx: FlowContext, tab: ShopTab = 'weapon'): Step {
  const c = ctx.character;
  const greeting = shopMsg.greet[Math.floor(ctx.rng() * shopMsg.greet.length)];
  return {
    lines: [line(greeting), line(''), ...shopPage(c, tab)],
    character: c,
    view: { kind: 'shop', tab },
  };
}

export function shopBuy(ctx: FlowContext, tab: ShopTab, index: number): Step {
  const stock = stockFor(tab);
  const item = stock[index];

  if (!item) {
    return {
      lines: [line('{dim}The smith waits. Choose a number.{/}', 'dim'), line('')],
      character: ctx.character,
      view: { kind: 'shop', tab },
    };
  }

  const result = buyItem(ctx.character, item.id);
  const lines: CombatLine[] = [result.line];

  if (result.ok) {
    const weapon = itemById(result.character.weaponId);
    const armor = itemById(result.character.armorId);
    lines.push(
      line(
        `{dim}Attack ${result.character.str + weapon.power}   Defense ${result.character.def + armor.power}   ${result.character.gold}g left.{/}`,
        'dim',
      ),
    );
  }

  lines.push(line(''), ...shopPage(result.character, tab));
  return { lines, character: result.character, view: { kind: 'shop', tab } };
}

export function shopSell(ctx: FlowContext, kind: 'weapon' | 'armor'): Step {
  const result = sellEquipped(ctx.character, kind);
  const tab: ShopTab = kind === 'weapon' ? 'weapon' : 'armor';
  return {
    lines: [result.line, line(''), ...shopPage(result.character, tab)],
    character: result.character,
    view: { kind: 'shop', tab },
  };
}

/* ------------------------------------------------------------------ */
/* Bank                                                                */
/* ------------------------------------------------------------------ */

export function openBank(ctx: FlowContext): Step {
  const c = ctx.character;
  return {
    lines: [
      line(bankMsg.greet[Math.floor(ctx.rng() * bankMsg.greet.length)]),
      line(bankMsg.balance(c.gold, c.banked, gameRules.bank.cap)),
      line('{dim}[D] Deposit all   [W] Withdraw all   [ESC] Leave{/}', 'dim'),
      line(bankMsg.capNote, 'dim'),
    ],
    character: c,
    view: { kind: 'bank' },
  };
}

export function bankAction(ctx: FlowContext, kind: 'deposit' | 'withdraw'): Step {
  const c = ctx.character;
  const next = kind === 'deposit' ? bankDeposit(c, c.gold) : bankWithdraw(c, c.banked);
  const moved = kind === 'deposit' ? c.gold - next.gold : c.banked - next.banked;

  const lines: CombatLine[] =
    moved <= 0
      ? [line(bankMsg.nothing, 'dim')]
      : [
          line(kind === 'deposit' ? bankMsg.deposited(moved) : bankMsg.withdrew(moved), 'dim'),
          line(bankMsg.balance(next.gold, next.banked, gameRules.bank.cap), 'dim'),
        ];

  return { lines, character: next, view: { kind: 'bank' } };
}

/* ------------------------------------------------------------------ */
/* Healer                                                              */
/* ------------------------------------------------------------------ */

export function openHealer(ctx: FlowContext): Step {
  const c = ctx.character;
  const cost = healCost(c);

  if (cost === 0) {
    return {
      lines: [
        line(healerMsg.greet[Math.floor(ctx.rng() * healerMsg.greet.length)]),
        line(healerMsg.alreadyFull, 'dim'),
      ],
      character: c,
      view: { kind: 'hub' },
    };
  }

  return {
    lines: [
      line(healerMsg.greet[Math.floor(ctx.rng() * healerMsg.greet.length)]),
      line(healerMsg.cost(cost), 'dim'),
      line('{dim}Full healing? [Y] / [N]{/}', 'dim'),
    ],
    character: c,
    view: { kind: 'healer' },
    prompt: { label: 'Pay for healing?', keys: ['y', 'n'] },
  };
}

export function healAction(ctx: FlowContext, yes: boolean): Step {
  if (!yes) {
    return { lines: [], character: ctx.character, view: { kind: 'hub' } };
  }
  const result = healFully(ctx.character);
  return { lines: [result.line], character: result.character, view: { kind: 'hub' } };
}

/* ------------------------------------------------------------------ */
/* Inn / Wren                                                          */
/* ------------------------------------------------------------------ */

export function openInn(ctx: FlowContext): Step {
  const c = ctx.character;
  const lines: CombatLine[] = linesFrom([
    innMsg.greet[Math.floor(ctx.rng() * innMsg.greet.length)],
  ]);

  if (c.wrenStage >= 5) {
    lines.push(line('{dim}Wren is not behind the bar tonight.{/}', 'dim'));
  } else {
    lines.push(line('{dim}[T] Talk to Wren    [ESC] Leave the inn{/}', 'dim'));
  }

  return {
    lines,
    character: c,
    view: { kind: 'inn' },
    prompt:
      c.wrenStage >= 5
        ? null
        : { label: 'Talk to Wren?', keys: ['t', 'escape'], hint: 'ESC leaves the inn' },
  };
}

export function talkToWren(ctx: FlowContext): Step {
  const c = ctx.character;
  const stage = c.wrenStage;
  const lines: CombatLine[] = [];
  let next = c;
  let prompt: Prompt | null = null;
  let view: View = { kind: 'inn' };

  switch (stage) {
    case 0:
      lines.push(...linesFrom(innMsg.wren[0]));
      next = { ...c, wrenStage: 1 };
      break;

    case 1:
      if (c.gold < gameRules.wren.drinkCost) {
        lines.push(line(innMsg.noGold, 'dim'));
        break;
      }
      lines.push(...linesFrom(innMsg.wren[1]));
      next = { ...c, gold: c.gold - gameRules.wren.drinkCost, wrenStage: 2 };
      break;

    case 2:
      if (c.chm < gameRules.wren.charmRequirement) {
        lines.push(line(innMsg.charmFail, 'dim'));
        lines.push(line(`{dim}She needs Charm ${gameRules.wren.charmRequirement}. You have ${c.chm}.{/}`, 'dim'));
        break;
      }
      lines.push(...linesFrom(innMsg.wren[2]));
      next = { ...c, wrenStage: 3 };
      break;

    case 3:
      if (c.gold < gameRules.wren.ringCost) {
        lines.push(line(innMsg.noGold, 'dim'));
        lines.push(line(innMsg.ringCost(gameRules.wren.ringCost), 'dim'));
        break;
      }
      lines.push(...linesFrom(innMsg.wren[3]));
      next = { ...c, gold: c.gold - gameRules.wren.ringCost, wrenStage: 4 };
      break;

    case 4:
      /* She has said yes. She is waiting for the mountain to go quiet. */
      if (!c.isWyrmbane) {
        lines.push(line(innMsg.waiting, 'dim'));
        break;
      }
      lines.push(...linesFrom(innMsg.wren[4]));
      lines.push(line(dragonMsg.married, 'bright'));
      lines.push(line('{gold}You are Wren\u2019s Beloved.{/}', 'gold'));
      next = {
        ...c,
        wrenStage: 5,
        titles: c.titles.includes("Wren's Beloved")
          ? c.titles
          : [...c.titles, "Wren's Beloved"],
      };
      view = { kind: 'hub' };
      break;

    default:
      lines.push(line(innMsg.noWren, 'dim'));
      view = { kind: 'hub' };
      break;
  }

  if (view.kind === 'inn') {
    lines.push(line(`{dim}Wren: stage ${next.wrenStage} of 5.{/}`, 'dim'));
    lines.push(line('{dim}[T] Keep talking    [ESC] Back to the square{/}', 'dim'));
    prompt = {
      label: 'Talk to Wren again?',
      keys: ['t', 'escape'],
      hint: 'ESC leaves the inn',
    };
  }

  return { lines, character: next, view, prompt };
}

/* ------------------------------------------------------------------ */
/* PvP                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The PvP target list.
 *
 * Derived from the roster so the picker shows exactly the people Who's Who
 * shows — residents tagged `[sim]`, other players' characters untagged. Both
 * `openPvp` and `pvpAction` call this, so a displayed index always resolves to
 * the same opponent the player saw.
 */
export function pvpTargets(ctx: FlowContext): RosterRow[] {
  const selfKey = ctx.character.name.trim().toLowerCase();
  return roster(ctx)
    .filter((row) => row.character.name.trim().toLowerCase() !== selfKey)
    .filter((row) => !row.character.retired)
    .filter((row) => canAttack(ctx.character, row.character))
    .sort(
      (a, b) =>
        b.character.level - a.character.level || b.character.xp - a.character.xp,
    )
    .slice(0, 9);
}

export function openPvp(ctx: FlowContext): Step {
  const c = ctx.character;
  if (c.turnsRemaining <= 0) {
    return {
      lines: [line(hub.noTurns[0])],
      character: c,
      view: { kind: 'hub' },
    };
  }

  const targets = pvpTargets(ctx);

  if (targets.length === 0) {
    return { lines: [line(pvpMsg.noTargets, 'dim')], character: c, view: { kind: 'hub' } };
  }

  const lines: CombatLine[] = [
    line(pvpMsg.header, 'bright'),
    line(pvpMsg.rangeNote(gameRules.pvp.levelRange), 'dim'),
  ];

  targets.forEach((row, i) => {
    const t = row.character;
    lines.push(
      line(
        `  {bright}[${i + 1}]{/} ${t.name.padEnd(16)} level ${toRoman(t.level).padStart(4)}  ${t.class.padEnd(9)} ${String(
          t.playerKills,
        ).padStart(3)} kills${row.resident ? '  {dim}[sim]{/}' : ''}`,
      ),
    );
  });

  lines.push(line(pvpMsg.costNote, 'dim'));

  return {
    lines,
    character: c,
    view: { kind: 'pvp' },
    prompt: { label: 'Choose a target', keys: targets.map((_, i) => String(i + 1)) },
  };
}

export function pvpAction(ctx: FlowContext, index: number): Step {
  const c = ctx.character;
  if (c.turnsRemaining <= 0) {
    return { lines: [line(hub.noTurns[0])], character: c, view: { kind: 'hub' } };
  }

  const target = pvpTargets(ctx)[index]?.character;
  if (!target) {
    return { lines: [line('{dim}There is no one there.{/}', 'dim')], character: c, view: { kind: 'hub' } };
  }

  const residents = ctx.residents;

  if (c.class === 'thief') {
    const result = stealFrom(ctx.rng, c, target);
    const updated = residents.map((r) =>
      r.character.name === target.name ? { ...r, character: result.target } : r,
    );
    return {
      lines: result.lines,
      character: result.thief,
      view: { kind: 'hub' },
      feed: { text: result.feed, kind: 'steal' },
      residents: updated,
    };
  }

  const result = fightPlayer(ctx.rng, c, target);
  const updated = residents.map((r) =>
    r.character.name === target.name ? { ...r, character: result.defender } : r,
  );

  return {
    lines: result.lines,
    character: result.attacker,
    view: { kind: 'hub' },
    feed: { text: result.feed, kind: 'pvp' },
    residents: updated,
  };
}

/* ------------------------------------------------------------------ */
/* The Ashen Wyrm                                                      */
/* ------------------------------------------------------------------ */

export function openDragon(ctx: FlowContext): Step {
  const c = ctx.character;
  const availability = wyrmAvailability(c, ctx.now);

  if (!availability.available) {
    return { lines: availability.lines, character: c, view: { kind: 'hub' } };
  }

  return {
    lines: [
      line('{red}The mountain has been smoking since dawn.{/}', 'red'),
      line('{dim}One attempt, today. [Y] Go north   [N] Not yet{/}', 'dim'),
    ],
    character: c,
    view: { kind: 'dragon', phase: 'offer' },
    prompt: { label: 'Face the wyrm?', keys: ['y', 'n'] },
  };
}

export function faceWyrm(ctx: FlowContext): Step {
  const c = ctx.character;
  const availability = wyrmAvailability(c, ctx.now);
  if (!availability.available) {
    return { lines: availability.lines, character: c, view: { kind: 'hub' } };
  }

  const result = attemptWyrm(ctx.rng, c, ctx.now);

  if (!result.won) {
    return { lines: result.lines, character: result.character, view: { kind: 'hub' } };
  }

  const entry = hallRowFor(result.character, ctx.now);
  const hall: HallEntry[] = [
    ...ctx.hall,
    {
      name: entry.name,
      class: result.character.class,
      date: entry.date,
      daysTaken: entry.days,
      resident: false,
    },
  ];

  return {
    lines: result.lines,
    character: result.character,
    view: { kind: 'dragon', phase: 'offer' },
    prompt: { label: 'Retire [R] or continue [C]?', keys: ['r', 'c'] },
    feed: { text: pvpMsg.feedWin(result.character.name, 'the Ashen Wyrm', 0), kind: 'wyrm' },
    hall,
  };
}

export function retireCharacter(ctx: FlowContext): Step {
  const frozen = retire(ctx.character);
  return {
    lines: [
      line('{bright}You hang your sword above the bar.{/}', 'bright'),
      line(dragonMsg.retired, 'dim'),
      line('{dim}The Hall of Fame keeps your name. The node keeps the rest.{/}', 'dim'),
    ],
    character: frozen,
    view: { kind: 'hall' },
  };
}

export function continueHunting(ctx: FlowContext): Step {
  const next = continueAfterWyrm(ctx.character, ctx.now);
  return {
    lines: [
      line(dragonMsg.continueNote, 'dim'),
      line(`{dim}The wyrm returns in ${gameRules.wyrm.respawnDays} days, ${Math.round((gameRules.wyrm.respawnScalar - 1) * 100)}% worse.{/}`, 'dim'),
    ],
    character: next,
    view: { kind: 'hub' },
  };
}

/* ------------------------------------------------------------------ */
/* Read-only screens                                                   */
/* ------------------------------------------------------------------ */

export function characterSheet(ctx: FlowContext): Step {
  const c = ctx.character;
  const weapon = itemById(c.weaponId);
  const armor = itemById(c.armorId);
  const titleText = c.titles.length ? c.titles.join(', ') : '\u2014';

  return {
    lines: [
      line('CHARACTER SHEET', 'bright'),
      line(`{bright}${c.name}{/}  \u2014  ${c.class}, level ${toRoman(c.level)}`),
      line(''),
      line(`  Health      ${c.hp} / ${c.maxHp}`),
      c.class === 'magician' ? line(`  Mana        ${c.mana}`) : line(''),
      line(`  Strength    ${c.str}`),
      line(`  Defense     ${c.def}`),
      line(`  Agility     ${c.agi}`),
      line(`  Charm       ${c.chm}`),
      line(''),
      line(`  Weapon      ${weapon.name} (+${weapon.power})`),
      line(`  Armor       ${armor.name} (+${armor.power})`),
      line(''),
      line(`  Gold        ${c.gold}`),
      line(`  Banked      ${c.banked}`),
      line(`  Gems        ${c.gems}`),
      line(''),
      line(`  Kills       ${c.playerKills}`),
      line(`  Deaths      ${c.deaths}`),
      line(`  Turns       ${c.turnsRemaining}`),
      line(`  Titles      ${titleText}`, c.titles.length ? 'gold' : 'dim'),
      line(''),
      line(`{dim}Experience ${c.xp}${c.level < gameRules.maxLevel ? ` / ${gameRules.xpTable[c.level + 1]}` : ' (max)'}{/}`, 'dim'),
    ],
    character: c,
    view: { kind: 'character' },
  };
}

export function whoIsWhoScreen(ctx: FlowContext): Step {
  const all = roster(ctx).filter((r) => !r.character.retired);
  const ranked = [...all].sort((a, b) => b.character.xp - a.character.xp).slice(0, 10);

  const lines: CombatLine[] = [
    line(whoIsWho.header, 'bright'),
    line(whoIsWho.sub, 'dim'),
    line(''),
    line(whoIsWho.columns, 'dim'),
  ];

  if (ranked.length === 0) {
    lines.push(line(whoIsWho.empty, 'dim'));
  }

  ranked.forEach((row, i) => {
    const c = row.character;
    const isSelf = c.name.trim().toLowerCase() === ctx.character.name.trim().toLowerCase();
    const title = c.titles[0] ?? '';

    lines.push(
      line(
        `  ${String(i + 1).padStart(2)}  ${c.name.padEnd(16)} ${c.class.padEnd(9)} ${toRoman(c.level).padStart(4)}  ${String(
          c.playerKills,
        ).padStart(5)}  ${title}${row.resident ? '  {dim}[sim]{/}' : isSelf ? '  {gold}[you]{/}' : ''}`,
        i === 0 ? 'bright' : 'normal',
      ),
    );
  });

  lines.push(line(''), line(whoIsWho.footer, 'dim'));

  return { lines, character: ctx.character, view: { kind: 'who' } };
}

export function hallScreen(ctx: FlowContext): Step {
  const entries = [...ctx.hall, ...residentHall(ctx)].sort((a, b) => a.date.localeCompare(b.date));

  const lines: CombatLine[] = [
    line('HALL OF FAME', 'bright'),
    line('All who have slain the Ashen Wyrm, oldest first.', 'dim'),
    line(''),
    line('  DATE        NAME             CLASS       DAYS', 'dim'),
  ];

  if (entries.length === 0) {
    lines.push(line('No one has killed it yet. The wyrm knows this.', 'dim'));
  }

  entries.forEach((e) => {
    lines.push(
      line(
        `  ${e.date}  ${e.name.padEnd(16)} ${e.class.padEnd(11)} ${String(e.daysTaken).padStart(4)}${e.resident ? '  {dim}[resident]{/}' : ''}`,
        'gold',
      ),
    );
  });

  lines.push(line(''), line(`{dim}Days taken is real days, not turns. Patience is a stat.${' '}{/}`, 'dim'));

  return { lines, character: ctx.character, view: { kind: 'hall' } };
}

function residentHall(ctx: FlowContext): HallEntry[] {
  return ctx.residents
    .filter((r) => r.character.isWyrmbane)
    .map((r) => ({
      name: r.character.name,
      class: r.character.class,
      date: r.character.createdAt.slice(0, 10),
      daysTaken: 1,
      resident: true,
    }));
}

/* ------------------------------------------------------------------ */
/* The realm feed                                                      */
/* ------------------------------------------------------------------ */

export function feedLines(feed: FeedEntry[]): CombatLine[] {
  if (feed.length === 0) return [line('{dim}The realm feed is quiet.{/}', 'dim')];
  return feed.slice(0, 8).map((f) => line(`{dim}${f.text}{/}`, 'dim'));
}

export const flowHelpers = {
  dayKey,
  line,
  linesFrom,
  roster,
  pvpTargets,
};
