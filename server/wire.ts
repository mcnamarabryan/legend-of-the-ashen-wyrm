import type { CombatLine } from './engine/types';

/**
 * THE WIRE — server side.
 *
 * The contract between the authority and the browser. Everything here is safe
 * to send: it is a rendered screen, not a simulation.
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

/**
 * LIVE TEXT ENTRY — see the client copy of this interface for the reasoning.
 *
 * The name step accumulates keystrokes on the server, so the server must tell
 * the browser what has been typed. There is no client-side input buffer: the
 * single-mutation-path rule holds, and a keypress still only ever means
 * "the player pressed this".
 */
export interface WireEntry {
  label: string;
  value: string;
  hint?: string;
  max?: number;
}

export interface Screen {
  view: string;
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

export type { CombatLine };
