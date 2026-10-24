import type { ClientLine } from '../state/client';
import type { SoundName } from './SoundEngine';

/**
 * READING THE ROOM.
 *
 * The client has no game state — that is the whole point of the architecture.
 * So it cannot ask "did I level up?" It can only read the sentences the server
 * sent and decide which ones sound like what.
 *
 * That sounds fragile and is, in fact, exactly right: the server already
 * commits to a tone when it writes a line (`red` for damage, `gold` for loot),
 * and that tone IS the semantic signal. Matching on prose is the fallback.
 *
 * Rules are ordered most-specific first. A critical hit line carries the crit
 * wording, so it is tested before the generic damage pattern.
 */

interface Rule {
  sound: SoundName;
  test: (line: ClientLine, text: string) => boolean;
}

const has = (text: string, ...needles: string[]) =>
  needles.some((n) => text.toLowerCase().includes(n));

const RULES: Rule[] = [
  /* ---- the loud, rare ones ------------------------------------- */
  {
    sound: 'level',
    test: (_l, t) => has(t, 'reached level', 'feel whole again'),
  },
  {
    sound: 'death',
    test: (_l, t) => has(t, 'straw pallet', 'heartbeat', 'ground comes up', 'you have lost'),
  },
  {
    sound: 'wyrm',
    test: (_l, t) => has(t, 'ashen wyrm', 'strikes twice', 'the wyrm'),
  },
  {
    sound: 'crit',
    test: (_l, t) => has(t, 'critical blow', 'critical'),
  },

  /* ---- coins ---------------------------------------------------- */
  {
    sound: 'loot',
    test: (_l, t) => has(t, 'gold', 'gem', 'experience'),
  },

  /* ---- blows ---------------------------------------------------- */
  {
    sound: 'miss',
    test: (_l, t) => has(t, 'swing wide', 'goes where', 'footing slips', 'misses', 'glances off', 'slip aside', 'overreaches'),
  },
  {
    sound: 'hurt',
    test: (l, t) =>
      l.tone === 'red' ||
      has(t, 'damage.', 'claws rake', 'too slow'),
  },
  {
    sound: 'hit',
    test: (_l, t) =>
      has(t, 'damage', 'your blade finds', 'steel meets', 'open a line', 'put your weight'),
  },
];

/**
 * Which sound, if any, this line should make.
 *
 * Returns null for prose. Silence is the default and most lines earn it — a
 * terminal that beeps at every sentence is an unpleasant terminal.
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
 * Collapse a whole batch into the sounds worth playing.
 *
 * A fight produces a dozen damage lines. Playing a thud for each one turns a
 * two-second exchange into a drum solo. So a batch yields at most one combat
 * impact (the most severe present) plus any rare event, which is how a real
 * game would mix it.
 */
const SEVERITY: Record<string, number> = {
  miss: 0,
  hit: 1,
  hurt: 2,
  crit: 3,
};

export function soundsForBatch(lines: ClientLine[]): SoundName[] {
  const rare: SoundName[] = [];
  let combat: SoundName | null = null;

  for (const line of lines) {
    const s = soundForLine(line);
    if (!s) continue;

    if (s in SEVERITY) {
      if (combat === null || SEVERITY[s] > SEVERITY[combat]) combat = s;
      continue;
    }
    if (!rare.includes(s)) rare.push(s);
  }

  /* Rare events first (a level-up should not be buried under a sword hit),
     then the single strongest impact. */
  return combat ? [...rare, combat] : rare;
}

/**
 * A keypress sound varies by what the key means.
 *
 * `select` for committing, `back` for leaving, `key` for everything else. The
 * distinctions are small but they are the difference between a keyboard and a
 * click track.
 */
export function soundForKey(key: string): SoundName {
  const k = key.toLowerCase();
  if (k === 'escape') return 'back';
  if (k === 'enter') return 'select';
  return 'key';
}
