/**
 * THE KEYBOARD.
 *
 * A mechanical key is not one sound. It is four, and the reason most synthesisers
 * fail to imitate one is that they only model the first:
 *
 *   1. **The press** — the switch's contact, a dry high transient. Milliseconds.
 *   2. **The bottom-out** — the cap hitting the plate. This is the *clack*
 *      everybody actually means by "mechanical keyboard": a short low thump with
 *      a woody body, and it is why a board sounds expensive rather than clicky.
 *   3. **The plate ring** — the mounting plate and case resonating, a pitched
 *      partial that persists for a few tens of milliseconds. This is the single
 *      most under-modelled part, and the thing that separates "keyboard" from
 *      "mouse click": a click has no body, a key has a *case*.
 *   4. **The release** — the switch returning, higher and quieter than the press,
 *      arriving at a gap that depends on how long the key was held.
 *
 * THE GAP IS THE POINT. `atJitter` on the release voice is what makes this sound
 * played rather than sequenced. Without it every keystroke is the same press
 * followed by the same click at the same interval, which the ear identifies as a
 * sample within about four keys.
 *
 * VARIETY. `variants` gives two alternate stacks — a slightly heavier cap and a
 * slightly lighter one — so consecutive keystrokes are not merely detuned copies
 * of each other. Combined with `jitter` (pitch) and `gainJitter` (velocity) that
 * is three independent axes of variation, which is roughly what a real board
 * gives you across the home row.
 *
 * MIXING. The whole design peaks around 0.07, comfortably under the hit (0.24)
 * and the level-up arpeggio. A keyboard must be audible enough to be tactile and
 * quiet enough to type through for an hour.
 */

import type { SoundDesign } from './Voice';

/**
 * The default feel. `tactile` — the sound of a good board, not a chiclet.
 */
