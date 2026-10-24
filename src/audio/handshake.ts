/**
 * THE CALL.
 *
 * A modem handshake, synthesised. Not sampled — every tone here is generated,
 * because a handshake genuinely *was* a sequence of tones and tones are cheap.
 *
 * WHY IT IS LONG. A real V.32bis negotiation ran fifteen to twenty-five seconds.
 * That is too long for a game you open every day, but two seconds is too short
 * for the ear to hear what the thing actually was — the *variety* is the sound.
 * So this compresses by keeping every distinct phase and shortening each one,
 * rather than by deleting phases. The result lands near seven seconds, which is
 * long enough to be an event and short enough to press a key through.
 *
 * THE PHASES, in order, with the frequencies the standards actually fixed:
 *
 *    1. off-hook click + dial tone     350 + 440 Hz (North American)
 *    2. DTMF dialling                  real keypad pairs
 *    3. ringback                       440 + 480 Hz
 *    4. answer tone                    2100 Hz, with a phase reversal at 450 ms
 *                                      — ANSI/TIA-464B, which is why real
 *                                      handshakes have that "bzzt" hiccup
 *    5. CI                             1100 Hz, the caller identifying itself
 *    6. V.8 menu                       alternating dual tones, the beep-boop
 *    7. line probe                     band sweeps up and back
 *    8. training                       the screech: swept noise, pulsing
 *    9. rate negotiation               three ascending pips
 *   10. data burst                     rapid frequency hopping
 *   11. carrier                        filtered hiss, then the CRT thunk
 *
 * The phase reversal in (4) is the detail that makes this sound *recorded*
 * rather than composed. Dial tones and DTMF are exact; the sweeps are stylised,
 * because nobody remembers a waveform — they remember a texture.
 *
 * RETURN VALUE. `scheduleHandshake` returns its duration in seconds so the UI
 * never has to keep a hand-copied constant in sync with this file. That was a
 * real bug waiting to happen: `HANDSHAKE_MS` in the shell and the timeline here
 * were two numbers that had to agree, with nothing enforcing it.
 */

import { SILENCE } from './Voice';
import { harmonicsFor, makeWave, WAVE_FALLBACK } from './waves';
import { noiseBufferFor } from './render';

export interface HandshakeHandle {
  /** Total length of the call, in seconds. */
  duration: number;
  /** Stop everything still scheduled. Safe to call twice. */
  cancel(): void;
}

/**
 * Build and schedule the call. `at` is an absolute context time.
 *
 * Every node is scheduled against absolute times, so the whole sequence is
 * sample-accurate even if the main thread stalls mid-schedule.
 */
