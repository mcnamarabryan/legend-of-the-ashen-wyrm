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

export interface Screen {
  view: string;
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

export type { CombatLine };
