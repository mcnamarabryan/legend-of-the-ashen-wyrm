/**
 * PROOF: the typed name is visible.
 *
 * The reported bug was that you could not see the name as you entered it. The
 * cause was not a rendering problem — it was that the server returned nothing at
 * all for each keystroke, so there was nothing to render. The client cannot fix
 * that on its own, because the name is server-owned state and the browser has no
 * input buffer to echo from.
 *
 * So the test is about the wire, not the DOM: after every keystroke the screen
 * must carry the accumulated value. If this passes, the UI has something true to
 * display.
 *
 *   npx tsx scripts/entry.ts
 */

export {};

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';

interface Entry {
  label: string;
  value: string;
  hint?: string;
  max?: number;
}

interface Wire {
  view: string;
  lines: { text: string }[];
  character: { name: string } | null;
  entry: Entry | null;
  prompt: { label: string; keys: string[] } | null;
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

async function main() {
  /* Unique per run; the name pattern allows no digits, so strip them. */
  const stamp = Date.now()
    .toString(36)
    .replace(/[^a-z]/gi, '')
    .slice(-5);
  const NAME = `Ent${stamp || 'abcde'}`;

  console.log('\ntext-entry probe\n');

  const token = await newSession();

  /* ---- open the name prompt ---- */
  await send(token, 'n');
  let screen = await send(token, 'a');

  check('a name field appears', screen.entry !== null);
  check('the label is the question', screen.entry?.label === 'WHAT IS YOUR NAME?');
  check('the field starts with what was typed', screen.entry?.value === 'a', screen.entry?.value);
  check('the field carries the limit', screen.entry?.max === 16);

  /* ---- each keystroke accumulates ---- */
  await send(token, 'r');
  screen = await send(token, 'i');
  check('the value accumulates', screen.entry?.value === 'ari', screen.entry?.value);

  /* ---- backspace removes the last character ---- */
  screen = await send(token, 'backspace');
  check('backspace is reflected', screen.entry?.value === 'ar', screen.entry?.value);

  /* ---- a rejected character does not appear ---- */
  screen = await send(token, '1');
  check('digits are refused, value unchanged', screen.entry?.value === 'ar', screen.entry?.value);

  /* ---- case is preserved, which is why raw is sent ---- */
  screen = await send(token, 'A');
  check('case survives the round trip', screen.entry?.value === 'arA', screen.entry?.value);

  /* ---- build the rest of the name and confirm ---- */
  for (const ch of NAME.slice(3)) await send(token, ch);
  screen = await send(token, 'enter');

  check('Enter leaves the name step', screen.view === 'create' && screen.entry === null);
  check(
    'the field is gone once the step advances',
    screen.entry === null,
    JSON.stringify(screen.entry),
  );
  check(
    'the sex prompt is shown',
    (screen.lines[0]?.text ?? '').includes('how shall the realm address you'),
    screen.lines[0]?.text,
  );

  /* ---- finish creation, and confirm the name was what was typed ---- */
  await send(token, 'f');
  const created = await send(token, 'w');
  check(
    'the character keeps the typed name',
    created.character?.name === `arA${NAME.slice(3)}`.slice(0, 16),
    `${created.character?.name} (typed arA${NAME.slice(3)})`,
  );

  console.log(failures === 0 ? '\nthe typed name is visible\n' : `\n${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
