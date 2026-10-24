import type { Character, CombatLine } from './types';
import { gameRules, dayKey } from './rules';
import { armorById, buybackValue, itemById, weaponById } from '../content/items';
import * as msg from '../content/strings';

/**
 * Economy: the bank, the shop, the healer, and the death penalty.
 * All pure. Every number comes from rules.ts.
 */

/* ------------------------------------------------------------------ */
/* Bank                                                                */
/* ------------------------------------------------------------------ */

export function bankDeposit(c: Character, amount: number): Character {
  const n = Math.max(0, Math.floor(amount));
  const room = Math.max(0, gameRules.bank.cap - c.banked);
  const moved = Math.min(n, c.gold, room);
  return { ...c, gold: c.gold - moved, banked: c.banked + moved };
}

export function bankWithdraw(c: Character, amount: number): Character {
  const n = Math.max(0, Math.floor(amount));
  const moved = Math.min(n, c.banked);
  return { ...c, banked: c.banked - moved, gold: c.gold + moved };
}

/**
 * 2% daily interest, capped at 5,000 banked. Called from the day rollover.
 * Returns the interest actually paid so the UI can report it.
 */
export function applyDailyInterest(c: Character): { character: Character; interest: number } {
  const base = Math.min(c.banked, gameRules.bank.cap);
  if (base <= 0) return { character: c, interest: 0 };
  const interest = Math.floor(base * gameRules.bank.interestPct);
  if (interest <= 0) return { character: c, interest: 0 };
  return { character: { ...c, banked: c.banked + interest }, interest };
}

/* ------------------------------------------------------------------ */
/* Shop                                                                */
/* ------------------------------------------------------------------ */

export interface PurchaseResult {
  character: Character;
  ok: boolean;
  line: CombatLine;
}

export function buyItem(c: Character, itemId: string): PurchaseResult {
  const item = itemById(itemId);
  if (item.price <= 0) {
    return { character: c, ok: false, line: { text: msg.shop.notEnoughGold, tone: 'red' } };
  }
  if (c.gold < item.price) {
    return { character: c, ok: false, line: { text: msg.shop.notEnoughGold, tone: 'red' } };
  }
  if (c.gems < item.gems) {
    return { character: c, ok: false, line: { text: msg.shop.notEnoughGems, tone: 'red' } };
  }

  const next: Character = {
    ...c,
    gold: c.gold - item.price,
    gems: c.gems - item.gems,
  };
  if (item.kind === 'weapon') next.weaponId = item.id;
  else next.armorId = item.id;

  return { character: next, ok: true, line: { text: msg.shop.bought(item.name), tone: 'bright' } };
}

export interface SaleResult {
  character: Character;
  ok: boolean;
  line: CombatLine;
}

/**
 * Sell the currently equipped weapon or armor.
 *
 * You cannot sell your class's starting kit — that is your last resort, and with
 * a buyback of 0 gold there is nothing to gain by it anyway. Everything you
 * bought is fair game, and selling it drops you back to your starter.
 *
 * The fallback is per class. It used to be a hardcoded 'rusty-dagger'/'rags',
 * which would have quietly turned a magician's wand into a dagger the moment
 * they sold a sword — a class change nobody asked for.
 */
export function sellEquipped(c: Character, kind: 'weapon' | 'armor'): SaleResult {
  const id = kind === 'weapon' ? c.weaponId : c.armorId;
  const item = itemById(id);

  if (item.starting) {
    return { character: c, ok: false, line: { text: msg.shop.cannotSellLast, tone: 'dim' } };
  }

  const kit = gameRules.start.kits[c.class] ?? gameRules.start.kits.warrior;
  const gold = buybackValue(item, gameRules.shop.buybackPct);
  const next: Character = { ...c, gold: c.gold + gold };
  if (kind === 'weapon') next.weaponId = kit.weaponId;
  else next.armorId = kit.armorId;

  return {
    character: next,
    ok: true,
    line: { text: msg.shop.sold(item.name, gold), tone: 'dim' },
  };
}

export function equippedSummary(c: Character): { weapon: string; armor: string; atk: number; def: number } {
  const w = weaponById(c.weaponId);
  const a = armorById(c.armorId);
  const penalty = w.armorPenalty ?? 0;
  return {
    weapon: w.name,
    armor: a.name,
    atk: w.power,
    def: Math.max(0, a.power - penalty),
  };
}

