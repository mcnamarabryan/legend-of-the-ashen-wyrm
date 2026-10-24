/**
 * THE SOUND OF A 1993 MODEM, SYNTHESISED.
 *
 * No audio files, no dependencies, no network. Every sound in this file is
 * built from oscillators and noise buffers at runtime. That is not a
 * constraint I worked around — it is the correct way to make a modem noise,
 * because a real modem handshake WAS a set of tones, and tones are cheap.
 *
 * The whole engine is gated behind one rule: **nothing plays until the player
 * has gestured.** Browsers suspend audio contexts created without a user
 * gesture, and a game that shouts before you touch it is a worse game. Call
 * `unlock()` from a keydown or click.
 *
 * That rule is why the boot screen asks you to dial in rather than starting on
 * its own: the modem handshake you hear first is the reward for the gesture the
 * browser demands. The fiction and the constraint happen to agree, which is
 * luckier than it sounds — a BBS always began with you picking up the phone.
 *
 * Design notes, because these are the decisions that matter:
 *
 *  - **Master gain, not per-sound gain.** One `GainNode` sits between the graph
 *    and the destination so muting is instant and cannot click.
 *  - **A compressor on the bus.** Keyclicks and thuds overlapping must not clip.
 *  - **Everything is scheduled ahead.** `osc.start(t)` with absolute times, so
 *    the handshake is sample-accurate even if the main thread stalls.
 *  - **Noise is one pre-rendered buffer,** reused. Generating white noise per
 *    hit allocates a buffer every keystroke; at 10 keys/second that is garbage
 *    collection the player hears as stutter.
 */

export type SoundName =
  | 'key'
  | 'select'
  | 'back'
  | 'hit'
  | 'miss'
  | 'crit'
  | 'hurt'
  | 'loot'
  | 'level'
  | 'death'
  | 'wyrm'
  | 'boot';

interface Voice {
  /** Start offset in seconds from `now`. */
  at: number;
  freq: number;
  /** End frequency, for sweeps. */
  to?: number;
  /** Duration in seconds. */
  dur: number;
  type: OscillatorType;
  gain: number;
  /** Optional noise bed, 0–1. */
  noise?: number;
  /** Optional lowpass cutoff for the noise, in Hz. */
  filter?: number;
}

/* ------------------------------------------------------------------ */
/* The sound designs                                                   */
/* ------------------------------------------------------------------ */

/**
 * Each entry is a layering of voices. Relative `at` offsets compose the sound;
 * the sum is what you hear. Kept deliberately short — this is a terminal, not
 * a film.
 */
