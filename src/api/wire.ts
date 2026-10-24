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

/** One rendered screen. This is the entire game as far as the client knows. */
export interface Screen {
  view: string;
  /** New narrative lines, already written. */
  lines: CombatLine[];
  character: HeaderCharacter | null;
  prompt: WirePrompt | null;
  menu: MenuEntry[] | null;
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
