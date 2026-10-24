/**
 * THE VOCABULARY OF THE SOUND ENGINE.
 *
 * A sound is **data**, not code. Each one is a small stack of `Voice` records,
 * and the engine knows how to render any stack. That separation is why the
 * catalogue can be tuned endlessly without touching the renderer, and why a
 * test can assert something meaningful about a sound without playing it.
 *
 * No imports here on purpose: every other audio module depends on this file, so
 * this file must depend on nothing.
 */

/** Every sound the game can make. Referenced by name from `cues.ts`. */
export type SoundName =
  | 'key'
  | 'select'
  | 'back'
  | 'deny'
  | 'hit'
  | 'miss'
  | 'crit'
  | 'hurt'
  | 'dodge'
  | 'loot'
  | 'coin'
  | 'level'
  | 'death'
  | 'wyrm'
  | 'boot'
  | 'spell'
  | 'heal'
  | 'realm';

/**
 * Timbres. Resolved to a band-limited `PeriodicWave` at render time — see
 * `waves.ts` for why that matters rather than setting `osc.type = 'square'`.
 *
 * `sine` is included because it is the correct choice for a sub-bass layer:
 * added harmonics in a 60 Hz body just make it muddy. It needs no band-limiting.
 */
export type WaveKind = 'sine' | 'square' | 'saw' | 'tri' | 'pulse25' | 'pulse12' | 'organ';

export interface FilterSpec {
  type: BiquadFilterType;
  /** Cutoff in Hz at the start of the voice. */
  freq: number;
  /** Cutoff to sweep to over the voice's duration. */
  to?: number;
  /** Resonance. 0.7 is neutral; higher whistles, lower is a gentle roll-off. */
  Q?: number;
}

/**
 * One layer of a sound.
 *
 * A "voice" is a single generator (oscillator, noise, or both) behind one
 * envelope. Sounds are built by stacking them with `at` offsets — a hit is a
 * low body plus a noise crack plus a metallic ring, starting within a few
 * milliseconds of each other.
 */
export interface Voice {
  /** Offset from the sound's start, in seconds. Can be negative-free only. */
  at: number;

  /**
   * Random ± seconds applied to `at`, per firing.
   *
   * This exists for the keyboard. A keyswitch produces a press and a release, and
   * the gap between them is how long a human held the key — which varies by tens
   * of milliseconds every single time. Without jitter on that gap, the pair is
   * mechanically identical on every keystroke and the ear hears a drum machine
   * rather than a keyboard.
   */
  atJitter?: number;

  /** Fundamental in Hz. `0` means noise-only. */
  freq: number;
  /** Sweep target in Hz. Omitted for a steady pitch. */
  to?: number;

  /** Duration in seconds. */
  dur: number;

  /** Timbre. Defaults to a sine, which is the neutral choice for a partial. */
  wave?: WaveKind;

  /** Peak linear gain for this voice. Keep sums well under 1.0. */
  gain: number;

  /* ---- envelope ------------------------------------------------- */
  /** Seconds to reach peak. Short = percussive. Default 0.006. */
  attack?: number;
  /** Seconds to hold at peak before the tail begins. */
  hold?: number;
  /** Seconds of release at the end. Default: the remainder of `dur`. */
  release?: number;
  /**
   * How the level behaves after the attack.
   *
   *  - `percussive` (default): decays from peak to near-silence across the
   *    whole duration. This is what gives a hit its body instead of a click.
   *  - `sustain`: holds at peak then releases. For pads and held tones.
   */
  shape?: 'percussive' | 'sustain';
  /** Exponent of the percussive decay. 1 = natural, >1 = snappier. */
  falloff?: number;

  /* ---- colour --------------------------------------------------- */
  /** Lowpass on the tonal layer, to take the fizz off high harmonics. */
  toneFilter?: number;
  /** Noise layer amplitude, 0–1. Mixed on top of the tonal layer. */
  noise?: number;
  /** Filter applied to the noise layer only. */
  noiseFilter?: FilterSpec;

  /* ---- placement ------------------------------------------------ */
  /** Stereo position, −1 (left) to +1 (right). */
  pan?: number;
  /** Reverb send, 0–1. A little goes a long way. */
  send?: number;

  /* ---- movement ------------------------------------------------- */
  /** Detune in cents. Small values thicken a stack; large ones beat. */
  detune?: number;
  /** Pitch vibrato, for growls and wails. */
  vibrato?: { rate: number; depth: number };
}

/** A complete sound: one or more voices, plus playback-wide settings. */
export interface SoundDesign {
  voices: Voice[];
  /**
   * Master trim for the design, applied to every voice.
   *
   * Exists because a four-voice arpeggio and a single keyclick cannot share a
   * gain scale — without this, one is inaudible or the other clips.
   */
  trim?: number;
  /** Minimum ms between plays. Stops key-mash stutter. */
  throttleMs?: number;
  /** Random pitch drift in cents, so repeats are never identical. */
  jitter?: number;
  /**
   * Alternate voice stacks, chosen at random per firing.
   *
   * Pitch jitter makes the *same* sound slightly different each time; this makes
   * it a *different sound*. That is the distinction between a keyboard and a
   * synthesiser playing one note — a real board varies in the case, the plate,
   * and which finger landed on which cap, and no amount of detuning imitates it.
   *
   * When present, one of `voices` or one `variants` entry is chosen each firing.
   */
  variants?: Voice[][];
  /**
   * ± fraction applied to every voice's gain, per firing.
   *
   * Velocity. Two keystrokes are never the same force, and a keyboard where
   * every key is hit at exactly the same volume reads as a click track.
   */
  gainJitter?: number;
}

/**
 * Every voice stack a design can produce.
 *
 * A helper rather than a convention, so "pick one at random" is defined in one
 * place and the renderer and the tests cannot disagree about it.
 */
export function stacksFor(design: SoundDesign): Voice[][] {
  return [design.voices, ...(design.variants ?? [])].filter((s) => s.length > 0);
}

/** The quietest level an exponential ramp may target (it cannot reach 0). */
export const SILENCE = 0.0001;

/**
 * Human loudness is not linear, so a volume control should not be either.
 * Four steps is plenty for a terminal game and avoids a slider.
 */
export const VOLUME_STEPS = [0.3, 0.55, 0.8, 1] as const;
export type VolumeStep = (typeof VOLUME_STEPS)[number];

/** Map a 0–1 setting onto the nearest perceptual step. */
export function quantiseVolume(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  let best = VOLUME_STEPS[0] as number;
  let bestGap = Infinity;
  for (const step of VOLUME_STEPS) {
    const gap = Math.abs(step - clamped);
    if (gap < bestGap) {
      bestGap = gap;
      best = step;
    }
  }
  return best;
}
