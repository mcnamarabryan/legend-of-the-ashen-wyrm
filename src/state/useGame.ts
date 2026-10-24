import type { Settings } from '../api/types';
import { openSession, sendKey, forgetToken } from '../api/client';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { clientReducer, initialClientState, type ClientState, type ClientLine } from './client';
import { sound } from '../audio/SoundEngine';
import { soundsForBatch, soundForKey, profileFromLoadout, DEFAULT_PROFILE } from '../audio/cues';

/**
 * useGame — the browser's half of the conversation.
 *
 * Responsibilities, and nothing beyond them:
 *   - open a session and keep the token
 *   - forward keypresses
 *   - hold the rendered screen and the scrolling log
 *   - own presentation settings, which are local by nature
 *   - make noise
 *
 * It does not know what a turn costs, what a monster is, or whether the player
 * just died. It receives sentences and draws them — and plays a sound based on
 * how those sentences are worded, which is the only signal it has.
 */

/**
 * Settings key is versioned rather than migrated.
 *
 * `sound` used to default to false. Anyone who played before this change has
 * `sound:false` in localStorage, and merging that over the new default would
 * silently keep their audio off forever — they would never hear the modem and
 * would have no reason to suspect a stale preference was the cause. Bumping the
 * key gives everyone the new default once. Losing a saved preference is much
 * cheaper than a bug nobody can diagnose.
 */
const SETTINGS_KEY = 'ashen-wyrm.settings.v2';

const defaultSettings: Settings = {
  theme: 'green',
  scanlines: true,
  flicker: true,
  grain: true,
  curvature: true,
  sound: true,
  /*
   * MAX, not 0.8.
   *
   * The engine's steps are 0.3 / 0.55 / 0.8 / 1. Starting at 0.8 put ordinary
   * effects near −30 dBFS — audible on headphones, inaudible on a laptop. A
   * player who finds it too loud steps down in one click; a player who cannot
   * hear it assumes the game is broken and leaves.
   */
  volume: 1,
  ambience: true,
  typewriterMs: 18,
  contrastBoost: false,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaultSettings;
  }
}

export interface Game {
  state: ClientState;
  settings: Settings;
  reducedMotion: boolean;
  /**
   * Acknowledge a physical keypress: arm audio and make the click.
   *
   * Separate from `key()` because the two are not the same event. `key()` sends
   * the press to the server; `press()` reflects that a key went *down*. Most
   * presses in this game never reach the server — they skip a running
   * typewriter, or land while a request is in flight — and those presses used to
   * be completely silent, because the click was played inside `key()`.
   *
   * That was the "I can't hear the keyboard clicks" bug. The keyboard was fine;
   * it was being muted for the majority of keystrokes by the input router. A
   * keypress is a physical event regardless of whether the game wants it, so the
   * click belongs to the gesture, not to the command.
   */
  press(raw: string): void;
  key(k: string): void;
  actions: {
    setSettings(patch: Partial<Settings>): void;
    retry(): void;
    forget(): void;
    /** Play the modem handshake. Called from the boot screen. */
    dial(): void;
    /** Cancel a handshake that is still running. */
    hangUp(): void;
    /** Set listening level, 0–1. */
    setVolume(value: number): void;
  };
  /**
   * How long the modem handshake actually runs, in milliseconds.
   *
   * Comes from the engine rather than a constant in the shell, so the boot
   * screen cannot claim the carrier is up while the modem is still talking.
   */
  handshakeMs: number;
}

