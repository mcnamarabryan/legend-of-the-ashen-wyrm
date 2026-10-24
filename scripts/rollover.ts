/**
 * Verify the day rollover fires through the server.
 *
 * The unit tests cover `rolloverDay` itself; what they could not catch was that
 * nothing ever called it. This drives the real HTTP path: create a character,
 * spend its turns, then spoof a "tomorrow" clock is NOT possible from outside —
 * the server uses its own clock. So instead this asserts the behaviour we can
 * observe today: turns are spent exactly once, and the rollover line does not
 * appear (because it is still the same UTC day).
 *
 * The real proof of the rollover is `server/game.ts` calling `rolloverDay` on
 * every command, plus the idempotency tests. This script keeps the observable
 * half honest.
 */

export {};

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';

interface Wire {
  view: string;
  lines: { text: string }[];
  character: { name: string; turnsRemaining: number } | null;
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
  return ((await r.json()) as { screen: Wire }).screen;
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

async function main() {
  const stamp = Date.now().toString(36).replace(/[^a-z]/gi, '').slice(-6) || 'abcde';
  const name = `Roll${stamp}`;

  const token = await newSession();
  await send(token, 'n');
  for (const c of name) await send(token, c);
  await send(token, 'enter');
  await send(token, 'f');

  const made = await send(token, 'w');
  check('character created', made.character?.name === name, String(made.character?.name));
  check('starts at ten turns', made.character?.turnsRemaining === 10);

  /* Burn everything. */
  for (let i = 0; i < 16; i += 1) {
    const s = await send(token, 'f');
    if (s.view === 'forest') await send(token, 'n');
  }

  /* Back to the hub first: `c` switches the view to `character`, which has no
     handler for `f`. Leaving the screen is the difference between testing the
     game and testing my own script. */
  await send(token, 'escape');
  const spent = await send(token, 'c');
  const turnsLine = spent.lines.map((l) => l.text).find((t) => t.includes('Turns'));
  check('turns reach zero', /Turns\s+0/.test(turnsLine ?? ''), String(turnsLine));

  /* A further fight must not go negative or resurrect a turn. */
  await send(token, 'escape');
  await send(token, 'f');
  await send(token, 'escape');
  const after = await send(token, 'c');
  const afterLine = after.lines.map((l) => l.text).find((t) => t.includes('Turns'));
  check('turns stay at zero', /Turns\s+0/.test(afterLine ?? ''), String(afterLine));

  /* No rollover line today — the clock has not moved. */
  const sawRollover = [...spent.lines, ...after.lines].some((l) =>
    l.text.includes('A new day'),
  );
  check('no phantom rollover on the same day', !sawRollover);

  console.log(failures === 0 ? '\nrollover probe passed\n' : `\n${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
