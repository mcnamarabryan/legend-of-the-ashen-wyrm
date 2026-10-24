/**
 * THE CATALOGUE.
 *
 * Every sound in the game, as data. Nothing here renders anything — it is a
 * description of what each sound *is*, and `SoundEngine` turns descriptions into
 * audio. That split is the reason this file can be tuned forever without any
 * risk of breaking the renderer, and why the designs can be asserted on in tests
 * without an AudioContext.
 *
 * THE DESIGN LANGUAGE, agreed before writing any of it:
 *
 *  - **Nothing is a bare oscillator.** Every sound is a small stack: a body for
 *    weight, a transient for attack, and often a third partial for character.
 *    A single square blip is a notification beep, not a sword.
 *
 *  - **Impacts are low, bright, and short, in that order.** The body carries the
 *    weight below 200 Hz, the noise crack lands within the first 60 ms, and
 *    anything longer than 200 ms starts to sound like an explosion rather than
 *    a hit.
 *
 *  - **Gains are budgeted.** Each voice peaks between 0.02 and 0.09. Three
 *    voices summing to ~0.2 leaves the master bus and the compressor plenty of
 *    room, so nothing ever squashes. A game that clips is a game that sounds
 *    broken.
 *
 *  - **Reverb is a seasoning, not a sauce.** Sends run 0.05–0.25. Terminal
 *    sounds should feel like a stone room, not a church.
 *
 *  - **Jitter on repeats.** Hits and spells drift a few cents each time. Identical
 *    repetitions are the fastest way to make a sound feel synthetic.
 */

import type { SoundDesign, SoundName } from './Voice';

