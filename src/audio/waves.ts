/**
 * BAND-LIMITED WAVES AND A SYNTHETIC ROOM.
 *
 * Two things live here, both of which exist to stop the game sounding cheap.
 *
 * 1. **Band-limited waveforms.** A plain oscillator with `type = 'square'` is
 *    mathematically perfect and audibly wrong: a true square contains every odd
 *    harmonic out to infinity, and everything above Nyquist folds back down as
 *    inharmonic garbage. That aliasing is the biggest single reason a
 *    synthesised retro sound reads as "cheap beep" rather than "1989 hardware".
 *    A `PeriodicWave` built from an explicit harmonic series is band-limited by
 *    construction — we simply stop writing harmonics, so nothing folds.
 *
 * 2. **An impulse response for a small room.** Reverb is what separates a sound
 *    from a signal. We cannot ship an IR file (no assets, no network), so we
 *    synthesise one: exponentially decaying noise plus a few early reflections.
 *    That is exactly how a diffusion/plate reverb is modelled, and at this size
 *    it is indistinguishable from a sampled one.
 *
 * Everything is cached per-context. Building a 32-harmonic Fourier series on
 * every keypress would be waste; building it once and reusing it is free.
 */

import type { WaveKind } from './Voice';

/**
 * What to fall back to when `createPeriodicWave` is unavailable.
 *
 * Only matters for stubbed environments (tests, exotic browsers). The plain
 * oscillator types are the unaesthetic-but-correct fallback — better a slightly
 * buzzy beep than silence.
 */
export const WAVE_FALLBACK: Record<WaveKind, OscillatorType> = {
  sine: 'sine',
  square: 'square',
  saw: 'sawtooth',
  tri: 'triangle',
  pulse25: 'square',
  pulse12: 'square',
  organ: 'triangle',
};

/**
 * Fourier coefficients for each timbre.
 *
 * `imag[n]` weights the nth sine harmonic; `real` stays zero because these are
 * all odd/even symmetric waveforms that need no cosine terms. Index 0 is DC and
 * is never written.
 *
 * The formulas are the textbook series:
 *   square  → 1/n on odd harmonics
 *   saw     → 1/n on all harmonics
 *   tri     → 1/n² on odd harmonics, alternating sign
 *   pulse   → (2/nπ)·sin(nπ·duty), a square with a duty cycle
 */
function coefficients(kind: WaveKind, harmonics: number): Float32Array {
  const imag = new Float32Array(harmonics + 1);

  for (let n = 1; n <= harmonics; n += 1) {
    switch (kind) {
      case 'sine':
        /* No harmonics: a sine is only its fundamental. That is precisely why
           it is the right choice for a sub-bass body — extra partials down
           there just read as mud. */
        if (n === 1) imag[n] = 1;
        break;
      case 'square':
        if (n % 2 === 1) imag[n] = 1 / n;
        break;
      case 'saw':
        imag[n] = 1 / n;
        break;
      case 'tri':
        if (n % 2 === 1) {
          const sign = ((n - 1) / 2) % 2 === 0 ? 1 : -1;
          imag[n] = sign / (n * n);
        }
        break;
      case 'pulse25':
        imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.25);
        break;
      case 'pulse12':
        imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * 0.125);
        break;
      case 'organ': {
        /* A drawbar-ish stack: fundamental plus a few strong partials. Hollow
           and wooden — the sound of a cheap 80s tone generator. */
        const stack = [0, 1, 0.5, 0.35, 0.2, 0.12, 0.08];
        if (n < stack.length) imag[n] = stack[n];
        break;
      }
    }
  }

  return imag;
}

const WAVE_CACHE = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();

/**
 * A band-limited `PeriodicWave` for the given timbre, or `null` if the
 * environment cannot make one.
 *
 * `harmonics` should shrink as frequency rises. A 24-harmonic saw at 120 Hz is
 * warm; at 4 kHz most of those partials are above Nyquist and are pure waste.
 */
export function makeWave(
  ctx: BaseAudioContext,
  kind: WaveKind,
  harmonics: number,
): PeriodicWave | null {
  if (typeof ctx.createPeriodicWave !== 'function') return null;

  const count = Math.max(2, Math.min(64, Math.round(harmonics)));
  const key = `${kind}:${count}`;

  let perContext = WAVE_CACHE.get(ctx);
  if (!perContext) {
    perContext = new Map<string, PeriodicWave>();
    WAVE_CACHE.set(ctx, perContext);
  }

  const cached = perContext.get(key);
  if (cached) return cached;

  try {
    const real = new Float32Array(count + 1);
    const imag = coefficients(kind, count);
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    perContext.set(key, wave);
    return wave;
  } catch {
    return null;
  }
}

/**
 * How many harmonics to feed a wave at a given pitch.
 *
 * Nyquist is `sampleRate / 2`. With a fundamental of `f` we may safely include
 * about `nyquist / f` harmonics. Sampled at 45% of Nyquist for headroom, capped
 * at 32 so the Fourier construction stays cheap.
 */
export function harmonicsFor(freq: number, sampleRate: number): number {
  if (freq <= 0) return 8;
  const safe = Math.floor((sampleRate * 0.45) / freq);
  return Math.max(3, Math.min(32, safe));
}

/**
 * A small bright room — the sound of a stone inn, not a cathedral.
 *
 * The dry path is handled separately; this is only the diffuse tail. Structure:
 * exponentially decaying noise with high partials dying slightly faster (real
 * materials do that), plus irregularly spaced early reflections. Even spacing
 * would sound like a comb filter rather than a room, which is why the offsets
 * below are deliberately unmusical.
 */
export function makeImpulse(ctx: BaseAudioContext, seconds = 1.3): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(rate * seconds));
  const buffer = ctx.createBuffer(2, length, rate);

  const reflections = [0.011, 0.019, 0.027, 0.041, 0.058, 0.079];

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);

    /* Decorrelated noise per channel gives stereo width from a mono source. */
    let previous = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const white = Math.random() * 2 - 1;

      /* A gentle one-pole lowpass that darkens the tail as it ages. */
      previous = previous * 0.62 + white * 0.38;

      /* Exponential decay, with a very short fade-in so the tail cannot click. */
      const envelope = Math.pow(1 - t, 2.6) * Math.min(1, t * 90);
      data[i] = previous * envelope * 0.55;
    }

    /* Stamp in the early reflections, slightly offset per channel. */
    reflections.forEach((offset, index) => {
      const centre = Math.floor((offset + channel * 0.003) * rate);
      const strength = 0.42 / (index + 1);
      const width = Math.floor(rate * 0.002);

      for (let k = -width; k <= width; k += 1) {
        const at = centre + k;
        if (at < 0 || at >= length) continue;
        const shape = 1 - Math.abs(k) / width;
        data[at] += strength * shape;
      }
    });

    /* Normalise so the wet path cannot swamp the dry path. */
    let peak = 0;
    for (let i = 0; i < length; i += 1) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    if (peak > 0) {
      const scale = 0.85 / peak;
      for (let i = 0; i < length; i += 1) data[i] *= scale;
    }
  }

  return buffer;
}
