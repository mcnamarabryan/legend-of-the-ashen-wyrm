/**
 * End-to-end smoke test.
 *
 * Drives the real HTTP server the way the browser does: open a session, send
 * keystrokes, assert the screens come back sane. This is the test that proves
 * the client/server split actually works over the wire, not just in theory.
 *
 *   npx tsx scripts/smoke.ts
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:8787';

interface Screen {
  view: string;
  lines: { text: string }[];
  character: { name: string; hp: number; turnsRemaining: number } | null;
  slots: { name: string }[];
  prompt: { label: string; keys: string[]; hint?: string } | null;
  menu: { key: string; label: string }[] | null;
}

let failures = 0;

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function newSession(): Promise<{ token: string; screen: Screen }> {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as { token: string; screen: Screen };
  return { token: body.token, screen: body.screen };
}

async function send(token: string, key: string): Promise<Screen> {
  const res = await fetch(`${BASE}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-session-token': token },
    body: JSON.stringify({ key }),
  });
  const body = (await res.json()) as { ok: boolean; screen?: Screen; error?: string };
  if (!body.ok || !body.screen) throw new Error(body.error ?? 'no screen');
  return body.screen;
}

async function main(): Promise<void> {
  console.log(`\nsmoke test against ${BASE}\n`);

  /*
   * A unique name per run. Two constraints bit us here already:
   *
   *  - The realm persists between runs, so a fixed name would be "taken" and
   *    cascade into a dozen false failures. Hence the timestamp.
   *  - `namePattern` is `/^[A-Za-z' -]+$/`, so NO DIGITS. `Date.now().toString(36)`
   *    contains digits, which the server silently dropped — the character was
   *    created as "Tes" and the name assertion failed for a reason that had
   *    nothing to do with the thing under test.
   *
   * So: take a base36 timestamp, strip everything that is not a letter. It stays
   * unique enough within a realm and always survives validation.
   */
  const stamp = Date.now()
    .toString(36)
    .replace(/[^a-z]/gi, '')
    .slice(-6);
  const NAME = `Tes${stamp || 'abcde'}`;

  /* ---- health ------------------------------------------------- */
  const health = await fetch(`${BASE}/api/health`);
  check('server answers health', health.ok);

  /* ---- auth --------------------------------------------------- */
  const unauth = await fetch(`${BASE}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'f' }),
  });
  check('command without a token is rejected', unauth.status === 401);

  /* ---- session ------------------------------------------------ */
  const { token, screen: boot } = await newSession();
  check('session opens on the title screen', boot.view === 'title');

  /* ---- creation ----------------------------------------------- */
  await send(token, 'n');
  for (const ch of NAME) await send(token, ch);
  const sex = await send(token, 'enter');
  check('name accepted, asks for sex', sex.view === 'create');
  await send(token, 'f');
  const created = await send(token, 'w');

  check('creation lands in the hub', created.view === 'hub', created.view);
  check('character exists with a name', created.character?.name === NAME);
  check('starts with ten turns', created.character?.turnsRemaining === 10);
  check('appears as a slot', created.slots.some((s) => s.name === NAME));

  /* ---- the command summary ------------------------------------- */
  /* The reported bug: the footer only ever showed [ESCAPE]. The cause was a
     catch-all prompt on every screen, which the shell prefers over the menu.
     The hub must carry NO prompt and a FULL menu. */
  check('hub has no pending prompt', created.prompt === null, JSON.stringify(created.prompt));
  check(
    'hub sends a full command menu',
    Array.isArray(created.menu) && created.menu.length >= 9,
    `got ${created.menu?.length ?? 'null'}`,
  );
  check(
    'menu covers the core commands',
    ['F', 'I', 'K', 'S', 'D'].every((k) => (created.menu ?? []).some((m) => m.key === k)),
    JSON.stringify((created.menu ?? []).map((m) => m.key)),
  );
  /*
   * Bank is `K`, and `B` means Back everywhere. That is not a cosmetic change:
   * one key cannot be both "open the bank" and "go back", so the hub had to give
   * one of them up. Back keeps `B` because it is used on every screen; Bank moves
   * to `K` because it is used in one place.
   */
  check(
    'bank is K and Back owns B',
    (created.menu ?? []).some((m) => m.key === 'K' && m.label === 'Bank') &&
      !(created.menu ?? []).some((m) => m.key === 'B'),
    JSON.stringify((created.menu ?? []).map((m) => `${m.key}:${m.label}`)),
  );

  /* ---- the reported bug --------------------------------------- */
  const turnLine = created.lines.find((l) => l.text.includes('remaining today'));
  check(
    'turns message includes the number',
    turnLine !== undefined && /\d+\s+turns?/.test(turnLine.text),
    turnLine?.text ?? '(no turn line)',
  );

  /* ---- fighting ----------------------------------------------- */
  let screen = created;
  let gotLines = 0;
  for (let i = 0; i < 5; i += 1) {
    screen = await send(token, 'f');
    if (screen.lines.length > 0) gotLines += 1;
    /* A forest encounter may ask a question; answer it. */
    if (screen.view === 'forest') screen = await send(token, 'n');
  }
  check('forest returns narrative lines', gotLines > 0, `${gotLines} of 5 turns produced text`);
  check(
    'turns were actually spent',
    (screen.character?.turnsRemaining ?? 0) < 10,
    `turns=${screen.character?.turnsRemaining}`,
  );

  /* ---- leaving the inn ---------------------------------------- */
  await send(token, 'b');
  const inn = await send(token, 'i');
  check('inn opens', inn.view === 'inn', inn.view);
  check(
    'inn offers Back as a key',
    (inn.prompt?.keys ?? []).some((k) => k === 'b'),
    JSON.stringify(inn.prompt?.keys),
  );
  /* The footer must list each key once, with no hint repeating it. */
  check(
    'inn prompt does not repeat Back in a hint',
    !/esc/i.test(inn.prompt?.hint ?? ''),
    JSON.stringify(inn.prompt),
  );
  const left = await send(token, 'b');
  check('B leaves the inn', left.view === 'hub', left.view);

  /* ---- the bank on its new key --------------------------------- */
  const bank = await send(token, 'k');
  check('K opens the bank', bank.view === 'bank', bank.view);
  const banked = await send(token, 'b');
  check('B leaves the bank', banked.view === 'hub', banked.view);

  /* ---- Back in the square is harmless -------------------------- */
  const already = await send(token, 'b');
  check(
    'B in the hub says so rather than doing something odd',
    already.view === 'hub' &&
      already.lines.some((l) => l.text.toLowerCase().includes('already in the square')),
    already.lines.map((l) => l.text).join(' | '),
  );

  /* ---- the loadout reaches the client ------------------------- */
  /*
   * The header now carries the equipped item ids so the browser can choose the
   * right combat sound. They must be *names*, not stats — the wire is not
   * allowed to tell a player anything they could use to compute an outcome.
   */
  const header = created.character as unknown as { weaponId?: string; armorId?: string };
  check('header carries the weapon id', typeof header.weaponId === 'string', String(header.weaponId));
  check('header carries the armor id', typeof header.armorId === 'string', String(header.armorId));
  check(
    'a new warrior starts with the dagger and rags',
    header.weaponId === 'rusty-dagger' && header.armorId === 'rags',
    `${header.weaponId}/${header.armorId}`,
  );

  /* ---- the boundary -------------------------------------------- */
  const source = await fetch(`${BASE}/api/session`, { method: 'POST', body: '{}' });
  const leak = JSON.stringify(await source.json());
  /* The wire must not carry the numbers a cheater would want. */
  check('wire contains no XP table', !leak.includes('19000'));
  check('wire contains no monster stats', !leak.includes('Ashen Wyrm'));

  console.log(failures === 0 ? '\nall smoke checks passed\n' : `\n${failures} check(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nsmoke test could not run:', err instanceof Error ? err.message : err);
  console.error('is the server running?  npm run server\n');
  process.exit(1);
});
