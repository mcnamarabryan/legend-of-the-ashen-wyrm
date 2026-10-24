/**
 * CUE COVERAGE — does real game prose actually produce sound?
 *
 * `soundForLine` scores a narrative line by matching its wording and tone. That
 * is a heuristic, and heuristics drift: the server's copy can change and the
 * rules quietly stop matching. The failure mode is invisible — the game renders
 * perfectly and is simply silent, because nothing ever calls `play()`.
 *
 * The audio tests only check hand-written sample lines. This drives the REAL
 * flow layer, takes the prose it produces, and asks what fraction of it scores.
 *
 *   npx tsx scripts/cues-diag.ts
 */

import { buildStartingCharacter } from '../server/engine/creation';
import { createRng } from '../server/engine/rng';
import * as flow from '../server/flow';
import { soundForLine, soundsForBatch } from '../src/audio/cues';
import type { CombatLine } from '../src/api/types';

const START = Date.parse('2025-01-01T09:00:00Z');

/** Strip inline markup and the tone, as the client would receive them. */
function toClientLine(line: CombatLine, id: number) {
  return { id, text: line.text, ...(line.tone ? { tone: line.tone } : {}) };
}

function base() {
  return { residents: [], hall: [], others: [], now: START };
}

interface Sample {
  label: string;
  lines: CombatLine[];
}

function collect(): Sample[] {
  const samples: Sample[] = [];
  const rng = createRng(4242);

  const hero = buildStartingCharacter({
    name: 'Probe',
    sex: 'm',
    cls: 'warrior',
    now: new Date(START).toISOString(),
  });

  /* --- a run of forest turns, a shop, the inn, the bank, the wyrm --- */

  let character = hero;

  for (let i = 0; i < 12; i += 1) {
    const step = flow.forestTurn({ ...base(), rng: createRng(1000 + i), character });
    samples.push({ label: `forest ${i + 1}`, lines: step.lines });
    character = step.character;
    character = { ...character, turnsRemaining: 10 };
  }

  const brave = { ...hero, level: 12, xp: 19000 };
  const events: Array<[string, () => flow.Step]> = [
    ['shop', () => flow.openShop({ ...base(), rng, character: brave })],
    ['bank', () => flow.openBank({ ...base(), rng, character: brave })],
    ['healer', () => flow.openHealer({ ...base(), rng, character: brave })],
    ['inn', () => flow.openInn({ ...base(), rng, character: brave })],
    ['character sheet', () => flow.characterSheet({ ...base(), rng, character: brave })],
    ['who is who', () => flow.whoIsWhoScreen({ ...base(), rng, character: brave })],
    ['hall of fame', () => flow.hallScreen({ ...base(), rng, character: brave })],
    ['dragon offer', () => flow.openDragon({ ...base(), rng, character: brave })],
    ['face the wyrm', () => flow.faceWyrm({ ...base(), rng: createRng(77), character: brave })],
    ['wren stage 1', () => flow.talkToWren({ ...base(), rng, character: brave })],
  ];

  for (const [label, fn] of events) {
    try {
      samples.push({ label, lines: fn().lines });
    } catch (err) {
      samples.push({
        label: `${label} (THREW ${err instanceof Error ? err.message : String(err)})`,
        lines: [],
      });
    }
  }

  return samples;
}

function main(): void {
  const samples = collect();

  let totalLines = 0;
  let scoredLines = 0;
  let blank = 0;

  console.log('\n  cue coverage — real prose from the flow layer\n');

  const silentSamples: string[] = [];

  for (const sample of samples) {
    let id = 0;
    const clientLines = sample.lines.map((l) => toClientLine(l, ++id));

    const scored = clientLines.filter((l) => {
      if (l.text.trim() === '') {
        blank += 1;
        return false;
      }
      totalLines += 1;
      const s = soundForLine(l);
      if (s) scoredLines += 1;
      return Boolean(s);
    });

    const batch = soundsForBatch(clientLines);

    const tally =
      clientLines.length === 0
        ? 'no lines'
        : `${scored.length}/${clientLines.length - sample.lines.filter((l) => l.text.trim() === '').length} scored → [${batch.join(', ') || 'silent'}]`;

    if (batch.length === 0 && sample.lines.length > 0) silentSamples.push(sample.label);

    console.log(`    ${sample.label.padEnd(18)} ${tally}`);
  }

  console.log(`\n  ${scoredLines}/${totalLines} narrative lines produce a sound ` +
    `(${((scoredLines / Math.max(1, totalLines)) * 100).toFixed(0)}%)`);

  /* Which specific lines never score? The interesting ones are combat. */
  console.log('\n  unscored lines that arguably should make noise:\n');

  const keywords = [
    'damage',
    'strikes twice',
    'It falls',
    'The ground comes up',
    'reached level',
    'You buy',
    'You are restored',
    'left hand',
    'You are Wyrmbane',
  ];

  const seen = new Set<string>();
  let found = 0;

  for (const sample of samples) {
    for (const line of sample.lines) {
      const text = line.text;
      if (seen.has(text) || text.trim() === '') continue;
      seen.add(text);
      if (soundForLine(toClientLine(line, 1))) continue;

      const hit = keywords.some((k) => text.toLowerCase().includes(k.toLowerCase()));
      if (!hit) continue;

      found += 1;
      console.log(`    "${text.replace(/\{[^}]*\}/g, '').slice(0, 68)}"`);
    }
  }

  if (found === 0) console.log('    (none — every line with a combat or reward keyword scores)');

  if (silentSamples.length > 0) {
    console.log('\n  screens that produce no sound at all:');
    for (const s of silentSamples) console.log(`    ${s}`);
  }

  console.log('');
}

main();
