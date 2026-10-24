/**
 * THE ENGINE.
 *
 * Owns the AudioContext, the master bus, and the room. Plays named sounds from
 * the catalogue and schedules the modem handshake. That is the whole job — every
 * decision about *what* a sound is lives in `catalogue.ts`, and every decision
 * about *how* to render one lives in `render.ts`.
 *
 * ONE RULE OVERRIDES EVERYTHING: nothing plays until the player has gestured.
 * Browsers suspend an AudioContext created without user activation, and a game
 * that makes noise before you touch it is a worse game. `unlock()` must be
 * called from a keydown or click. That constraint is why the boot screen asks
 * you to dial in — the modem is the reward for the gesture the platform demands.
 *
 * THE FIRST-GESTURE BUG, WHICH IS NOW GUARDED BY TESTS.
 *
 * `resume()` is asynchronous. An earlier version of this file unlocked the
 * context and then synchronously checked `ctx.state === 'running'` before
 * scheduling anything. On the very first gesture that check failed, nothing was
 * scheduled, and the modem was silent. It worked on the second attempt and never
 * the first — the worst kind of bug, because it looks like flakiness.
 *
 * The fix is structural, not a patch: **scheduling never depends on context
 * state.** An AudioContext queues sources and plays them once running, so we
 * schedule and let the browser catch up. `unlocked` reports "we have a context",
 * never "the context is running", because the second thing is unknowable at call
 * time and the first is what callers actually need to know.
 */

import type { SoundName, VolumeStep } from './Voice';
import { quantiseVolume } from './Voice';
import { DESIGNS } from './catalogue';
import { buildBus, renderSound, type RenderContext } from './render';
import { makeImpulse } from './waves';
import { scheduleHandshake, type HandshakeHandle } from './handshake';
import { startAmbience, type AmbienceHandle, type AmbienceScene } from './ambience';
import { sceneForLocation, AMBIENCE_LEVEL } from './scenes';

export type { SoundName };
export { DESIGNS, SOUND_NAMES } from './catalogue';

/**
 * Master level.
 *
 * Raised to unity. The previous 0.82 — combined with an 0.8 default volume —
 * put ordinary effects around −30 dBFS, which is audible on headphones and
 * effectively silent on a laptop, the most common way this game is played. The
 * catalogue's own per-voice budget still leaves the compressor plenty of room,
 * so the correction belongs here rather than in every individual design.
 *
 * The compressor remains a safety net: it engages only when a level-up lands on
 * top of a critical hit.
 */
const MASTER_LEVEL = 1;

/**
 * Default listening level — the top step.
 *
 * Same reasoning as above. A player who finds it too loud can step down; a
 * player who finds it too quiet assumes the game is broken and leaves. Defaults
 * should favour the failure mode the player can fix in one click.
 */
