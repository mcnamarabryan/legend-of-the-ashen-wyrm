/**
 * READING THE ROOM.
 *
 * The client holds no game state — that is the whole point of the architecture.
 * So it cannot ask "did I level up?" It can only read the sentences the server
 * sent and decide which ones sound like what.
 *
 * That sounds fragile and is, in fact, exactly right: the server already commits
 * to a tone when it writes a line (`red` for damage, `gold` for loot), and that
 * tone IS the semantic signal. Prose matching is the fallback for the cases the
 * tone cannot express, like "this was a critical" versus "this was a normal hit".
 *
 * ORDER MATTERS. The rules are evaluated most-specific first. A critical hit
 * carries the word "damage", so if the generic damage rule came first every crit
 * would be scored as an ordinary hit.
 *
 * SILENCE IS THE DEFAULT. Most lines earn no sound at all. A terminal that beeps
 * at every sentence is an unpleasant terminal, and the moments that *do* make
 * noise are only meaningful because the ones around them do not.
 */

import type { ClientLine } from '../state/client';
import type { SoundName } from './SoundEngine';

interface Rule {
  sound: SoundName;
  test: (line: ClientLine, text: string) => boolean;
}

const has = (text: string, ...needles: string[]) => {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
};

const RULES: Rule[] = [
  /* ---- the loud, rare ones ------------------------------------- */
  {
    sound: 'level',
    test: (_l, t) => has(t, 'reached level', 'feel whole again'),
  },
  {
    sound: 'death',
    test: (_l, t) =>
      has(t, 'straw pallet', 'heartbeat', 'ground comes up', 'the healer is standing over you'),
  },
  {
    sound: 'wyrm',
    test: (_l, t) => has(t, 'ashen wyrm', 'strikes twice'),
  },
  {
    sound: 'heal',
    test: (_l, t) => has(t, 'you are restored', 'wounds close', 'warmth moves through'),
  },
  {
    sound: 'spell',
    test: (_l, t) => has(t, 'you cast'),
  },

  /* ---- coins ---------------------------------------------------- */
  {
    sound: 'loot',
    test: (_l, t) => has(t, 'gold', 'gem', 'experience'),
  },

  /* ---- combat --------------------------------------------------- */
  {
    sound: 'crit',
    test: (_l, t) => has(t, 'critical blow'),
  },
  {
    sound: 'dodge',
    test: (_l, t) => has(t, 'slip aside', 'thieves learn this first'),
  },
  {
    sound: 'miss',
    test: (_l, t) =>
      has(
        t,
        'swing wide',
        'goes where',
        'footing slips',
        'turns your blow aside',
        'glances off',
        'overreaches',
        'lunges and misses',
      ),
  },
  {
    sound: 'hurt',
    /* A red line is, by convention, something happening to the player. */
    test: (l, t) => l.tone === 'red' || has(t, 'claws rake', 'too slow'),
  },
  {
    sound: 'hit',
    test: (_l, t) =>
      has(
        t,
        'your blade finds',
        'steel meets',
        'open a line',
        'put your weight',
        'you hit',
        'damage',
      ),
  },

  /* ---- acknowledgement ------------------------------------------ */
  {
    sound: 'deny',
    test: (_l, t) =>
      has(
        t,
        'cannot afford',
        'no turns left',
        'out of turns',
        'already known on this node',
        'not yours to play',
        'not ready',
        'already been to the mountain',
        'would be walking out of here',
      ),
  },
];

/**
 * Which sound, if any, this line should make.
 *
 * Returns null for prose. Silence is the default and most lines earn it.
 */
export function soundForLine(line: ClientLine): SoundName | null {
  const text = line.text;
  if (!text) return null;

  for (const rule of RULES) {
    if (rule.test(line, text)) return rule.sound;
  }
  return null;
}

/**
 * Severity ranking, so a batch yields one impact rather than a drum solo.
 *
 * A single fight produces a dozen damage lines. Playing a thud for every one
 * turns a two-second exchange into a machine-gun. The ear needs one impact per
 * exchange — the loudest one — and the narrative carries the rest.
 */
const SEVERITY: Partial<Record<SoundName, number>> = {
  miss: 0,
  dodge: 1,
  hit: 2,
  hurt: 3,
  crit: 4,
};

export function soundsForBatch(lines: ClientLine[]): SoundName[] {
  const rare: SoundName[] = [];
  let combat: SoundName | null = null;

  for (const line of lines) {
    const s = soundForLine(line);
    if (!s) continue;

    const rank = SEVERITY[s];
    if (rank !== undefined) {
      const best = combat === null ? -1 : (SEVERITY[combat] ?? -1);
      if (rank > best) combat = s;
      continue;
    }

    if (!rare.includes(s)) rare.push(s);
  }

  /*
   * Rare events first, then the single strongest impact.
   *
   * A level-up should not be buried under the sword hit that earned it. Playing
   * the award before the blow that caused it also matches the reading order of
   * the log, which is what the listener is following.
   */
  return combat ? [...rare, combat] : rare;
}

/**
 * A keypress sound varies by what the key means.
 *
 * `select` for committing, `back` for leaving, `deny` never — a keypress cannot
 * know it was refused, so refusals are scored from the response text instead.
 * The distinction is small but it is the difference between a keyboard and a
 * click track.
 */
export function soundForKey(key: string): SoundName {
  const k = key.toLowerCase();
  if (k === 'escape') return 'back';
  if (k === 'enter') return 'select';
  return 'key';
}
