/**
 * Core data types for the Ashen Wyrm engine.
 *
 * This module is framework-free. It is imported by pure engine logic, by
 * headless tests, and by the React layer — but it imports nothing from React.
 */

export type CharacterClass = 'warrior' | 'magician' | 'thief';
export type Sex = 'm' | 'f';

export interface Character {
  name: string;
  sex: Sex;
  class: CharacterClass;

  level: number;
  xp: number;

  hp: number;
  maxHp: number;
  mana: number;

  str: number;
  def: number;
  agi: number;
  chm: number;

  gold: number;
  banked: number;
  gems: number;

  weaponId: string;
  armorId: string;

  turnsRemaining: number;
  /** UTC 'YYYY-MM-DD'. See rules.dayKey and engine/save.ts rollover. */
  lastTurnResetDay: string;

  playerKills: number;
  deaths: number;

  /** 0–5. See content/strings.ts wrenDialogue and engine/town.ts. */
  wrenStage: number;

  isWyrmbane: boolean;
  retired: boolean;
  createdAt: string;

  /** UTC 'YYYY-MM-DD' of the last wyrm attempt, or null. One per day. */
  wyrmAttemptDay: string | null;

  /** UTC ms timestamp the wyrm becomes available again (after a win + continue). */
  wyrmRespawnAt: number;

  /** Permanent honorifics, e.g. "Wyrmbane", "Wren's Beloved". */
  titles: string[];

  /** Spell ids known. Magicians begin with Spark; others usually empty. */
  spells: string[];
}

export interface HallEntry {
  name: string;
  class: CharacterClass;
  date: string;
  daysTaken: number;
  /** True for the six simulated residents, false for real players. */
  resident: boolean;
}

export type FeedKind = 'pvp' | 'steal' | 'wyrm' | 'level' | 'resident';

export interface FeedEntry {
  id: string;
  /** UTC ms timestamp. */
  at: number;
  kind: FeedKind;
  /** Rendered with inline markup. */
  text: string;
}

/** A resident adventurer — an ordinary Character plus presentation metadata. */
export interface Resident {
  character: Character;
  bio: string;
  /** Weighting of how the resident spends turns: fight-heavy vs. theft-heavy. */
  aggression: number;
}

export interface Settings {
  theme: 'green' | 'amber';
  scanlines: boolean;
  flicker: boolean;
  grain: boolean;
  curvature: boolean;
  sound: boolean;
  /** Typewriter speed in ms per character. 0 = instant. */
  typewriterMs: number;
  contrastBoost: boolean;
}

export interface SaveFile {
  version: number;
  realmId: string;
  character: Character;
  hallOfFame: HallEntry[];
  realmFeed: FeedEntry[];
  residents: Resident[];
  settings: Settings;
  /** UTC 'YYYY-MM-DD' the residents last progressed. */
  residentsProgressedDay: string;
}

/* ------------------------------------------------------------------ */
/* Combat                                                              */
/* ------------------------------------------------------------------ */

export interface Monster {
  id: string;
  name: string;
  tier: number;
  hp: number;
  atk: number;
  xp: number;
  gold: number;
  /** Derived from tier in content/monsters.ts. */
  def: number;
  /** One-line appearance text. */
  desc: string;
}

export interface Combatant {
  name: string;
  hp: number;
  maxHp: number;
  /** Total attack power: STR + weapon damage. */
  atk: number;
  /** Total defense: DEF + armor value. */
  def: number;
  agi: number;
  isThief: boolean;
}

export interface CombatLine {
  text: string;
  tone?: 'normal' | 'bright' | 'dim' | 'red' | 'gold';
  /**
   * Monotonic id assigned by the session reducer when the line is appended.
   *
   * The typewriter needs to know which lines are new. Comparing lengths breaks
   * as soon as the log is trimmed to a cap — the count stops changing, so new
   * lines are never animated. A sequence number survives trimming.
   */
  seq?: number;
}

export interface CombatRound {
  lines: CombatLine[];
  playerHp: number;
  monsterHp: number;
  /** True when the monster's attack is skipped this round. */
  monsterAsleep: boolean;
}

export interface CombatantState {
  hp: number;
  defBonus: number;
  asleep: boolean;
}

export interface CombatState {
  player: CombatantState;
  monster: CombatantState;
  round: number;
  /** Accumulated narrative for the encounter. */
  lines: CombatLine[];
  over: boolean;
  playerWon: boolean;
}

/* ------------------------------------------------------------------ */
/* Encounters                                                          */
/* ------------------------------------------------------------------ */

export type EncounterId =
  | 'soldier'
  | 'gypsy'
  | 'stranger'
  | 'wizard'
  | 'shrine'
  | 'peddler';

export type Outcome = 'win' | 'lose' | 'flee';

/**
 * A single resolution step produced by an engine call. The UI renders these
 * lines and the state layer applies the resulting character mutation.
 */
export interface Report {
  lines: CombatLine[];
  /** Warning flag the UI can use to shake / tint the screen. */
  danger?: boolean;
}

export type GameEventKind =
  | 'levelUp'
  | 'death'
  | 'victory'
  | 'steal'
  | 'pvpWin'
  | 'pvpLoss'
  | 'wyrmSlain'
  | 'realm';

export interface GameEvent {
  kind: GameEventKind;
  text: string;
}

/* ------------------------------------------------------------------ */
/* RNG                                                                 */
/* ------------------------------------------------------------------ */

export type Rng = () => number;

/** A single-keypress question the terminal is waiting on. */
export interface Prompt {
  label: string;
  /** Accepts single keys, e.g. ['y','n'] or ['1','2','3']. */
  keys: string[];
  hint?: string;
}
