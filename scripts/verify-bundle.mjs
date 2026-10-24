import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Prove the boundary.
 *
 * Reads the production bundle and asserts that none of the game's secrets are
 * in it. If this fails, a rules file has leaked into the client and the "server
 * is authoritative" claim is a lie.
 */

const DIST = 'dist/assets';

/* Things that exist only in server/engine or server/content. If any of these
   appear in the browser bundle, the client can compute outcomes locally. */
const FORBIDDEN = [
  { label: 'XP table value (19000)', needle: '19000' },
  { label: 'wyrm stat (400 hp)', needle: '"ashen-wyrm"' },
  { label: 'monster table', needle: 'Field Rat' },
  { label: 'monster table', needle: 'mud-kobold' },
  { label: 'item stat', needle: 'runed-blade' },
  { label: 'resident seed', needle: 'Grimwold' },
  { label: 'Wren dialogue', needle: 'Wren' },
  { label: 'rules: hit chance', needle: 'thiefDodge' },
  { label: 'rules: xpTable', needle: 'xpTable' },
  { label: 'engine: resolveFight', needle: 'resolveFight' },
];

let failures = 0;

function check(label, ok, detail = '') {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
if (files.length === 0) {
  console.error('no built JS found — run `npx vite build` first');
  process.exit(1);
}

const bundle = files.map((f) => readFileSync(join(DIST, f), 'utf8')).join('\n');

console.log(`\nbundle check: ${files.join(', ')} (${Math.round(bundle.length / 1024)} kB)\n`);

for (const { label, needle } of FORBIDDEN) {
  check(`${label} is absent`, !bundle.includes(needle), `found "${needle}"`);
}

/* Sanity: the client must still contain the things it genuinely needs. */
check('client still ships the typewriter', bundle.includes('requestAnimationFrame'));
check('client still ships the CRT markup parser', bundle.includes('t-bright'));

console.log(
  failures === 0
    ? '\nthe client holds no rules. the boundary holds.\n'
    : `\n${failures} leak(s) found\n`,
);
process.exit(failures === 0 ? 0 : 1);