export const DESIGNS: Record<SoundName, SoundDesign> = {
  /* ------------------------------------------------------------------ */
  /* Keys                                                                */
  /* ------------------------------------------------------------------ */

  /**
   * The most-heard sound in the game, so it gets the most care.
   *
   * A real key mechanism is two events: a switch closing (bright, tiny) and the
   * key bottoming out (dull, lower). Modelling both is what makes it read as a
   * keyboard rather than a beep. Throttled, because mashing a key should not
   * stack forty of these into a buzz.
   */
  key: {
    trim: 0.9,
    throttleMs: 18,
    jitter: 26,
    voices: [
      {
        at: 0,
        freq: 0,
        dur: 0.016,
        gain: 0.026,
        noise: 1,
        noiseFilter: { type: 'highpass', freq: 2600, Q: 0.7 },
      },
      {
        at: 0,
        freq: 1150,
        to: 760,
        dur: 0.026,
        wave: 'pulse25',
        gain: 0.042,
        attack: 0.0015,
        falloff: 2.6,
      },
    ],
  },

  /** Committing: a two-step rise, with just enough room to feel deliberate. */
  select: {
    trim: 0.85,
    voices: [
      { at: 0, freq: 660, dur: 0.05, wave: 'pulse25', gain: 0.05, falloff: 2 },
      {
        at: 0.042,
        freq: 990,
        dur: 0.1,
        wave: 'pulse25',
        gain: 0.046,
        falloff: 1.8,
        send: 0.09,
      },
    ],
  },

  /** Backing out: the same shape, falling. */
  back: {
    trim: 0.85,
    voices: [
      { at: 0, freq: 620, dur: 0.05, wave: 'pulse25', gain: 0.048, falloff: 2 },
      {
        at: 0.042,
        freq: 380,
        dur: 0.085,
        wave: 'pulse25',
        gain: 0.042,
        falloff: 1.7,
        send: 0.07,
      },
    ],
  },

  /**
   * Refusal: no gold, no turns, name taken.
   *
   * Deliberately *not* a rising tone — a rejection must be audibly different
   * from a confirmation at a glance, or the player learns nothing from it. Low,
   * flat, and a little ugly.
   */
  deny: {
    trim: 0.8,
    voices: [
      { at: 0, freq: 185, dur: 0.075, wave: 'saw', gain: 0.05, toneFilter: 900, falloff: 1.4 },
      {
        at: 0.075,
        freq: 138,
        dur: 0.13,
        wave: 'saw',
        gain: 0.048,
        toneFilter: 700,
        falloff: 1.5,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* Combat                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * A blade landing. Three layers, because one is not enough:
   *   body     — 190 Hz triangle sweeping down, gives the impact weight
   *   crack    — a 45 ms noise burst, the actual contact
   *   sub      — 70 Hz sine, felt more than heard; absent on laptop speakers
   *                but it is what makes the hit land on headphones
   */
  hit: {
    trim: 1,
    jitter: 44,
    voices: [
      {
        at: 0,
        freq: 190,
        to: 88,
        dur: 0.1,
        wave: 'tri',
        gain: 0.115,
        attack: 0.002,
        falloff: 1.7,
      },
      {
        at: 0,
        freq: 0,
        dur: 0.045,
        gain: 0.07,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 2500, Q: 0.9 },
      },
      {
        at: 0,
        freq: 72,
        to: 54,
        dur: 0.13,
        wave: 'sine',
        gain: 0.055,
        falloff: 2,
      },
    ],
  },

  /** A miss is pure air: a filtered noise sweep falling away. */
  miss: {
    trim: 0.9,
    jitter: 60,
    voices: [
      {
        at: 0,
        freq: 0,
        dur: 0.15,
        gain: 0.055,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 1900, to: 620, Q: 1.4 },
        attack: 0.012,
      },
    ],
  },

  /**
   * A critical. The normal hit, plus a bright metallic ring an instant later —
   * so the ear hears "that was bigger" even before it reads the text.
   */
  crit: {
    trim: 0.95,
    jitter: 30,
    voices: [
      {
        at: 0,
        freq: 205,
        to: 80,
        dur: 0.14,
        wave: 'tri',
        gain: 0.135,
        attack: 0.002,
        falloff: 1.8,
      },
      {
        at: 0,
        freq: 0,
        dur: 0.06,
        gain: 0.085,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 3400, Q: 0.8 },
      },
      {
        at: 0.018,
        freq: 1480,
        to: 1980,
        dur: 0.19,
        wave: 'pulse12',
        gain: 0.038,
        falloff: 2.2,
        send: 0.13,
      },
      { at: 0, freq: 68, to: 50, dur: 0.16, wave: 'sine', gain: 0.06, falloff: 2 },
    ],
  },

  /** Taking damage: lower, duller and longer than dealing it. */
  hurt: {
    trim: 0.95,
    jitter: 30,
    voices: [
      {
        at: 0,
        freq: 132,
        to: 60,
        dur: 0.19,
        wave: 'saw',
        gain: 0.08,
        toneFilter: 760,
        falloff: 1.5,
      },
      {
        at: 0,
        freq: 0,
        dur: 0.1,
        gain: 0.05,
        noise: 1,
        noiseFilter: { type: 'lowpass', freq: 880, Q: 0.9 },
      },
      { at: 0, freq: 55, to: 44, dur: 0.22, wave: 'sine', gain: 0.05, falloff: 2.2 },
    ],
  },

  /** A thief slipping a blow: a light, high swish. Shorter than a miss. */
  dodge: {
    trim: 0.8,
    jitter: 70,
    voices: [
      {
        at: 0,
        freq: 0,
        dur: 0.095,
        gain: 0.042,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 2600, to: 950, Q: 2.2 },
        attack: 0.008,
      },
    ],
  },

  /** A magician's spell: shimmer, rising, with air around it. */
  spell: {
    trim: 0.9,
    jitter: 35,
    voices: [
      {
        at: 0,
        freq: 520,
        to: 1320,
        dur: 0.24,
        wave: 'tri',
        gain: 0.045,
        attack: 0.01,
        falloff: 2,
        send: 0.18,
      },
      {
        at: 0,
        freq: 0,
        dur: 0.21,
        gain: 0.038,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 1200, to: 4400, Q: 3.2 },
        attack: 0.02,
      },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* Reward                                                              */
  /* ------------------------------------------------------------------ */

  /** Gold. Two coins, a beat apart, bright and metallic. */
  loot: {
    trim: 0.9,
    jitter: 18,
    voices: [
      { at: 0, freq: 1320, dur: 0.055, wave: 'pulse12', gain: 0.04, falloff: 2.4 },
      { at: 0.058, freq: 1760, dur: 0.08, wave: 'pulse12', gain: 0.036, falloff: 2.2, send: 0.1 },
      { at: 0.058, freq: 2640, dur: 0.05, wave: 'sine', gain: 0.018, falloff: 3 },
    ],
  },

  /** A single smaller chime — used when the amount is small. */
  coin: {
    trim: 0.75,
    jitter: 22,
    voices: [{ at: 0, freq: 2093, dur: 0.11, wave: 'sine', gain: 0.03, falloff: 2.6, send: 0.12 }],
  },

  /**
   * Level up. The one sound allowed to be genuinely pretty.
   *
   * A rising arpeggio (C–E–G–C) that resolves into a sustained triad, so the
   * phrase sounds finished rather than cut off. Triangles and organ rather than
   * squares: this is the moment the player earned, and it should not sound like
   * a calculator.
   */
  level: {
    trim: 0.9,
    voices: [
      { at: 0.0, freq: 523.25, dur: 0.11, wave: 'tri', gain: 0.055, falloff: 1.6, send: 0.12 },
      { at: 0.1, freq: 659.25, dur: 0.11, wave: 'tri', gain: 0.055, falloff: 1.6, send: 0.12 },
      { at: 0.2, freq: 783.99, dur: 0.11, wave: 'tri', gain: 0.055, falloff: 1.6, send: 0.14 },
      { at: 0.3, freq: 1046.5, dur: 0.3, wave: 'tri', gain: 0.06, falloff: 1.4, send: 0.2 },
      /* The sustained chord under the last note. */
      { at: 0.3, freq: 523.25, dur: 0.42, wave: 'organ', gain: 0.03, shape: 'sustain', hold: 0.12, send: 0.24 },
      { at: 0.3, freq: 659.25, dur: 0.42, wave: 'organ', gain: 0.026, shape: 'sustain', hold: 0.12, send: 0.24 },
      { at: 0.3, freq: 783.99, dur: 0.42, wave: 'organ', gain: 0.024, shape: 'sustain', hold: 0.12, send: 0.24 },
    ],
  },

  /** Healing: a warm major triad blooming upward. */
  heal: {
    trim: 0.85,
    voices: [
      { at: 0, freq: 440, dur: 0.18, wave: 'tri', gain: 0.038, falloff: 1.5, send: 0.16 },
      { at: 0.06, freq: 660, dur: 0.22, wave: 'tri', gain: 0.036, falloff: 1.5, send: 0.18 },
      { at: 0.12, freq: 880, dur: 0.28, wave: 'tri', gain: 0.034, falloff: 1.4, send: 0.2 },
    ],
  },

  /* ------------------------------------------------------------------ */
  /* The dark                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Death. A long fall into a low thud, then silence.
   *
   * This is the longest sound in the game and the only one with a heavy reverb
   * send. It is also the only moment the player is allowed to sit for a second.
   */
  death: {
    trim: 0.95,
    voices: [
      {
        at: 0,
        freq: 392,
        to: 96,
        dur: 0.56,
        wave: 'saw',
        gain: 0.072,
        toneFilter: 1250,
        falloff: 1.3,
        send: 0.22,
      },
      { at: 0.34, freq: 72, to: 46, dur: 0.42, wave: 'tri', gain: 0.1, falloff: 1.9 },
      {
        at: 0.3,
        freq: 0,
        dur: 0.3,
        gain: 0.03,
        noise: 1,
        noiseFilter: { type: 'lowpass', freq: 520, Q: 1.1 },
      },
    ],
  },

  /**
   * The Ashen Wyrm. Sub-bass swell with a slow growl.
   *
   * The vibrato is what does the work: a static 58 Hz drone is a hum, but a
   * drone that wobbles at 5.5 Hz reads as breathing. Most of this is below the
   * range of a laptop speaker, deliberately — on headphones it should be felt
   * in the chest.
   */
  wyrm: {
    trim: 1,
    voices: [
      {
        at: 0,
        freq: 58,
        to: 42,
        dur: 0.78,
        wave: 'saw',
        gain: 0.095,
        toneFilter: 420,
        attack: 0.06,
        falloff: 1.4,
        vibrato: { rate: 5.5, depth: 14 },
        send: 0.2,
      },
      {
        at: 0,
        freq: 87,
        to: 63,
        dur: 0.66,
        wave: 'tri',
        gain: 0.05,
        attack: 0.05,
        falloff: 1.5,
        vibrato: { rate: 5.5, depth: 9 },
      },
      {
        at: 0.1,
        freq: 0,
        dur: 0.55,
        gain: 0.032,
        noise: 1,
        noiseFilter: { type: 'lowpass', freq: 430, Q: 1.4 },
        attack: 0.12,
      },
    ],
  },

  /** A CRT settling: a thin hiss and a low thunk. Heard once per session. */
  boot: {
    trim: 0.9,
    voices: [
      {
        at: 0,
        freq: 0,
        dur: 0.28,
        gain: 0.04,
        noise: 1,
        noiseFilter: { type: 'highpass', freq: 4800, Q: 0.7 },
      },
      { at: 0.02, freq: 120, to: 58, dur: 0.3, wave: 'tri', gain: 0.045, falloff: 2.4 },
    ],
  },

  /**
   * Someone else moved in the realm.
   *
   * Quiet on purpose — this fires from the realm feed while the player is
   * reading, and an intrusive sound for background events trains people to
   * mute the game. A soft two-note notice, mixed well below everything else.
   */
  realm: {
    trim: 0.6,
    voices: [
      { at: 0, freq: 880, dur: 0.075, wave: 'sine', gain: 0.022, falloff: 2.2 },
      { at: 0.08, freq: 1108.7, dur: 0.11, wave: 'sine', gain: 0.02, falloff: 2.2, send: 0.12 },
    ],
  },
};

/** Every name in the catalogue, for iteration and tests. */
export const SOUND_NAMES = Object.keys(DESIGNS) as SoundName[];
