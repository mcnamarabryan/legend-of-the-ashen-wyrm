/**
 * Read a vitest log and print only the summary lines, with ANSI stripped.
 *
 * Exists because the shell in this container cannot run `grep` or `tr`, and
 * piping through `node -e` fights the quoting rules. A file is honest.
 *
 *   npx vitest run --reporter=verbose > /tmp/vt.log 2>&1
 *   node scripts/vitest-summary.mjs /tmp/vt.log
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2] ?? '/tmp/vt.log';

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch {
  console.log(`(no log at ${path})`);
  process.exit(2);
}

/* Strip CSI sequences: colour, cursor movement, erase. */
const clean = raw.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r/g, '');

const lines = clean.split('\n');

const summary = lines.filter((l) =>
  /Test Files|Tests\s+\d|Tests\s+.*failed|FAIL|×|failed \|/.test(l),
);

console.log(summary.length > 0 ? summary.join('\n') : '(no summary lines found)');

/* Also report whether the run reported failure at all. */
const failed = /failed/.test(clean);
process.exit(failed ? 1 : 0);