/* ------------------------------------------------------------------ */
/* Healer                                                              */
/* ------------------------------------------------------------------ */

/** Cost of a full heal: 1 gold per missing HP, minimum 5 when wounded. */
export function healCost(c: Character): number {
  const missing = Math.max(0, c.maxHp - c.hp);
  if (missing === 0) return 0;
  return Math.max(5, missing);
}

export function healFully(c: Character): { character: Character; ok: boolean; line: CombatLine } {
  const cost = healCost(c);
  if (cost === 0) {
    return { character: c, ok: false, line: { text: msg.healer.alreadyFull, tone: 'dim' } };
  }
  if (c.gold < cost) {
    return { character: c, ok: false, line: { text: msg.healer.noGold, tone: 'red' } };
  }
  return {
    character: { ...c, gold: c.gold - cost, hp: c.maxHp },
    ok: true,
    line: { text: msg.healer.healed, tone: 'bright' },
  };
}

/* ------------------------------------------------------------------ */
/* Death                                                               */
/* ------------------------------------------------------------------ */

export interface DeathResult {
  character: Character;
  lines: CombatLine[];
}

/**
 * Death is not permadeath. Lose 25% of carried gold and 10% of progress
 * through the current level, then wake at the healer at half health.
 */
export function applyDeath(c: Character, rng: () => number): DeathResult {
  const goldLost = Math.floor(c.gold * gameRules.death.goldLossPct);
  const floorXp = levelFloorXp(c.level);
  const progress = Math.max(0, c.xp - floorXp);
  const xpLost = Math.floor(progress * gameRules.death.xpLossPct);

  const next: Character = {
    ...c,
    gold: c.gold - goldLost,
    xp: Math.max(floorXp, c.xp - xpLost),
    hp: Math.max(1, Math.round(c.maxHp * gameRules.death.reviveHpPct)),
    deaths: c.deaths + 1,
  };

  const variant = msg.death.variants[Math.floor(rng() * msg.death.variants.length)];

  const lines: CombatLine[] = [{ text: variant, tone: 'dim' }];
  if (goldLost > 0) lines.push({ text: msg.death.goldLost(goldLost), tone: 'red' });
  if (xpLost > 0) lines.push({ text: msg.death.xpLost(xpLost), tone: 'dim' });
  lines.push({ text: msg.death.revive(next.hp), tone: 'dim' });

  return { character: next, lines };
}

/** XP required to have reached this level — the floor we never drop below. */
function levelFloorXp(level: number): number {
  // Imported lazily to avoid a cycle through rules -> progression -> economy.
  const table = gameRules.xpTable;
  const idx = Math.max(1, Math.min(level, gameRules.maxLevel));
  return table[idx];
}

/* ------------------------------------------------------------------ */
/* Turns                                                               */
/* ------------------------------------------------------------------ */

export function hasTurns(c: Character): boolean {
  return c.turnsRemaining > 0;
}

export function spendTurn(c: Character): Character {
  return { ...c, turnsRemaining: Math.max(0, c.turnsRemaining - 1) };
}

export interface RolloverResult {
  character: Character;
  rolled: boolean;
  interest: number;
  today: string;
}

/**
 * The day rollover. Idempotent by construction: if the stored day already
 * matches today, nothing happens. Never grants retroactive turns.
 */
export function rolloverDay(c: Character, now: number = Date.now()): RolloverResult {
  const today = dayKey(now);
  if (c.lastTurnResetDay === today) {
    return { character: c, rolled: false, interest: 0, today };
  }

  const withTurns: Character = {
    ...c,
    turnsRemaining: gameRules.turnsPerDay,
    lastTurnResetDay: today,
    mana: maxMana(c.level),
    wyrmAttemptDay: c.wyrmAttemptDay === today ? c.wyrmAttemptDay : c.wyrmAttemptDay,
  };

  const { character, interest } = applyDailyInterest(withTurns);
  return { character, rolled: true, interest, today };
}

function maxMana(level: number): number {
  return gameRules.mana.base + gameRules.mana.perLevel * (level - 1);
}
