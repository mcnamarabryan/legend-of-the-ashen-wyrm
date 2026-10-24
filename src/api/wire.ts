import type { CombatLine, Settings } from './types';

/**
 * THE WIRE — client side.
 *
 * Every field here arrived from the server. Absent on purpose: monsters, XP
 * tables, damage formulas, item stats, the wyrm's health, the RNG.
 */

export interface SlotSummary {
  name: string;
  className: string;
  level: number;
  levelRoman: string;
  title: string;
  retired: boolean;
  turnsRemaining: number;
}

export interface HeaderCharacter {
  name: string;
  className: string;
  level: number;
  levelRoman: string;
  title: string;
  hp: number;
  maxHp: number;
  gold: number;
  gems: number;
  turnsRemaining: number;
  weaponPower: number;
  armorPower: number;
  /**
   * The item ids currently equipped.
   *
   * Carried so the client can choose the right combat *sound* — steel, a chop,
   * a crush, a stab — without duplicating item stats. An id is a name, not a
   * rule: it tells the browser which of its own sound designs to use and
   * nothing about damage, price or progression. The boundary holds.
   */
  weaponId: string;
  armorId: string;
  retired: boolean;
}

export interface MenuEntry {
  key: string;
  label: string;
}

export interface WirePrompt {
  label: string;
  keys: string[];
  hint?: string;
}

/**
 * LIVE TEXT ENTRY.
 *
 * Creation's name step is the one place the player types free text, and it is
 * the one place a keystroke produces no narrative. Without an echo the screen
 * is simply blank while you type — you cannot see what you are entering, which
 * makes backspacing to fix a typo a guess.
 *
 * The echo travels on the wire because the name is server-owned state: the
 * server is the thing accumulating the keystrokes, so the server is the thing
 * that knows what has been typed. The client renders `value` verbatim and never
 * buffers input of its own — keeping the single-mutation-path rule intact.
 */
export interface WireEntry {
  /** The question being answered, e.g. WHAT IS YOUR NAME? */
  label: string;
  /** What has been typed so far. May be empty. */
  value: string;
  hint?: string;
  /** Character limit, so the client can show a counter. */
  max?: number;
}

/** One rendered screen. This is the entire game as far as the client knows. */
export interface Screen {
  view: string;
  /** New narrative lines, already written. */
  lines: CombatLine[];
  character: HeaderCharacter | null;
  prompt: WirePrompt | null;
  menu: MenuEntry[] | null;
  /** Live text entry, or null when no field is being filled in. */
  entry: WireEntry | null;
  slots: SlotSummary[];
  feed: string[];
}

export interface CommandResponse {
  ok: boolean;
  screen?: Screen;
  error?: string;
}

export interface SessionResponse {
  ok: boolean;
  token?: string;
  screen?: Screen;
  error?: string;
}

export type { CombatLine, Settings };
