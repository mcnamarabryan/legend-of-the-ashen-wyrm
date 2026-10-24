/**
 * DURABILITY PROOF.
 *
 * Every other test in this project would pass with an in-memory realm. This one
 * cannot: it creates a character, kills the server, starts a new one against the
 * same database file, and asks whether the character is still there.
 *
 *   npx tsx scripts/persistence.ts
 *
 * Run it with no server already listening on the port; it starts its own.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';

const PORT = 8899;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = '/tmp/wyrm-persistence-test.sqlite';

interface Wire {
  view: string;
  lines: { text: string }[];
  character: { name: string; turnsRemaining: number; gold: number } | null;
  slots: { name: string }[];
}

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function startServer(): ChildProcess {
  const child = spawn('npx', ['tsx', 'server/index.ts'], {
    env: { ...process.env, PORT: String(PORT), WYRM_DB: DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function waitForHealth(timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function newSession(): Promise<string> {
  const r = await fetch(`${BASE}/api/session`, { method: 'POST' });
  return ((await r.json()) as { token: string }).token;
}

async function send(token: string, key: string): Promise<Wire> {
  const r = await fetch(`${BASE}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ key }),
  });
  const body = (await r.json()) as { ok: boolean; screen?: Wire; error?: string };
  if (!body.ok || !body.screen) throw new Error(body.error ?? 'no screen');
  return body.screen;
}

function stop(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    /* Belt and braces: if SIGTERM is ignored, SIGKILL after a moment. */
    setTimeout(() => child.kill('SIGKILL'), 2000);
  });
}

async function main() {
  if (existsSync(DB)) rmSync(DB);
  console.log('\npersistence test\n');

  /* ---- first life: create a character and change its state ---- */
  let server = startServer();
  check('server starts', await waitForHealth());

  const stamp = Date.now().toString(36).replace(/[^a-z]/gi, '').slice(-6) || 'abcde';
  const name = `Keep${stamp}`;
  const token = await newSession();

  await send(token, 'n');
  for (const c of name) await send(token, c);
  await send(token, 'enter');
  await send(token, 'f');

  const made = await send(token, 'w');
  check('character created', made.character?.name === name, String(made.character?.name));

  /* Spend a turn so there is a state change worth preserving. */
  await send(token, 'escape');
  await send(token, 'f');
  await send(token, 'escape');
  const before = await send(token, 'c');
  const turnsBefore = before.character?.turnsRemaining ?? -1;
  console.log(`     turns before restart: ${turnsBefore}`);

  check('database file was written', existsSync(DB));

  /* ---- kill the server ---- */
  await stop(server);
  check('server stopped', true);
  console.log('     --- server killed ---');

  /* ---- second life: brand new process, same database ---- */
  server = startServer();
  check('server restarts', await waitForHealth());

  /* A brand-new session, exactly like a browser reload. */
  const token2 = await newSession();
  const boot = await send(token2, 'escape');

  /*
   * The character must exist in the realm even though this token never created
   * it. That is the whole point: the save survived the process.
   */
  const listed = boot.slots.some((s) => s.name === name);
  check('character survives the restart', listed, JSON.stringify(boot.slots.map((s) => s.name)));

  /* And the original token still works — it is the owner, resurrected from the
     database. Reloading the page in a browser sends exactly this. */
  const resumed = await send(token, 'c');
  check(
    'original token still resumes the character',
    resumed.character?.name === name,
    String(resumed.character?.name),
  );
  check(
    'state matched what was saved',
    resumed.character?.turnsRemaining === turnsBefore,
    `expected ${turnsBefore}, got ${resumed.character?.turnsRemaining}`,
  );

  await stop(server);

  console.log(failures === 0 ? '\npersistence WORKS\n' : `\n${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