export const KEY: SoundDesign = {
  trim: 0.92,
  /* Key repeat must not stack. At 18ms, holding a key gives a roll, not a buzz. */
  throttleMs: 18,
  /* Pitch drift per keystroke: a few cents, like a slightly different cap. */
  jitter: 30,
  /* Velocity: no two presses are the same force. */
  gainJitter: 0.18,
  voices: [
    /* ---- 1. the press ------------------------------------------- */
    /*
     * A very short high transient. Not a click in isolation — it is the leading
     * edge that tells the ear *when* the key went down.
     */
    {
      at: 0,
      freq: 0,
      dur: 0.012,
      gain: 0.026,
      noise: 1,
      noiseFilter: { type: 'bandpass', freq: 3400, Q: 1.1 },
      attack: 0.0008,
      falloff: 2.8,
      pan: 0,
    },
    /*
     * The switch's own resonance, just under the transient. A tiny pitched
     * component stops the press being pure noise, which is what makes it read as
     * a mechanism rather than a hiss.
     */
    {
      at: 0,
      freq: 1620,
      to: 1180,
      dur: 0.02,
      wave: 'pulse12',
      gain: 0.016,
      attack: 0.0008,
      falloff: 3,
    },

    /* ---- 2. the bottom-out -------------------------------------- */
    /*
     * The clack. Deliberately low — 150 Hz falling to 95 — because a cap hitting
     * a plate is a mass event, not a click. Without this the keyboard sounds
     * like a mouse.
     */
    {
      at: 0.004,
      freq: 152,
      to: 94,
      dur: 0.055,
      wave: 'tri',
      gain: 0.05,
      attack: 0.0012,
      falloff: 2.2,
    },
    /* The woody body of the cap itself. Very short, very quiet. */
    {
      at: 0.004,
      freq: 0,
      dur: 0.018,
      gain: 0.014,
      noise: 1,
      noiseFilter: { type: 'bandpass', freq: 900, Q: 2.4 },
      attack: 0.001,
    },

    /* ---- 3. the plate ring -------------------------------------- */
    /*
     * THE LAYER THAT SELLS IT. A pitched partial at the plate's resonant
     * frequency, decaying over ~65 ms. Quiet, and the difference between a
     * keyboard and a series of clicks.
     *
     * BONE DRY, and that is a deliberate reversal. A `send` here was wrong: the
     * board is under your hands, not across a room, and a wet keyclick reads as
     * someone else typing in another building. The body comes from the frequency
     * and the decay — not from reverb. The catalogue's "keys stay dry" rule is
     * not decoration; it is the whole reason a keypress feels tactile.
     */
    {
      at: 0.006,
      freq: 620,
      dur: 0.065,
      wave: 'tri',
      gain: 0.011,
      attack: 0.003,
      falloff: 1.8,
    },

    /* ---- 4. the release ----------------------------------------- */
    /*
     * Higher and quieter than the press, and *jittered in time*: `atJitter` is
     * how long the key was held. This is the single most important property in
     * the whole design.
     */
    {
      at: 0.055,
      atJitter: 0.022,
      freq: 0,
      dur: 0.014,
      gain: 0.013,
      noise: 1,
      noiseFilter: { type: 'bandpass', freq: 4200, Q: 1.6 },
      attack: 0.0008,
      falloff: 3,
    },
    {
      at: 0.055,
      atJitter: 0.022,
      freq: 1080,
      to: 1420,
      dur: 0.018,
      wave: 'pulse25',
      gain: 0.008,
      attack: 0.0008,
      falloff: 2.6,
    },
  ],

  /*
   * Two alternates.
   *
   * A heavier cap: lower plate ring, louder bottom-out, slightly slower. And a
   * lighter one: brighter transient, thinner body. Cycling between three physical
   * characters is what stops the keyboard becoming a metronome over a long
   * session — pitch jitter alone cannot do this, because it changes the *note*
   * without changing the *object*.
   */
  variants: [
    /* Heavier cap. */
    [
      {
        at: 0,
        freq: 0,
        dur: 0.012,
        gain: 0.023,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 2900, Q: 1.1 },
        attack: 0.0008,
        falloff: 2.8,
      },
      {
        at: 0,
        freq: 1480,
        to: 1100,
        dur: 0.022,
        wave: 'pulse12',
        gain: 0.014,
        attack: 0.0008,
        falloff: 3,
      },
      {
        at: 0.005,
        freq: 132,
        to: 82,
        dur: 0.065,
        wave: 'tri',
        gain: 0.058,
        attack: 0.0014,
        falloff: 2,
      },
      {
        at: 0.005,
        freq: 0,
        dur: 0.02,
        gain: 0.016,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 780, Q: 2.6 },
        attack: 0.001,
      },
      {
        at: 0.007,
        freq: 540,
        dur: 0.075,
        wave: 'tri',
        gain: 0.012,
        attack: 0.004,
        falloff: 1.7,
      },
      {
        at: 0.06,
        atJitter: 0.024,
        freq: 0,
        dur: 0.014,
        gain: 0.011,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 3800, Q: 1.6 },
        attack: 0.0008,
        falloff: 3,
      },
    ],

    /* Lighter cap. */
    [
      {
        at: 0,
        freq: 0,
        dur: 0.011,
        gain: 0.03,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 3900, Q: 1.3 },
        attack: 0.0006,
        falloff: 3,
      },
      {
        at: 0,
        freq: 1780,
        to: 1280,
        dur: 0.018,
        wave: 'pulse12',
        gain: 0.017,
        attack: 0.0006,
        falloff: 3.2,
      },
      {
        at: 0.003,
        freq: 176,
        to: 110,
        dur: 0.045,
        wave: 'tri',
        gain: 0.042,
        attack: 0.001,
        falloff: 2.4,
      },
      {
        at: 0.006,
        freq: 720,
        dur: 0.055,
        wave: 'tri',
        gain: 0.01,
        attack: 0.003,
        falloff: 1.9,
      },
      {
        at: 0.05,
        atJitter: 0.02,
        freq: 0,
        dur: 0.012,
        gain: 0.014,
        noise: 1,
        noiseFilter: { type: 'bandpass', freq: 4600, Q: 1.8 },
        attack: 0.0006,
        falloff: 3.2,
      },
      {
        at: 0.05,
        atJitter: 0.02,
        freq: 1180,
        to: 1560,
        dur: 0.016,
        wave: 'pulse25',
        gain: 0.009,
        attack: 0.0006,
        falloff: 2.8,
      },
    ],
  ],
};