const DESIGNS: Record<SoundName, Voice[]> = {
  /* A 4ms square blip. The single most important sound in the game, because
     you hear it more than any other. */
  key: [{ at: 0, freq: 1180, to: 620, dur: 0.028, type: 'square', gain: 0.055 }],

  /* Committing to something — a two-step rise. */
  select: [
    { at: 0, freq: 660, dur: 0.045, type: 'square', gain: 0.06 },
    { at: 0.045, freq: 990, dur: 0.06, type: 'square', gain: 0.05 },
  ],

  /* Backing out — a two-step fall. */
  back: [
    { at: 0, freq: 620, dur: 0.045, type: 'square', gain: 0.055 },
    { at: 0.045, freq: 380, dur: 0.07, type: 'square', gain: 0.05 },
  ],

  /* Blade into something. Short noise crack over a low body thump. */
  hit: [
    { at: 0, freq: 190, to: 90, dur: 0.09, type: 'triangle', gain: 0.13 },
    { at: 0, freq: 0, dur: 0.05, type: 'sine', gain: 0.06, noise: 1, filter: 2600 },
  ],

  /* Whiff. Air only. */
  miss: [{ at: 0, freq: 0, dur: 0.11, type: 'sine', gain: 0.05, noise: 1, filter: 1400 }],

  /* Critical: the hit sound, plus a rising metallic ping. */
  crit: [
    { at: 0, freq: 190, to: 80, dur: 0.12, type: 'triangle', gain: 0.16 },
    { at: 0, freq: 0, dur: 0.07, type: 'sine', gain: 0.08, noise: 1, filter: 3200 },
    { at: 0.02, freq: 1480, to: 1980, dur: 0.16, type: 'square', gain: 0.045 },
  ],

  /* Taking damage. Lower, duller, longer than `hit`. */
  hurt: [
    { at: 0, freq: 130, to: 62, dur: 0.16, type: 'sawtooth', gain: 0.1 },
    { at: 0, freq: 0, dur: 0.1, type: 'sine', gain: 0.05, noise: 1, filter: 900 },
  ],

  /* Coins. Two bright pings a beat apart. */
  loot: [
    { at: 0, freq: 1320, dur: 0.05, type: 'square', gain: 0.05 },
    { at: 0.06, freq: 1760, dur: 0.07, type: 'square', gain: 0.045 },
  ],

  /* Level up: a four-note arpeggio. The one sound allowed to be pretty. */
  level: [
    { at: 0.0, freq: 523.25, dur: 0.1, type: 'triangle', gain: 0.07 },
    { at: 0.1, freq: 659.25, dur: 0.1, type: 'triangle', gain: 0.07 },
    { at: 0.2, freq: 783.99, dur: 0.1, type: 'triangle', gain: 0.07 },
    { at: 0.3, freq: 1046.5, dur: 0.26, type: 'triangle', gain: 0.08 },
  ],

  /* Death: a descending fall into a low thud. */
  death: [
    { at: 0, freq: 392, to: 98, dur: 0.5, type: 'sawtooth', gain: 0.09 },
    { at: 0.34, freq: 72, to: 48, dur: 0.34, type: 'triangle', gain: 0.12 },
  ],

  /* The wyrm: a low sub-bass swell. Felt more than heard. */
  wyrm: [
    { at: 0, freq: 58, to: 42, dur: 0.7, type: 'sawtooth', gain: 0.11 },
    { at: 0, freq: 87, to: 63, dur: 0.6, type: 'triangle', gain: 0.06 },
    { at: 0.1, freq: 0, dur: 0.5, type: 'sine', gain: 0.04, noise: 1, filter: 420 },
  ],

  /* A CRT settling. Quiet, and only heard once. */
  boot: [
    { at: 0, freq: 0, dur: 0.28, type: 'sine', gain: 0.045, noise: 1, filter: 5000 },
    { at: 0.02, freq: 120, to: 60, dur: 0.3, type: 'triangle', gain: 0.05 },
  ],
};

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

