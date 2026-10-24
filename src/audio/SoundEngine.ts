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
import { sceneForLocation } from './scenes';

export type { SoundName };
export { DESIGNS, SOUND_NAMES } from './catalogue';

/**
 * Master level.
 *
 * Chosen so the loudest design (a critical hit plus its reverb tail) peaks near
 * −6 dBFS with the volume control at full. The compressor is a safety net, not a
 * mixing crutch — if it is working hard on normal play, this number is too high.
 */
const MASTER_LEVEL = 0.82;

/** Default listening level. Loud enough to feel, quiet enough not to startle. */
const DEFAULT_VOLUME = 0.8;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private bus: RenderContext | null = null;
  private enabled = true;
  private volume: VolumeStep = quantiseVolume(DEFAULT_VOLUME) as VolumeStep;

  /** Per-sound throttle timestamps, keyed by name. */
  private lastPlayed = new Map<SoundName, number>();
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
   * How loud the bed sits.
   *
   * Roughly a tenth of a keyclick. The test is simple: if you notice the
   * ambience as a *feature* rather than as a room, this is too high.
   */
  private static readonly AMBIENCE_LEVEL = 0.85;

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

  get currentVolume(): VolumeStep {
    return this.volume;
  }

  /**
   * Create or resume the context. Must be called from a user gesture the first
   * time. Returns false if the browser offers no audio at all, which is not an
   * error — a game that cannot make sound should still play.
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
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }

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
    } catch {
      this.ambience = null;
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
   */
  setAmbienceEnabled(on: boolean): void {
    this.ambienceEnabled = on;
    this.ambienceWanted = on;

    if (on) {
      this.unlock();
      this.startAmbienceIfWanted();
    } else {
      this.stopAmbience();
    }
  }

  get isAmbienceEnabled(): boolean {
    return this.ambienceEnabled;
  }

  /** Turn sound on or off. Turning it on unlocks, because that IS a gesture. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    this.applyVolume();

    /*
     * Muting must release the bed, not merely fade it.
     *
     * The bed routes through the same master gain so the fade is automatic, but
     * leaving a dozen oscillators and two looping noise sources running for a
     * player who has muted the game is pure waste — and on a laptop it is
     * battery. Tear it down and rebuild on unmute.
     */
    if (!on) this.stopAmbience();
    else this.startAmbienceIfWanted();
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
    } catch {
      /*
       * A single bad design must never take down input handling. Swallow it: a
       * silent frame the player never notices beats an exception thrown inside
       * a keydown handler.
       */
    }
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
    } catch {
      return noop;
    }
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