export function useGame(): Game {
  const [state, dispatch] = useReducer(clientReducer, initialClientState);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [reducedMotion, setReducedMotion] = useState(false);

  /* One keypress in flight at a time, and stale responses are discarded so a
     slow reply cannot overwrite a newer screen. */
  const inFlight = useRef(false);
  const requestId = useRef(0);

  /* Track the highest line id we have already scored, so a re-render never
     replays a cue for a line the player has heard. */
  const scoredId = useRef(0);
  const hangUpRef = useRef<(() => void) | null>(null);

  /**
   * How long the modem actually runs, reported by the engine once it schedules.
   *
   * The shell waits on this instead of a hand-copied constant (it used to be a
   * literal `5900` in App.tsx, which had to be kept in sync by hand with the
   * timeline in the engine — a coordination bug waiting to happen). Seeded with
   * a sane value so the boot screen behaves before the first dial.
   */
  const [handshakeMs, setHandshakeMs] = useState(6700);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* private mode */
    }
  }, [settings]);

  /* Keep the engine's mute state, listening level and ambience in sync. */
  useEffect(() => {
    sound.setEnabled(settings.sound);
    sound.setVolume(settings.volume);
    sound.setAmbienceEnabled(settings.ambience);
  }, [settings.sound, settings.volume, settings.ambience]);

  /* Release the audio context if the app unmounts. */
  useEffect(() => {
    return () => {
      hangUpRef.current?.();
      sound.dispose();
    };
  }, []);

  /**
   * Arm the audio engine. Safe to call on every keypress.
   *
   * THIS FUNCTION WAS THE REASON THE WHOLE GAME WAS SILENT.
   *
   * It used to read:
   *
   *     if (sound.unlocked) return;   // "already have a context, nothing to do"
   *     sound.unlock();
   *
   * `unlocked` means "an AudioContext object exists", not "the context is
   * running". On mount, the settings effect calls `setEnabled` and
   * `setAmbienceEnabled`, which construct the context *before any user gesture* —
   * so the browser hands back one in the `suspended` state. From that moment
   * `unlocked` was true, this function returned immediately, `resume()` was
   * never called, and every scheduled sound queued into a context that never
   * started. The modem, the clicks, the hits: all present in the graph, all
   * inaudible.
   *
   * Calling `unlock()` unconditionally fixes it, because `unlock()` is already
   * idempotent and already resumes a suspended context. The guard was not
   * protecting anything — it was the bug.
   */
  const ensureAudio = useCallback(() => {
    if (!settings.sound) return;
    sound.unlock();
  }, [settings.sound]);

  const connect = useCallback(async () => {
    dispatch({ type: 'connecting' });
    dispatch({ type: 'busy', busy: true });
    try {
      /* Always open a fresh session. The server keeps saves keyed by character
         name, so slots survive a server restart; a stale token does not. */
      const { screen } = await openSession();
      dispatch({ type: 'screen', screen });
    } catch (err) {
      dispatch({
        type: 'offline',
        error: err instanceof Error ? err.message : 'The node is not answering.',
      });
    }
  }, []);

  useEffect(() => {
    void connect();
  }, [connect]);

  /* ---- score each new batch of lines ---------------------------- */
  useEffect(() => {
    const fresh: ClientLine[] = state.log.filter((l) => l.id > scoredId.current);
    if (fresh.length === 0) return;

    scoredId.current = fresh[fresh.length - 1].id;

    if (!settings.sound) return;

    /*
     * The player's kit decides which impact sound plays.
     *
     * Read from the header, because the client holds no state of its own:
     * `weaponId` and `armorId` are two short strings the server already sends,
     * mapped here onto this module's own sound families. A war hammer and a
     * dagger therefore genuinely sound different, and the mapping stays purely
     * a presentation concern.
     */
    const profile = state.character
      ? profileFromLoadout(state.character.weaponId, state.character.armorId)
      : DEFAULT_PROFILE;

    const cues = soundsForBatch(fresh, profile);
    cues.forEach((cue, i) => {
      /* Stagger, so a level-up and a sword hit do not stack into mush. */
      if (i === 0) {
        sound.play(cue);
        return;
      }
      window.setTimeout(() => sound.play(cue), 140 * i);
    });
  }, [state.log, state.character, settings.sound]);

  /* ---- a physical keypress ---------------------------------------- */

  /**
   * Arm the audio and make the click. Called for EVERY keydown.
   *
   * This is deliberately separate from `key()`. The click used to live inside
   * `key()`, which meant it only fired on presses that were forwarded to the
   * server — so the typewriter-skip press, the presses swallowed while a request
   * was in flight, and the offline-retry press were all silent. Players mash keys
   * precisely in those moments, which made the keyboard feel broken.
   *
   * A key going down is a physical fact. The sound belongs to the gesture, not to
   * whether the game has a use for it.
   */
  const press = useCallback(
    (raw: string) => {
      ensureAudio();
      sound.play(soundForKey(raw));
    },
    [ensureAudio],
  );

  /* ---- the single mutation path --------------------------------- */
  const key = useCallback(
    (raw: string) => {
      if (inFlight.current) return;

      /* Keep the unlock here as a safety net for callers that bypass `press()`
         (the boot screen's dial gesture among them). The click itself is NOT
         played here — `press()` already made it for this physical keydown, and
         firing it twice would double the transient. */
      ensureAudio();

      /* Send the key as typed. The SERVER decides whether case matters — it
         lowercases for command matching but preserves case for typed names, so
         a player can be called "Aria" rather than "aria". */
      const id = ++requestId.current;

      inFlight.current = true;
      dispatch({ type: 'busy', busy: true });

      void sendKey(raw)
        .then((screen) => {
          if (id !== requestId.current) return;
          dispatch({ type: 'screen', screen });
        })
        .catch((err: unknown) => {
          if (id !== requestId.current) return;
          dispatch({
            type: 'offline',
            error: err instanceof Error ? err.message : 'The carrier dropped.',
          });
        })
        .finally(() => {
          if (id === requestId.current) {
            inFlight.current = false;
            dispatch({ type: 'busy', busy: false });
          }
        });
    },
    [ensureAudio],
  );

  const actions = useMemo(
    () => ({
      setSettings: (patch: Partial<Settings>) => {
        /* Turning sound on is itself a gesture: unlock immediately so the
           setting takes effect on the next sound rather than the next click. */
        if (patch.sound === true) sound.unlock();
        setSettings((s) => ({ ...s, ...patch }));
      },

      retry: () => {
        void connect();
      },

      forget: () => {
        forgetToken();
        void connect();
      },

      dial: () => {
        /*
         * UNLOCK FIRST — this was the "modem sometimes doesn't play" bug.
         *
         * `setEnabled(true)` deliberately does NOT create an AudioContext; it
         * only records the preference, because creating one outside a gesture
         * yields a suspended context that nothing ever resumes. But
         * `handshake()` returns a silent `{ duration: 0 }` no-op when no context
         * exists yet.
         *
         * So any path reaching `dial()` without first going through `press()`
         * got silence: clicking the dial button with a mouse, or the boot
         * screen's own button, both bypass the keydown handler entirely.
         * Keyboard users were fine because `press()` unlocks on the way in —
         * which is exactly why it looked intermittent rather than broken.
         *
         * `unlock()` is idempotent and resumes a suspended context, so calling
         * it here costs nothing when the gesture already happened.
         */
        sound.unlock();
        sound.setEnabled(true);

        hangUpRef.current?.();
        const handle = sound.handshake();
        hangUpRef.current = handle;

        /*
         * Record what the engine actually scheduled. The boot screen waits on
         * this, so the two can never drift apart and the carrier line cannot
         * appear while the modem is still talking.
         */
        if (handle.duration > 0) setHandshakeMs(handle.duration * 1000);
      },

      hangUp: () => {
        hangUpRef.current?.();
        hangUpRef.current = null;
      },

      setVolume: (value: number) => {
        sound.setVolume(value);
        setSettings((s) => ({ ...s, volume: value }));
      },
    }),
    [connect],
  );

  return { state, settings, reducedMotion, press, key, actions, handshakeMs };
}
