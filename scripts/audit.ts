/**
 * Audit: are the documented security properties actually true?
 *
 * Run against a live server. Not part of the unit suite — this drives the real
 * HTTP surface and prints what it finds, because the interesting failures here
 * are about *who is allowed to do what*, which unit tests over pure functions
 * cannot see.
 *
 *   npx tsx scripts/audit.ts
 *
 * Exported as a module so its top-level names do not collide with smoke.ts.
 */

export {};

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';

interface Wire {
  view: string;
  lines: { text: string }[];
  character: { name: string; turnsRemaining: number } | null;
  slots: { name: string }[];
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

function turnOf(s: Wire): string {
  return s.lines.map((l) => l.text).find((t) => t.includes('Turns')) ?? '(no turn line)';
}

async function main() {
  const name = `Vic${Date.now().toString(36).slice(-5)}`;

  /* ---- make a character ---- */
  const a = await newSession();
  await send(a, 'n');
  for (const c of name) await send(a, c);
  await send(a, 'enter');
  await send(a, 'f');
  const made = await send(a, 'w');
  console.log(`1. created "${made.character?.name}" with ${made.character?.turnsRemaining} turns`);

  /* ---- burn every turn ---- */
  for (let i = 0; i < 16; i += 1) {
    const s = await send(a, 'f');
    if (s.view === 'forest') await send(a, 'n');
  }
  console.log(`2. after grinding: ${turnOf(await send(a, 'c'))}`);

  /* ---- ATTACK: another session tries to claim the victim by index ---- */
  const b = await newSession();
  const boot = await send(b, '1');
  const stolen = boot.character?.name === made.character?.name;
  console.log(`3. session B pressed [1] -> ${boot.character?.name ?? boot.lines[0]?.text}`);
  console.log(`   HIJACKED? ${stolen ? 'YES — VULNERABLE' : 'no'}`);

  /* ---- ATTACK: can B spend the victim's turns? ---- */
  if (stolen) {
    const before = boot.character?.turnsRemaining;
    await send(b, 'f');
    console.log(`   B spent a turn: before ${before}, now ${turnOf(await send(b, 'c'))}`);
  }

  /* ---- duplicate names ---- */
  const c = await newSession();
  await send(c, 'n');
  for (const ch of name) await send(c, ch);
  const dup = await send(c, 'enter');
  console.log(`4. duplicate name rejected: ${dup.lines[0]?.text}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