export function scheduleHandshake(
  ctx: BaseAudioContext,
  destination: AudioNode,
  at: number,
): HandshakeHandle {
  const scheduled: Array<{ stop(when: number): void }> = [];
  const pending: number[] = [];

  const noise = noiseBufferFor(ctx);

  /* Powers of two for the "many small events" jitter below. */
  const rand = (min: number, max: number) => min + Math.random() * (max - min);

  /** One enveloped tone. Returns nothing; the node stops itself. */
  const tone = (
    freq: number,
    start: number,
    dur: number,
    gain: number,
    opts: {
      wave?: 'sine' | 'square' | 'saw' | 'tri' | 'pulse25' | 'pulse12' | 'organ';
      sweepTo?: number;
      pan?: number;
      attack?: number;
      release?: number;
    } = {},
  ): void => {
    const t0 = at + start;
    const t1 = t0 + dur;

    const osc = ctx.createOscillator();
    const kind = opts.wave ?? 'sine';

    const wave = kind === 'sine' ? null : makeWave(ctx, kind, harmonicsFor(freq, ctx.sampleRate));
    if (wave) osc.setPeriodicWave(wave);
    else osc.type = WAVE_FALLBACK[kind];

    osc.frequency.setValueAtTime(freq, t0);
    if (opts.sweepTo && opts.sweepTo !== freq) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t1);
    }

    const env = ctx.createGain();
    /*
     * Handshake tones are held, not struck — a 12 ms attack and a 40 ms release
     * so long tones do not buzz at the edges. This is the opposite of the
     * percussive envelope the game's impacts use, and it is why they read
     * differently: one is a machine, the other is a blow.
     */
    const attack = Math.min(opts.attack ?? 0.012, dur * 0.4);
    const release = Math.min(opts.release ?? 0.04, dur * 0.4);

    env.gain.setValueAtTime(SILENCE, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.setValueAtTime(gain, Math.max(t0 + attack + 0.001, t1 - release));
    env.gain.exponentialRampToValueAtTime(SILENCE, t1);

    let out: AudioNode = env;

    if (typeof ctx.createStereoPanner === 'function' && opts.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(opts.pan, t0);
      env.connect(panner);
      out = panner;
    }

    osc.connect(env);
    out.connect(destination);

    osc.start(t0);
    osc.stop(t1 + 0.02);
    scheduled.push(osc);
  };

  /** Two tones at once — how DTMF and the V.8 menu genuinely work. */
  const dual = (
    a: number,
    b: number,
    start: number,
    dur: number,
    gain: number,
    wave?: 'sine' | 'square',
  ): void => {
    tone(a, start, dur, gain, { wave });
    tone(b, start, dur, gain, { wave });
  };

  /** A keypad press: the real tone pair, briefly, with a click. */
  const dtmf = (pair: [number, number], start: number, dur = 0.075): void => {
    dual(pair[0], pair[1], start, dur, 0.042);
    /* The click of the button itself, under the tone. */
    noiseBurst(start, 0.008, 0.014, { type: 'highpass', freq: 3200, Q: 0.8 });
  };

  /** Filtered noise bed. */
  const noiseBurst = (
    start: number,
    dur: number,
    gain: number,
    opts: {
      type?: BiquadFilterType;
      freq?: number;
      sweepTo?: number;
      Q?: number;
      pan?: number;
    } = {},
  ): void => {
    const t0 = at + start;
    const t1 = t0 + dur;

    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = opts.type ?? 'bandpass';
    band.Q.value = opts.Q ?? 3;
    band.frequency.setValueAtTime(Math.max(20, opts.freq ?? 1200), t0);
    if (opts.sweepTo) {
      band.frequency.exponentialRampToValueAtTime(Math.max(20, opts.sweepTo), t1);
    }

    const env = ctx.createGain();
    const attack = Math.min(0.04, dur * 0.25);
    env.gain.setValueAtTime(SILENCE, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.setValueAtTime(gain, Math.max(t0 + attack + 0.001, t1 - 0.04));
    env.gain.exponentialRampToValueAtTime(SILENCE, t1);

    let out: AudioNode = env;
    if (typeof ctx.createStereoPanner === 'function' && opts.pan) {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(opts.pan, t0);
      env.connect(panner);
      out = panner;
    }

    src.connect(band);
    band.connect(env);
    out.connect(destination);

    src.start(t0, Math.random() * 0.7);
    src.stop(t1 + 0.02);
    scheduled.push(src);
  };

  /* ------------------------------------------------------------------ */
  /* 1. Off-hook, then dial tone                                        */
  /* ------------------------------------------------------------------ */

  /* The pickup: a small mechanical clack before any tone appears. */
  noiseBurst(0, 0.02, 0.03, { type: 'bandpass', freq: 1800, Q: 1.2 });

  tone(350, 0.02, 0.52, 0.03);
  tone(440, 0.02, 0.52, 0.03);

  /* ------------------------------------------------------------------ */
  /* 2. Dialling                                                        */
  /* ------------------------------------------------------------------ */

  dtmf([697, 1209], 0.6); // 1
  dtmf([770, 1336], 0.72); // 5
  dtmf([852, 1477], 0.84); // 9

  /* ------------------------------------------------------------------ */
  /* 3. Ringback — one burst, compressed                               */
  /* ------------------------------------------------------------------ */

  dual(440, 480, 0.98, 0.24, 0.026);
  /* The silence between rings, then a second ring. Silence is part of it. */
  dual(440, 480, 1.36, 0.24, 0.026);

  /* ------------------------------------------------------------------ */
  /* 4. Answer tone, with the phase reversal                            */
  /* ------------------------------------------------------------------ */

  /*
   * Real answer tones invert phase about 450 ms in. The ear hears it as a small
   * "bzt" hiccup rather than a change in pitch, because the frequency is
   * unchanged — only the sign flips. Modelling it is cheap and it is the single
   * most convincing detail in the whole sequence.
   */
  tone(2100, 1.72, 0.44, 0.038);
  tone(2100, 2.16, 0.46, 0.038);
  /* A dull thump at the reversal point sells the discontinuity. */
  noiseBurst(2.15, 0.02, 0.018, { type: 'bandpass', freq: 900, Q: 2 });

  /* ------------------------------------------------------------------ */
  /* 5. CI — caller identification                                      */
  /* ------------------------------------------------------------------ */

  tone(1100, 2.72, 0.28, 0.034);

  /* ------------------------------------------------------------------ */
  /* 6. V.8 menu — alternating pairs. The beep-boop.                     */
  /* ------------------------------------------------------------------ */

  const menu: Array<[number, number]> = [
    [980, 1180],
    [1180, 1380],
    [980, 1180],
    [1380, 1580],
    [1180, 1380],
    [1580, 1780],
    [1180, 1380],
  ];
  menu.forEach((pair, i) => {
    dual(pair[0], pair[1], 3.06 + i * 0.115, 0.1, 0.024);
  });

  /* ------------------------------------------------------------------ */
  /* 7. Line probe — sweeps out and back                                 */
  /* ------------------------------------------------------------------ */

  noiseBurst(3.9, 0.36, 0.05, { type: 'bandpass', freq: 460, sweepTo: 3400, Q: 6 });
  noiseBurst(4.26, 0.32, 0.045, { type: 'bandpass', freq: 3100, sweepTo: 640, Q: 5 });

  /* ------------------------------------------------------------------ */
  /* 8. Training — the screech                                          */
  /* ------------------------------------------------------------------ */

  noiseBurst(4.6, 0.42, 0.058, { type: 'bandpass', freq: 880, sweepTo: 2500, Q: 4 });
  tone(1650, 4.63, 0.15, 0.024, { wave: 'square' });
  tone(1070, 4.8, 0.15, 0.024, { wave: 'square' });
  /* A pulse train over the top: the trill that makes a modem sound mechanical. */
  for (let i = 0; i < 6; i += 1) {
    tone(1400 + i * 90, 4.63 + i * 0.05, 0.03, 0.012, { wave: 'pulse25' });
  }
  noiseBurst(4.98, 0.34, 0.048, { type: 'bandpass', freq: 2300, sweepTo: 1050, Q: 5 });

  /* ------------------------------------------------------------------ */
  /* 9. Rate negotiation                                                */
  /* ------------------------------------------------------------------ */

  tone(1420, 5.36, 0.05, 0.028, { wave: 'square' });
  tone(1700, 5.44, 0.05, 0.028, { wave: 'square' });
  tone(1980, 5.52, 0.07, 0.028, { wave: 'square' });

  /* ------------------------------------------------------------------ */
  /* 10. Data burst — rapid frequency hopping                           */
  /* ------------------------------------------------------------------ */

  /*
   * This is the phase that most stylised modem sounds get wrong. Real data over
   * a phone line is not one long tone; it is thousands of symbol transitions per
   * second, which the ear hears as a dense, glassy chatter. We cannot schedule
   * thousands of oscillators, so we approximate: a fast random walk through a
   * tone grid, using a thin pulse wave so each hop has an edge.
   *
   * Twenty-four hops over 380 ms reads convincingly as scrambled data.
   */
  const hopGrid = [1080, 1240, 1420, 1580, 1720, 1880, 2040, 2240, 2420, 2660];
  const hopDuration = 0.016;
  for (let i = 0; i < 24; i += 1) {
    const freq = hopGrid[Math.floor(Math.random() * hopGrid.length)];
    tone(freq, 5.66 + i * hopDuration, hopDuration * 0.92, 0.016, {
      wave: 'pulse12',
      pan: rand(-0.35, 0.35),
    });
  }

  /* A low bed under the chatter, so it has weight rather than only glitter. */
  noiseBurst(5.66, 0.38, 0.026, { type: 'lowpass', freq: 1100, Q: 1 });
  tone(1960, 5.66, 0.38, 0.012, { wave: 'saw', sweepTo: 1400 });

  /* ------------------------------------------------------------------ */
  /* 11. Carrier                                                        */
  /* ------------------------------------------------------------------ */

  /* The hiss thins out, then a low tone says the line is live. */
  noiseBurst(6.08, 0.34, 0.03, { type: 'highpass', freq: 2400, Q: 0.9 });
  tone(1480, 6.1, 0.14, 0.014, { wave: 'sine' });
  tone(96, 6.32, 0.2, 0.052, { wave: 'tri' });
  tone(180, 6.38, 0.09, 0.022, { wave: 'square' });

  /* The last of it: a soft click as the carrier settles. */
  noiseBurst(6.5, 0.03, 0.016, { type: 'bandpass', freq: 1500, Q: 1.5 });

  const duration = 6.66;

  /* Keep a timer alive so the handle has something to clear. */
  if (typeof window !== 'undefined') {
    pending.push(window.setTimeout(() => undefined, duration * 1000 + 500));
  }

  let cancelled = false;

  return {
    duration,
    cancel(): void {
      if (cancelled) return;
      cancelled = true;

      for (const id of pending) window.clearTimeout(id);
      for (const node of scheduled) {
        try {
          node.stop(ctx.currentTime);
        } catch {
          /* already stopped — `stop` throws if called before `start` */
        }
      }
      scheduled.length = 0;
    },
  };
}
