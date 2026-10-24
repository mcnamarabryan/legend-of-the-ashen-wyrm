/**
 * Types the CLIENT owns.
 *
 * These are deliberately duplicated rather than imported. The browser must not
 * reach into `server/engine/` even for a type, because a single type import is
 * how a rules file ends up in the bundle. Duplication here is the boundary.
 */

/** One line of narrative. Markup is the only structure the client parses. */
export interface CombatLine {
  text: string;
  tone?: 'normal' | 'bright' | 'dim' | 'red' | 'gold';
}

/** Presentation settings. Local by nature — they change nothing the server knows. */
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