const MASTER_LEVEL = 0.9;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  /** Sound is on unless the player deliberately turns it off. */
  private enabled = true;
  private handshakeTimer: number | null = null;

  /**
   * True once a real AudioContext exists and has been asked to start.
   *
   * Note what this is NOT: a guarantee that `state === 'running'`. `resume()` is
   * asynchronous, so a caller that unlocks and immediately checks this would be
   * racing the browser. That race is exactly what silenced the modem on first
   * play — see the note on scheduling in `handshake()`.
   */
  get unlocked(): boolean {
    return this.ctx !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** The raw context state, for diagnostics. */
  get state(): AudioContextState | 'none' {
    return this.ctx?.state ?? 'none';
  }

  /**
   * Create or resume the context. MUST be called from a user gesture the first
   * time; browsers refuse to start audio otherwise.
   *
   * Returns false if the browser gave us nothing to work with, which is not an
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

        /* One gate between the graph and the speakers. Muting ramps this to
           zero instead of tearing the graph down, so it cannot click. */
        this.master = this.ctx.createGain();
        this.master.gain.value = this.enabled ? MASTER_LEVEL : 0;

        const compressor = this.ctx.createDynamicsCompressor();
        compressor.threshold.value = -18;
        compressor.knee.value = 12;
        compressor.ratio.value = 6;
        compressor.attack.value = 0.002;
        compressor.release.value = 0.14;

        this.master.connect(compressor);
        compressor.connect(this.ctx.destination);

        /* White noise, rendered once and reused forever. */
        const seconds = 1;
        const buffer = this.ctx.createBuffer(
          1,
          Math.floor(this.ctx.sampleRate * seconds),
          this.ctx.sampleRate,
        );
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
          data[i] = Math.random() * 2 - 1;
        }
        this.noiseBuffer = buffer;
      }

      /* Fire and forget: callers must NOT wait on this. Anything they schedule
         now will play when the promise settles. */
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }

      this.applyVolume();
      return true;
    } catch {
      this.ctx = null;
      return false;
    }
  }

  /** Turn sound on or off. Turning it on unlocks, because that IS a gesture. */
  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) this.unlock();
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.ctx || !this.master) return;
    const target = this.enabled ? MASTER_LEVEL : 0;
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    /* A short ramp, not a jump: an instant gain change is an audible click. */
    this.master.gain.setTargetAtTime(target, now, 0.015);
  }

  /* ---------------------------------------------------------------- */

  /**
   * Play one named sound. Silent and safe if audio is unavailable.
   *
   * No `state === 'running'` guard, deliberately: an AudioContext queues
   * scheduled sources and plays them once running, so a sound requested a few
   * milliseconds before `resume()` settles still plays. Checking the state here
   * was the other half of the first-gesture bug.
   */
  play(name: SoundName): void {
    if (!this.enabled || !this.ctx || !this.master) return;

    const design = DESIGNS[name];
    if (!design) return;

    const now = this.ctx.currentTime + 0.005;
    for (const voice of design) this.emit(voice, now);
  }

  private emit(voice: Voice, now: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const start = now + voice.at;
    const end = start + voice.dur;

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    /* 6ms attack keeps transients crisp without a pop. */
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0002, voice.gain), start + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.0001, end);

    const bus = ctx.createBiquadFilter();
    bus.type = 'lowpass';
    bus.frequency.setValueAtTime(voice.filter ?? 12000, start);
    bus.connect(envelope);
    envelope.connect(master);

    /* Tonal layer. `freq: 0` means "noise only". */
    if (voice.freq > 0) {
      const osc = ctx.createOscillator();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(voice.freq, start);
      if (voice.to && voice.to !== voice.freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, voice.to), end);
      }
      osc.connect(bus);
      osc.start(start);
      osc.stop(end + 0.02);
    }

    /* Noise layer, from the shared buffer. */
    if (voice.noise && this.noiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      /* Start at a random offset so repeated hits do not sound identical. */
      src.loop = true;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = voice.noise;
      src.connect(noiseGain);
      noiseGain.connect(bus);
      src.start(start, Math.random() * 0.8);
      src.stop(end + 0.02);
    }
  }

  /* ---------------------------------------------------------------- */
  /* The modem handshake                                               */
  /* ---------------------------------------------------------------- */

  /**
   * The full call: dial, answer, negotiate, train, and settle. ~5.9 seconds.
   *
   * A real V.32bis handshake took fifteen to twenty-five seconds. That is too
   * long for a game you play every day, but two seconds is too short to hear
   * what it actually was — the variety IS the sound. So this is a compression
   * that keeps every distinct *phase* rather than every second:
   *
   *   1. dial tone            350 + 440 Hz, the US standard pair
   *   2. DTMF                  three digits, real keypad tone pairs
   *   3. ringback              440 + 480 Hz
   *   4. answer tone           2100 Hz — the long answering beep
   *   5. CI                    1100 Hz, the caller identifying itself
   *   6. V.8 menu              alternating dual tones. The "beep boop"
   *   7. line probe            a sweep up the band and back down
   *   8. training              band-swept noise, the classic screech
   *   9. rate negotiation      three ascending pips
   *  10. final burst           dense scrambled data
   *  11. carrier settle        filtered hiss, then the CRT thunk
   *
   * Frequencies are the real ones where the standard fixed them (dial tone,
   * DTMF, 2100/1100 Hz, V.8 pairs). The sweeps and noise are stylised,
   * because their exact shape is not what anyone remembers — the texture is.
   *
   * THE BUG THIS USED TO HAVE: it bailed out when `ctx.state !== 'running'`.
   * `resume()` is asynchronous, so on the very first gesture the state was
   * still 'suspended' and the handshake scheduled nothing at all. Sound worked
   * on the second attempt and never the first. It now schedules regardless;
   * an AudioContext queues sources and plays them once running.
   *
   * Returns a cancel function, so leaving the boot screen early does not leave
   * the modem screaming into a menu.
   */
  handshake(): () => void {
    if (!this.enabled || !this.ctx || !this.master) return () => {};

    const ctx = this.ctx;
    const master = this.master;

    /* Nudge it if it is asleep. Scheduling works regardless. */
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);

    const t0 = ctx.currentTime + 0.02;
    const nodes: Array<{ stop(when: number): void }> = [];
    const timers: number[] = [];

    /** One oscillator with its own attack/sustain/release envelope. */
    const tone = (
      freq: number,
      start: number,
      dur: number,
      gain: number,
      type: OscillatorType = 'sine',
      sweepTo?: number,
    ) => {
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      const at = t0 + start;

      osc.type = type;
      osc.frequency.setValueAtTime(freq, at);
      if (sweepTo && sweepTo !== freq) {
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), at + dur);
      }

      /* 12ms attack, hold, 30ms release. Softer than the game SFX because
         these tones run for a long time and hard edges buzz. */
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(gain, at + 0.012);
      env.gain.setValueAtTime(gain, Math.max(at + 0.014, at + dur - 0.03));
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

      osc.connect(env);
      env.connect(master);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      nodes.push(osc);
    };

    /** Two tones at once — how DTMF and the V.8 menu actually work. */
    const dual = (
      a: number,
      b: number,
      start: number,
      dur: number,
      gain: number,
      type: OscillatorType = 'sine',
    ) => {
      tone(a, start, dur, gain, type);
      tone(b, start, dur, gain, type);
    };

    /** A keypad press: two tones, briefly. */
    const dtmf = (pair: [number, number], start: number, dur = 0.08) => {
      dual(pair[0], pair[1], start, dur, 0.045);
    };

    /** Filtered noise. `Q` high = whistly band, low = broadband hiss. */
    const noise = (
      start: number,
      dur: number,
      gain: number,
      opts: {
        type?: BiquadFilterType;
        freq?: number;
        sweepTo?: number;
        Q?: number;
      } = {},
    ) => {
      if (!this.noiseBuffer) return;
      const at = t0 + start;

      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;

      const band = ctx.createBiquadFilter();
      band.type = opts.type ?? 'bandpass';
      band.Q.value = opts.Q ?? 3;
      band.frequency.setValueAtTime(opts.freq ?? 1200, at);
      if (opts.sweepTo) {
        band.frequency.exponentialRampToValueAtTime(Math.max(60, opts.sweepTo), at + dur);
      }

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(gain, at + Math.min(0.05, dur * 0.25));
      env.gain.setValueAtTime(gain, Math.max(at + 0.06, at + dur - 0.05));
      env.gain.exponentialRampToValueAtTime(0.0001, at + dur);

      src.connect(band);
      band.connect(env);
      env.connect(master);
      src.start(at, Math.random() * 0.8);
      src.stop(at + dur + 0.02);
      nodes.push(src);
    };

    /** Quick alternation between two tone pairs. The "beep boop" texture. */
    const warble = (
      pairs: Array<[number, number]>,
      start: number,
      step: number,
      gain: number,
    ) => {
      pairs.forEach((pair, i) => {
        dual(pair[0], pair[1], start + i * step, step * 0.85, gain);
      });
    };

    /* ---- 1. dial tone, then off-hook --------------------------- */
    tone(350, 0.0, 0.5, 0.032);
    tone(440, 0.0, 0.5, 0.032);

    /* ---- 2. dialing. Three digits; a node is a short number. --- */
    dtmf([697, 1209], 0.56); // 1
    dtmf([770, 1336], 0.66); // 5
    dtmf([852, 1477], 0.76); // 9

    /* ---- 3. ringback -------------------------------------------- */
    dual(440, 480, 0.9, 0.22, 0.028);

    /* ---- 4. answer tone. The long beep everyone remembers. ------ */
    tone(2100, 1.2, 0.85, 0.042, 'sine');

    /* ---- 5. CI: the caller says who it is ----------------------- */
    tone(1100, 2.12, 0.26, 0.036);

    /* ---- 6. V.8 menu. Alternating dual tones. ------------------- */
    warble(
      [
        [980, 1180],
        [1180, 1380],
        [980, 1180],
        [1380, 1580],
        [1180, 1380],
      ],
      2.44,
      0.13,
      0.026,
    );

    /* ---- 7. line probe: sweep the band and come back ------------ */
    noise(3.12, 0.34, 0.05, { type: 'bandpass', freq: 500, sweepTo: 3200, Q: 6 });
    noise(3.48, 0.3, 0.045, { type: 'bandpass', freq: 3000, sweepTo: 700, Q: 5 });

    /* ---- 8. training. The screech. ------------------------------ */
    noise(3.82, 0.4, 0.062, { type: 'bandpass', freq: 900, sweepTo: 2400, Q: 4 });
    tone(1650, 3.85, 0.14, 0.026, 'square');
    tone(1070, 4.02, 0.14, 0.026, 'square');
    noise(4.18, 0.3, 0.05, { type: 'bandpass', freq: 2200, sweepTo: 1100, Q: 5 });

    /* ---- 9. rate negotiation: three ascending pips -------------- */
    tone(1420, 4.52, 0.055, 0.032, 'square');
    tone(1700, 4.6, 0.055, 0.032, 'square');
    tone(1980, 4.68, 0.07, 0.032, 'square');

    /* ---- 10. final burst. Dense, scrambled. --------------------- */
    noise(4.8, 0.34, 0.05, { type: 'bandpass', freq: 1600, sweepTo: 900, Q: 2.5 });
    tone(1240, 4.8, 0.34, 0.018, 'sawtooth', 880);
    noise(5.16, 0.24, 0.038, { type: 'highpass', freq: 2000, Q: 1 });

    /* ---- 11. carrier established, then the tube settles --------- */
    noise(5.44, 0.42, 0.02, { type: 'highpass', freq: 2600, Q: 1 });
    tone(96, 5.7, 0.2, 0.06, 'triangle');
    tone(180, 5.76, 0.09, 0.03, 'square');

    /* Nothing to clean up on the happy path: every node stops itself. The
       timer only exists so the returned cancel has something to clear. */
    timers.push(window.setTimeout(() => undefined, 6100));

    return () => {
      for (const t of timers) window.clearTimeout(t);
      const cutoff = ctx.currentTime;
      for (const node of nodes) {
        try {
          node.stop(cutoff);
        } catch {
          /* already stopped */
        }
      }
      if (this.handshakeTimer !== null) {
        window.clearTimeout(this.handshakeTimer);
        this.handshakeTimer = null;
      }
    };
  }

  /** A short burst of line noise. Used when the carrier re-establishes. */
  carrier(): void {
    if (!this.enabled || !this.ctx || !this.master || !this.noiseBuffer) return;

    const ctx = this.ctx;
    const start = ctx.currentTime + 0.01;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 1.2;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(0.035, start + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);

    src.connect(band);
    band.connect(env);
    env.connect(this.master);
    src.start(start);
    src.stop(start + 0.34);
  }

  /** Release the context. Called on unmount. */
  dispose(): void {
    if (this.handshakeTimer !== null) {
      window.clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
  }
}

/** The one engine the app uses. */
export const sound = new SoundEngine();