const DEFAULT_VOLUME = 1;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private bus: RenderContext | null = null;
  private enabled = true;
  private volume: VolumeStep = quantiseVolume(DEFAULT_VOLUME) as VolumeStep;

  /** Per-sound throttle timestamps, keyed by name. */
  private lastPlayed = new Map<SoundName, number>();
  /**
   * Failures already reported, so a broken sound warns once and then shuts up.
   *
   * Without this a single renderer fault would log on every keystroke — fifty
   * messages a minute, burying everything else — and the natural fix would be
   * to delete the warning again, returning us to an undiagnosable silence.
   */
  private reported = new Set<string>();
  /** The live handshake, so a second call does not layer two modems. */
  private activeHandshake: HandshakeHandle | null = null;
  /** The ambient bed. Created on unlock, released on mute or dispose. */
  private ambience: AmbienceHandle | null = null;
  private ambienceWanted = true;
  /** Whether ambience is currently switched on by the player. */
  private ambienceEnabled = true;

  /**
   * The scene that should be playing.
   *
   * Held even while ambience is torn down, so unmuting resumes in the right
   * room rather than always snapping back to the forest.
   */
  private ambienceScene: AmbienceScene = 'machine';

  /**
   * How loud the bed sits — sourced from `AMBIENCE_LEVEL` in `scenes.ts`.
   *
   * It lives there, not here, so the mix can be asserted against the catalogue
   * without constructing an AudioContext. The number was 0.85 and that was a
   * mixing bug, not a taste call: the beds sum to ~0.21, so 0.85 put ~0.18 of
   * wind on the bus against a keyclick stack peaking at 0.083. The room was more
   * than twice as loud as the keys, which is exactly what "I can't hear the
   * keyboard" sounds like. At 0.12 the bed is audible only when it stops.
   */
  private static readonly AMBIENCE_LEVEL = AMBIENCE_LEVEL;

  /**
   * True once a real AudioContext exists.
   *
   * Explicitly NOT a promise that `state === 'running'`. See the file header.
   */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Raw context state, for diagnostics and the settings panel. */
  get state(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none';
  }

  /**
   * The device sample rate, or 0 before the context exists.
   *
   * Surfaced in the settings panel because it is the fastest way to separate an
   * audio problem from a volume problem: no rate means no context, and no
   * context means the browser never granted permission to make sound.
   */
  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get currentVolume(): VolumeStep {
    return this.volume;
  }

  /**
   * Create or resume the context. Must be called from a user gesture the first
   * time. Returns false if the browser offers no audio at all, which is not an
   * error — a game that cannot make sound should still play.
   *
   * Idempotent, and safe to call on every keypress. The critical detail: it
   * always attempts `resume()` whenever the context is not already running. An
   * existing context is NOT the same as a running one, and a context built before
   * the player's first gesture stays suspended until something resumes it.
   * Assuming "we already have a context, so we are fine" is exactly the
   * assumption that silenced this game.
   */
  unlock(): boolean {
    if (typeof window === 'undefined') return false;

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!Ctor) return false;

    try {
      if (!this.ctx) {
        this.ctx = new Ctor();
        this.build();
      }

      /* Fire and forget. Callers must not wait on this — anything scheduled now
         plays when the promise settles. */
      if (this.ctx.state !== 'running') {
        void this.ctx.resume().catch(() => undefined);
      }

      /* A live context can finally carry the room tone, if one is wanted. */
      this.startAmbienceIfWanted();

      this.applyVolume();
      return true;
    } catch {
      this.ctx = null;
      this.bus = null;
      return false;
    }
  }

  /** Wire the master bus and the room. Called once, on first unlock. */
  private build(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    this.bus = buildBus(ctx, ctx.destination);

    /*
     * The room.
     *
     * Guarded because a stubbed AudioContext (tests) may not implement a
     * convolver. When it is missing the wet bus stays connected but silent: the
     * reverb send becomes a no-op rather than an exception, which is the right
     * failure mode — sounds still play, they are simply dry.
     */
    if (typeof ctx.createConvolver === 'function') {
      try {
        const convolver = ctx.createConvolver();
        convolver.buffer = makeImpulse(ctx);
        convolver.connect(this.bus.reverb);
      } catch {
        /* No room. The wet bus is already wired and simply receives nothing, so
         * sounds play dry rather than not at all.
         */
      }
    }

    this.startAmbienceIfWanted();
  }

  /**
   * Bring the room tone up, if the player wants it.
   *
   * Started lazily rather than at construction: there is no context until the
   * first gesture, and a muted player should not pay for oscillators they cannot
   * hear. Failures are swallowed — a game that cannot manage an ambient bed
   * should still play.
   */
  private startAmbienceIfWanted(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    if (this.ambience) return;
    if (!this.ambienceWanted || !this.ambienceEnabled || !this.enabled) return;

    try {
      this.ambience = startAmbience(ctx, bus.master, this.ambienceScene);
      this.ambience.setLevel(SoundEngine.AMBIENCE_LEVEL);
    } catch (err) {
      this.ambience = null;
      this.report('room tone', err);
    }
  }

  /**
   * Move the ambience to a game location.
   *
   * Called from the shell as the player moves. Idempotent: the scene only changes
   * when it actually differs, so a re-render that re-states the current location
   * costs nothing — which matters, because the shell re-renders on every
   * keystroke.
   */
  setLocation(location: string): void {
    this.setAmbienceScene(sceneForLocation(location));
  }

  /** Move the ambience to a scene directly. */
  setAmbienceScene(scene: AmbienceScene): void {
    if (this.ambienceScene === scene) return;
    this.ambienceScene = scene;

    /* If ambience is torn down (muted), remember the scene for later rather than
       losing it — unmuting should resume in the right room. */
    if (!this.ambience) return;

    try {
      this.ambience.setScene(scene);
    } catch {
      /* A scene change must never take down the game. */
    }
  }

  /** The scene currently requested. Diagnostics only. */
  get currentAmbienceScene(): AmbienceScene {
    return this.ambienceScene;
  }

  /** Fade the bed out and release it. */
  private stopAmbience(): void {
    if (!this.ambience) return;
    try {
      this.ambience.stop();
    } catch {
      /* already gone */
    }
    this.ambience = null;
  }

  /**
   * Turn the room tone on or off.
   *
   * Separate from the master mute on purpose. Some players want the effects and
   * not the drone; forcing them to choose both or neither is the kind of false
   * economy that makes people turn sound off entirely.
   *
   * NOTE: this records the preference and does not itself construct a context.
   * Calling `unlock()` from a settings effect runs at mount, before any user
   * gesture, and the browser then hands back a *suspended* context that nothing
   * ever resumes — which is how the game ended up completely silent. The bed is
   * started from `unlock()`, once a real gesture has happened.
   */
  setAmbienceEnabled(on: boolean): void {
    this.ambienceEnabled = on;
    this.ambienceWanted = on;

    if (!on) {
      this.stopAmbience();
      return;
    }

    /* Only start it if a gesture has already given us a usable context. */
    if (this.ctx) this.startAmbienceIfWanted();
  }

  get isAmbienceEnabled(): boolean {
    return this.ambienceEnabled;
  }

  /**
   * Turn sound on or off.
   *
   * Enabling does NOT construct a context here. This is called from a settings
   * effect at mount, before any gesture, and a context created then is handed
   * back suspended with nothing to resume it — the exact failure that made the
   * game silent. The context is created by `unlock()`, which only ever runs from
   * a real keypress or click.
   */
  setEnabled(on: boolean): void {
    this.enabled = on;
    this.applyVolume();

    /*
     * Muting must release the bed, not merely fade it.
     *
     * The bed routes through the same master gain so the fade is automatic, but
     * leaving a dozen oscillators and two looping noise sources running for a
     * player who has muted the game is pure waste — and on a laptop it is
     * battery. Tear it down and rebuild on unmute.
     */
    if (!on) {
      this.stopAmbience();
      return;
    }

    if (this.ctx) this.startAmbienceIfWanted();
  }

  /** Set listening level, quantised to perceptual steps. */
  setVolume(value: number): void {
    this.volume = quantiseVolume(value) as VolumeStep;
    this.applyVolume();
  }

  private applyVolume(): void {
    const { ctx, bus } = this;
    if (!ctx || !bus) return;

    const target = this.enabled ? MASTER_LEVEL * this.volume : 0;
    const now = ctx.currentTime;

    const gain = bus.master.gain;
    gain.cancelScheduledValues(now);
    /* A short ramp, not a jump: an instant gain change is an audible click. */
    gain.setTargetAtTime(target, now, 0.015);
  }

  /* ------------------------------------------------------------------ */
  /* Playback                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Play one named sound.
   *
   * No `state === 'running'` guard, deliberately — see the file header.
   */
  play(name: SoundName): void {
    const { ctx, bus } = this;
    if (!this.enabled || !ctx || !bus) return;

    const design = DESIGNS[name];
    if (!design) return;

    /* Throttle. Mashing a key through a scroll should sound like a keyboard,
       not like a buzz saw. */
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const last = this.lastPlayed.get(name) ?? -Infinity;
    if (design.throttleMs && now - last < design.throttleMs) return;
    this.lastPlayed.set(name, now);

    /* Repeats drift a few cents so no two hits are bit-identical. */
    const jitter = design.jitter ? (Math.random() * 2 - 1) * design.jitter : 0;

    /* Slight stereo scatter too — the forest is not a mono room. */
    const pan = jitter !== 0 ? (Math.random() * 2 - 1) * 0.12 : 0;

    try {
      renderSound(bus, design, ctx.currentTime + 0.006, { detune: jitter, pan });
    } catch (err) {
      /*
       * A single bad design must never take down input handling — but it must
       * not be invisible either.
       *
       * This catch used to be entirely empty, which is exactly why "sound isn't
       * working" was impossible to diagnose from the console: a throw in the
       * renderer produced total silence with no trace of its cause. The sound
       * still fails quietly for the player; the developer now gets told once.
       */
      this.report(`sound "${name}"`, err);
    }
  }

  /**
   * Record a non-fatal audio fault, once per kind.
   *
   * Audio failures here are recoverable by design — a broken reverb must not
   * stop a sword hit — so everything is caught. The problem with catching
   * silently is that the *whole engine* can be failing and the only symptom is
   * quiet. One line per distinct fault turns an unsolvable report into a
   * one-glance answer, and the dedupe keeps a per-keystroke fault from flooding
   * the console.
   */
  private report(what: string, err: unknown): void {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const key = `${what}::${message}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    console.warn(`[audio] ${what} failed — ${message}`);
  }

  /* ------------------------------------------------------------------ */
  /* The modem                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Dial. Returns a cancel function carrying the call's `duration`.
   *
   * That duration is the authority on how long the handshake runs. The UI waits
   * on it rather than a hand-copied constant, so the boot screen can never claim
   * "carrier established" while the modem is still talking.
   */
  handshake(): (() => void) & { duration: number } {
    const noop = Object.assign(() => undefined, { duration: 0 });

    const { ctx, bus } = this;
    if (!this.enabled || !ctx || !bus) return noop;

    /* A second handshake replaces the first rather than stacking. */
    this.activeHandshake?.cancel();
    this.activeHandshake = null;

    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    try {
      const handle = scheduleHandshake(ctx, bus.master, ctx.currentTime + 0.02);
      this.activeHandshake = handle;

      const cancel = () => {
        handle.cancel();
        if (this.activeHandshake === handle) this.activeHandshake = null;
      };

      return Object.assign(cancel, { duration: handle.duration });
    } catch (err) {
      /*
       * A silent no-op keeps the boot screen usable, but returning one without a
       * word is how a broken modem hides: `duration: 0` makes the shell skip the
       * handshake entirely, so the carrier line appears instantly and nothing is
       * ever heard. Report the cause.
       */
      this.report('modem handshake', err);
      return noop;
    }
  }

  /**
   * Play every sound, in order, so a player can hear precisely which parts work.
   *
   * This exists because silence is undiagnosable from outside. Three unrelated
   * faults — audio switched off, the context blocked by the browser, one broken
   * design — present identically as "no sound". Sweeping the catalogue turns that
   * into a specific answer in about six seconds.
   *
   * The per-sound throttle is cleared before each play, deliberately: a test that
   * silently drops half its own subjects is not a test.
   */
  testAll(): void {
    if (!this.ctx) this.unlock();
    if (!this.ctx || !this.enabled) return;

    const order: SoundName[] = [
      'key',
      'select',
      'back',
      'deny',
      'hit',
      'crit',
      'miss',
      'hurt',
      'dodge',
      'spell',
      'loot',
      'coin',
      'heal',
      'level',
      'death',
      'wyrm',
      'realm',
    ];

    order.forEach((name, index) => {
      window.setTimeout(() => {
        this.lastPlayed.delete(name);
        this.play(name);
      }, index * 340);
    });
  }

  /**
   * True when the ambient bed is actually running.
   *
   * Distinct from `state === 'running'`, which only says the browser started
   * audio. The bed has its own lifecycle — a dozen oscillators and two looping
   * noise sources that can fail to build while the context is perfectly healthy.
   * The settings panel uses this to tell "audio works, room is off" apart from
   * "nothing works".
   */
  get ambienceLive(): boolean {
    return this.ambience !== null;
  }

  /** Stop a handshake that is still running. */
  hangUp(): void {
    this.activeHandshake?.cancel();
    this.activeHandshake = null;
  }

  /**
   * A short acknowledgement that the carrier is back.
   *
   * Previously defined and never called. It has a use now: marking a reconnect
   * without the ceremony of a full handshake.
   */
  carrier(): void {
    if (!this.enabled || !this.ctx) return;
    this.play('realm');
  }

  /** Release the context. Called on unmount. */
  dispose(): void {
    this.hangUp();
    this.stopAmbience();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.bus = null;
    this.lastPlayed.clear();
  }
}

/** The one engine the app uses. */
export const sound = new SoundEngine();
