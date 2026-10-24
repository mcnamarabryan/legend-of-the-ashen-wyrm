/**
 * Free the dev ports.
 *
 * The dev server writes `data/realm.sqlite` several times a second, and Vite's
 * watcher used to follow it and die with `EIO: dirent not found`. That has been
 * fixed by ignoring `data/` in `vite.config.ts`, but a crash still leaves orphan
 * processes holding 8787 and 5173 — and the container has no `pkill`.
 *
 * This finds anything listening on those ports and kills it, so a restart is
 * clean rather than "address already in use" followed by a silent port bump.
 *
 *   node scripts/free-ports.mjs
 */

import { execSync } from 'node:child_process';

const PORTS = [8787, 5173, 5174];

/** Every pid matching a pattern, via `ps`. Empty when nothing matches. */
function pidsMatching(pattern) {
  let out = '';
  try {
    out = execSync(`ps -A -o pid,command`, { encoding: 'utf8' });
  } catch {
    return [];
  }

  const found = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [pid, ...rest] = trimmed.split(/\s+/);
    const command = rest.join(' ');
    if (!/^\d+$/.test(pid)) continue;
    if (process.pid === Number(pid)) continue;
    if (pattern.test(command)) found.push(Number(pid));
  }
  return found;
}

function kill(pid) {
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

const targets = [
  ...pidsMatching(/tsx watch server\/index\.ts/),
  ...pidsMatching(/\bvite\b/),
  ...pidsMatching(/server\/index\.ts/),
];

const unique = [...new Set(targets)].filter((pid) => Number.isFinite(pid));

if (unique.length === 0) {
  console.log('free-ports: nothing to stop');
} else {
  for (const pid of unique) {
    const ok = kill(pid);
    console.log(`free-ports: ${ok ? 'stopped' : 'could not stop'} pid ${pid}`);
  }
}

console.log(`free-ports: done (ports ${PORTS.join(', ')})`);
