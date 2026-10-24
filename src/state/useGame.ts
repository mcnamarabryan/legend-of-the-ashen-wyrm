import type { Settings } from '../api/types';
import { openSession, sendKey, forgetToken } from '../api/client';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { clientReducer, initialClientState, type ClientState, type ClientLine } from './client';
import { sound } from '../audio/SoundEngine';
import { soundsForBatch, soundForKey } from '../audio/cues';

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
  volume: 0.8,
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
   * Browsers will not start audio without a gesture. Every gameplay keypress
   * is a gesture, so the first one arms the engine. Doing it here rather than
   * in a component keeps the policy in one place.
   */
  const ensureAudio = useCallback(() => {
    if (!settings.sound) return;
    if (sound.unlocked) return;
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

    /* Nothing to do if sound is off — and nothing to do before the player has
       gestured, because the context will not be running yet. */
    if (!settings.sound || !sound.unlocked) return;

    const cues = soundsForBatch(fresh);
    cues.forEach((cue, i) => {
      /* Stagger, so a level-up and a sword hit do not stack into mush. */
      if (i === 0) {
        sound.play(cue);
        return;
      }
      window.setTimeout(() => sound.play(cue), 140 * i);
    });
  }, [state.log, settings.sound]);

  /* ---- the single mutation path --------------------------------- */
  const key = useCallback(
    (raw: string) => {
      if (inFlight.current) return;

      /* Every key is a gesture. Take the chance to arm audio if allowed. */
      ensureAudio();
      sound.play(soundForKey(raw));

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
         * Do NOT gate on `sound.isEnabled`.
         *
         * That flag is only synced by a useEffect after render. `acceptSound`
         * calls setSettings({sound:true}) and then dial() in the same tick, so
         * the effect has not run yet, isEnabled is still false, and the
         * handshake never starts. That is precisely the "no modem sound" bug.
         *
         * The engine is told directly instead. Unlocking always enables it: the
         * call itself is the gesture, and a caller asking to dial has already
         * decided it wants audio.
         */
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

  return { state, settings, reducedMotion, key, actions, handshakeMs };
}
