import type { CommandResponse, Screen, SessionResponse } from './wire';

/**
 * The client's entire relationship with the game.
 *
 * Two calls: open a session, send a keypress. There is no game logic here and
 * no game logic anywhere else in `src/`. The bundle that reaches the browser
 * contains markup rendering, a typewriter, and a CRT — not the XP table, not
 * the wyrm's health, not the RNG.
 *
 * The session token lives in localStorage purely so a reload resumes the same
 * character. It is an opaque server-issued string; knowing it grants no
 * advantage beyond playing your own save, and it is not derived from anything
 * the player controls.
 */

const TOKEN_KEY = 'ashen-wyrm.token.v1';
const BASE = '/api';

function token(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* private mode — the session simply does not survive a reload */
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function post<T>(path: string, body: unknown, withToken: boolean): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const t = token();
  if (withToken && t) headers['x-session-token'] = t;

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
  });

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error('The node said nothing coherent.');
  }

  if (!res.ok) {
    const message =
      json && typeof json === 'object' && 'error' in json
        ? String((json as { error: unknown }).error)
        : `Request failed (${res.status}).`;
    throw new Error(message);
  }

  return json as T;
}

/** Begin (or re-begin) a session. Returns the opening screen. */
export async function openSession(): Promise<{ token: string; screen: Screen }> {
  const res = await post<SessionResponse>('/session', {}, false);
  if (!res.ok || !res.token || !res.screen) {
    throw new Error(res.error ?? 'Could not open a carrier.');
  }
  setToken(res.token);
  return { token: res.token, screen: res.screen };
}

/**
 * Send one keypress.
 *
 * This is the only mutation path in the entire client. A player who edits
 * their localStorage, calls this from the console, or replays a request can
 * only ever send a keypress — the server decides what it means.
 */
export async function sendKey(key: string): Promise<Screen> {
  const res = await post<CommandResponse>('/command', { key }, true);
  if (!res.ok || !res.screen) {
    throw new Error(res.error ?? 'The node dropped the carrier.');
  }
  return res.screen;
}

export function hasToken(): boolean {
  return token() !== null;
}
