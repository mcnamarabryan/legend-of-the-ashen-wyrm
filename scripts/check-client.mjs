/**
 * Does Vite actually transform every client module?
 *
 * A 200 from the dev server only proves the file was read, not that it compiled.
 * Vite returns transformed JS for `.ts`/`.tsx`, so we look for the real failure
 * signals: a non-200, or an error payload with a parse/transform complaint.
 *
 * Files are DISCOVERED from disk, not listed here.
 *
 * That matters: the first version of this script held a hardcoded array, and when
 * a new component was added it silently fell outside the check — the run still
 * said "all clean" while covering one module fewer. A verification script that
 * quietly narrows its own coverage is worse than no script, because it reports
 * success. Walking `src/` means a new file is covered the moment it exists.
 *
 * Run with the dev server already listening:
 *
 *   node scripts/check-client.mjs
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const ROOT = 'src';

/** Every `.ts`/`.tsx` under src/, as a browser-servable path. */
function discover(dir = ROOT, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      discover(full, found);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    /* Vite serves project files under a leading slash, with forward slashes. */
    found.push(`/${relative('.', full).split(sep).join('/')}`);
  }
  return found;
}

/** Signals that Vite failed to transform, as opposed to merely mentioning a word. */
const FAILURES = [
  'Transform failed',
  'Internal server error',
  'Pre-transform error',
  'Failed to resolve import',
  'Parse error',
  'Unexpected token',
  'does not provide an export',
];

let failures = 0;

async function main() {
  const files = discover().sort();

  if (files.length === 0) {
    console.error('no client modules found under src/ — wrong working directory?');
    process.exit(1);
  }

  console.log(`\nclient transform check against ${BASE}\n`);

  for (const file of files) {
    let status = 0;
    let body = '';

    try {
      const res = await fetch(`${BASE}${file}`);
      status = res.status;
      body = await res.text();
    } catch (err) {
      failures += 1;
      console.log(`  FAIL  ${file} — could not fetch (${err.message})`);
      continue;
    }

    const hit = FAILURES.find((needle) => body.includes(needle));

    if (status !== 200 || hit) {
      failures += 1;
      console.log(`  FAIL  ${file} — status ${status}${hit ? `, "${hit}"` : ''}`);
      /* Show the first line that looks like the complaint. */
      const line = body.split('\n').find((l) => /error|failed|token/i.test(l));
      if (line) console.log(`        ${line.trim().slice(0, 160)}`);
      continue;
    }

    console.log(`  ok    ${file}  (${Math.round(body.length / 1024)} kB)`);
  }

  console.log(
    failures === 0
      ? `\nall ${files.length} client modules transform cleanly\n`
      : `\n${failures} of ${files.length} module(s) failed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
