import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Realm } from './game';
import { RealmDb } from './store';
import type { CommandResponse, Screen } from './wire';

/**
 * The game server.
 *
 * Two routes, both POST, both trivial:
 *
 *   POST /api/session            → create a session, return a token + screen
 *   POST /api/command  { key }   → apply one keypress, return the new screen
 *
 * Session tokens are opaque and random. The server holds the save; the client
 * holds a string. Deleting localStorage therefore does not roll the clock back
 * and does not resurrect a dead character.
 *
 * PERSISTENCE lives in SQLite via sql.js — see `store.ts` for why that and not
 * `node:sqlite`. Characters survive a restart; session tokens do not.
 *
 * This is a plain Node HTTP server — no framework. It runs on WebContainer's
 * Node-in-WASM, which has no native bindings to offer, and it needs none.
 */

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';

/* Token → nothing. The Realm holds the state; we only track validity. */
const issued = new Set<string>();

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    /* The Vite dev server proxies to us from the same origin, but allow direct
       calls too so the game can be driven by curl during debugging. */
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-session-token',
    'access-control-allow-methods': 'POST, OPTIONS',
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function tokenFrom(req: IncomingMessage): string | null {
  const header = req.headers['x-session-token'];
  if (typeof header === 'string' && header.length > 0) return header;
  return null;
}

async function main() {
  /*
   * Open the realm before serving. sql.js has to instantiate its WASM module,
   * which is async, so this is the one place the server is allowed to await.
   * If the database cannot be opened we fail loudly rather than running a
   * server that silently forgets everything.
   */
  let realm: Realm;
  try {
    const db = await RealmDb.open();
    realm = new Realm(db);

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        db.close();
        process.exit(0);
      });
    }
  } catch (err) {
    console.error('[realm] could not open the database:', err);
    process.exit(1);
  }

  /** Boot payload: a fresh token and the opening screen. */
  function bootScreen(): Screen {
    return {
      view: 'title',
      lines: [],
      character: null,
      prompt: { label: 'Choose', keys: ['n', ...'123456789'.split('')] },
      menu: null,
      entry: null,
      slots: realm.slots(),
      feed: [],
    };
  }

  const server = createServer(async (req, res) => {
    const url = req.url?.split('?')[0] ?? '/';

    if (req.method === 'OPTIONS') {
      json(res, 204, null);
      return;
    }

    /* ---- health ------------------------------------------------- */
    if (url === '/api/health') {
      json(res, 200, { ok: true, uptime: process.uptime() });
      return;
    }

    /* ---- new session -------------------------------------------- */
    if (url === '/api/session' && req.method === 'POST') {
      const token = randomUUID();
      issued.add(token);
      realm.newSession(token);
      json(res, 200, { ok: true, token, screen: bootScreen() });
      return;
    }

    /* ---- one keypress ------------------------------------------- */
    if (url === '/api/command' && req.method === 'POST') {
      const token = tokenFrom(req);

      /*
       * A token from a previous run of the server is not in `issued`, but the
       * character it owns may still be in the database. Rather than force the
       * player to start over, adopt the token: if the realm has a session for
       * it, honour it. That is what makes a reload after a restart resume
       * seamlessly instead of silently losing the character.
       */
      if (token && !issued.has(token)) {
        if (realm.get(token)) {
          issued.add(token);
        } else {
          json(res, 401, { ok: false, error: 'No session. POST /api/session first.' });
          return;
        }
      }
      if (!token) {
        json(res, 401, { ok: false, error: 'No session. POST /api/session first.' });
        return;
      }

      let key = '';
      try {
        const raw = await readBody(req);
        const parsed = raw.length > 0 ? (JSON.parse(raw) as { key?: string }) : {};
        key = typeof parsed.key === 'string' ? parsed.key : '';
      } catch {
        json(res, 400, { ok: false, error: 'Malformed body.' });
        return;
      }

      if (key.length > 32) {
        json(res, 400, { ok: false, error: 'Key too long.' });
        return;
      }

      try {
        const screen = realm.command(token, key);
        const body: CommandResponse = { ok: true, screen };
        json(res, 200, body);
      } catch (err) {
        /* Never leak a stack trace to the client. Log it and say nothing useful. */
        console.error('[realm] command failed', err);
        json(res, 500, { ok: false, error: 'The node dropped the carrier. Try again.' });
      }
      return;
    }

    /* ---- the player's slots ------------------------------------- */
    if (url === '/api/slots' && req.method === 'GET') {
      json(res, 200, { ok: true, slots: realm.slots() });
      return;
    }

    json(res, 404, { ok: false, error: 'No such route.' });
  });

  server.listen(PORT, HOST, () => {
    console.log(`[realm] listening on http://${HOST}:${PORT}`);
    console.log('[realm] the browser holds no rules. this process does.');
    console.log('[realm] characters persist in SQLite.');
  });

  /* Shut down cleanly so WebContainer does not leak a listener between runs. */
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
    });
  }
}

void main();
