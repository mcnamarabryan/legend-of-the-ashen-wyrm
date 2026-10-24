/**
 * THE SOUND OF A PLACE.
 *
 * Every scene the game can be in, described as data: which bed layers sit under
 * it, which one-shot events belong to it, how often they fire, and how wet it is.
 *
 * WHY SCENES AT ALL. The previous version had one ambience — wind, drips, and
 * birdsong — mixed for a forest. That is right for the forest and wrong
 * everywhere else: a bank and a cave and a machine room cannot share a palette
 * without at least two of them sounding false. A single global bed is the audio
 * equivalent of using one background colour for every screen.
 *
 * So ambience is scoped. The player is always in exactly one scene, and moving
 * between locations crossfades rather than cuts, because a hard switch is the
 * one thing that would break the illusion of a continuous world.
 *
 * THE PALETTES ARE NOT DECORATION. Each one encodes what the room *is*:
 *
 *   machine   before the modem, the player is standing at a terminal that is
 *             doing something. Ticks, whirrs, a drive spinning up, a fan. It is
 *             deliberately cold and synthetic — the contrast with the organic
 *             wind after connection is the point, and it is what makes "you are
 *             now inside the world" legible without a single word of text.
 *   forest    wind, leaf rustle, wood, distant wildlife.
 *   town      muffled voices, a door, a cart, a dog. Indoors-ish but open.
 *   cave      dripping water, a deep draught, rock settling. No wildlife.
 *   lair      the wyrm's room: sub-bass pressure, ash, something enormous
 *             breathing. Almost no events — a space that quiet is a threat.
 */

import type { AmbienceEvent } from './ambience';

/**
 * A scene id. The shell picks one; the engine crossfades to it.
 *
 * `machine` is the odd one out and deliberately so: it is the only scene that is
 * diegetic-but-outside — you are in a maintenance room, not the world.
 */
export type AmbienceScene = 'machine' | 'forest' | 'town' | 'cave' | 'lair';

/** One layer of the continuous bed. */
export interface BedLayer {
  /**
   * What generates it.
   *
   *  - `noise`  filtered noise — wind, air, machinery hiss.
   *  - `tone`   a fixed pitch — sub-bass pressure, a fan's harmonic.
   *  - `hum`    a slightly detuned pair, so it beats and never sits still.
   */
  kind: 'noise' | 'tone' | 'hum';
  /** Filter type, for noise layers only. */
  filter?: BiquadFilterType;
  /** Centre (bandpass/notch) or cutoff (lowpass/highpass) frequency, in Hz. */
  freq: number;
  /** Resonance. Lower is a gentler slope. */
  Q?: number;
  /** Linear gain for the layer. These sum, so keep the total modest. */
  gain: number;
  /** Base pitch, for `tone` and `hum`. */
  hz?: number;
  /** Detune in Hz between the pair of a `hum`. Small = slow beating. */
  spread?: number;

  /* ---- movement ------------------------------------------------- */

  /**
   * Slow modulation of the filter (noise) or level (tone).
   *
   * Two rates that do not divide are used per layer by default: a single LFO
   * produces an audible cycle, and a cycle is what makes ambience sound like a
   * sample rather than a place.
   */
  drift?: { rate: number; depth: number; target?: 'freq' | 'gain' }[];
}

/** A whole scene. */
export interface SceneSpec {
  /** Human label, for the settings panel and diagnostics. */
  label: string;
  /** The continuous layers, softest first. */
  bed: BedLayer[];
  /** Event palette. Empty means the scene is nearly silent on purpose. */
  events: Array<{ event: AmbienceEvent; weight: number }>;
  /** Seconds between events. Wide and irregular by design. */
  gap: { min: number; max: number };
  /** Chance a given gap produces nothing at all. */
  skipChance: number;
  /** Chance an event is the rare unsettling one, where the scene has one. */
  rareChance?: number;
  /** Which event is the rare one. */
  rare?: AmbienceEvent;
  /**
   * Reverb send for this scene, 0–1.
   *
   * A cave is wet; a machine room is dead. This is most of what makes two spaces
   * with similar palettes feel different.
   */
  wet: number;
}

/**
 * MACHINE — the maintenance room, before the modem.
 *
 * The palette is deliberately tight and periodic: ticks, a fan, a drive, a relay.
 * Periodicity here is correct where it would be wrong outdoors, because machinery
 * *is* periodic — the ear reads repetition as mechanical rather than as a loop.
 *
 * Levels are set well below the forest bed. This is a room you are sitting in,
 * not weather you are standing in.
 */
const MACHINE: SceneSpec = {
  label: 'Maintenance',
  wet: 0.05,
  gap: { min: 1.6, max: 7.5 },
  skipChance: 0.12,
  rareChance: 0.05,
  rare: 'relay',
  bed: [
    /* Room tone: a low, dead hiss. Almost inaudible, but its absence is felt. */
    { kind: 'noise', filter: 'lowpass', freq: 320, Q: 0.6, gain: 0.05 },
    /* Fan. A tone with a slow wobble, not a hum — it is spinning, not idling. */
    {
      kind: 'tone',
      hz: 58,
      freq: 58,
      gain: 0.035,
      drift: [{ rate: 0.043, depth: 0.012, target: 'gain' }],
    },
    /* Electrical hum. Two pitches a fraction apart, so it beats unevenly. */
    { kind: 'hum', hz: 120, spread: 0.35, freq: 120, gain: 0.014 },
    /* Ventilation: band-limited noise with a slow sweep. */
    {
      kind: 'noise',
      filter: 'bandpass',
      freq: 700,
      Q: 1.1,
      gain: 0.028,
      drift: [
        { rate: 0.031, depth: 210 },
        { rate: 0.009, depth: 130 },
      ],
    },
  ],
  events: [
    { event: 'tick', weight: 42 },
    { event: 'whirr', weight: 20 },
    { event: 'click', weight: 18 },
    { event: 'drive', weight: 9 },
    { event: 'vent', weight: 8 },
  ],
};

/**
 * FOREST — the north road.
 *
 * Organic and irregular. Nothing here repeats, which is what separates it from
 * the machine room directly above it in the game's own timeline.
 */
const FOREST: SceneSpec = {
  label: 'Forest',
  wet: 0.22,
  gap: { min: 9, max: 34 },
  skipChance: 0.22,
  rareChance: 0.07,
  rare: 'whisper',
  bed: [
    /* Sub: the mass of the treeline. Felt, not heard. */
    { kind: 'hum', hz: 48, spread: 0.4, freq: 48, gain: 0.028 },
    /* Wind through the canopy. */
    {
      kind: 'noise',
      filter: 'bandpass',
      freq: 420,
      Q: 0.7,
      gain: 0.16,
      drift: [
        { rate: 0.037, depth: 260 },
        { rate: 0.011, depth: 150 },
      ],
    },
    /* Air: the sky above the trees. */
    { kind: 'noise', filter: 'highpass', freq: 5200, Q: 0.5, gain: 0.022 },
  ],
  events: [
    { event: 'gust', weight: 30 },
    { event: 'rustle', weight: 24 },
    { event: 'birdsong', weight: 18 },
    { event: 'creak', weight: 12 },
    { event: 'drip', weight: 10 },
    { event: 'groan', weight: 6 },
  ],
};

/**
 * TOWN — Redgate.
 *
 * The hardest of these to fake, because a town is defined by *people* and we
 * have no voices. The solution is to imply them: muffled low band-limited noise
 * that reads as conversation through a wall, plus doors and carts. Never a
 * distinct word, never a distinct speaker.
 */
const TOWN: SceneSpec = {
  label: 'Town',
  wet: 0.12,
  gap: { min: 5, max: 19 },
  skipChance: 0.2,
  rareChance: 0.04,
  rare: 'whisper',
  bed: [
    /* Low murmur: distant voices, never intelligible. */
    {
      kind: 'noise',
      filter: 'bandpass',
      freq: 340,
      Q: 0.9,
      gain: 0.05,
      drift: [
        { rate: 0.026, depth: 120 },
        { rate: 0.007, depth: 70 },
      ],
    },
    /* Street air. Warmer and lower than the forest's, because of walls. */
    { kind: 'noise', filter: 'lowpass', freq: 900, Q: 0.7, gain: 0.03 },
    /* The stones themselves. */
    { kind: 'tone', hz: 42, freq: 42, gain: 0.02 },
  ],
  events: [
    { event: 'door', weight: 28 },
    { event: 'cart', weight: 22 },
    { event: 'murmur', weight: 24 },
    { event: 'dog', weight: 14 },
    { event: 'creak', weight: 8 },
    { event: 'bell', weight: 4 },
  ],
};

/**
 * CAVE — the mountain's throat.
 *
 * Wet, cold, and nearly empty. The reverb send is the highest of any scene: a
 * cave is mostly *room*, and the drips are only there to reveal the room.
 */
const CAVE: SceneSpec = {
  label: 'Cavern',
  wet: 0.4,
  gap: { min: 6, max: 22 },
  skipChance: 0.24,
  rareChance: 0.05,
  rare: 'whisper',
  bed: [
    /* Pressure. Deeper than anything else in the game. */
    { kind: 'hum', hz: 38, spread: 0.25, freq: 38, gain: 0.034 },
    /* A draught moving through a long passage. */
    {
      kind: 'noise',
      filter: 'bandpass',
      freq: 220,
      Q: 1.6,
      gain: 0.06,
      drift: [
        { rate: 0.019, depth: 130 },
        { rate: 0.006, depth: 80 },
      ],
    },
    /* Water somewhere you cannot see. */
    { kind: 'noise', filter: 'highpass', freq: 3800, Q: 0.6, gain: 0.008 },
  ],
  events: [
    { event: 'drip', weight: 46 },
    { event: 'rockfall', weight: 12 },
    { event: 'groan', weight: 18 },
    { event: 'creak', weight: 12 },
    { event: 'gust', weight: 12 },
  ],
};

/**
 * LAIR — the Ashen Wyrm's cave.
 *
 * Almost no events. That restraint is the whole design: a room that quiet is a
 * threat, and filling it with noises would make it an attraction instead. What
 * remains is enormous and slow — pressure, a draught of warm air, and ash.
 */
const LAIR: SceneSpec = {
  label: "Wyrm's lair",
  wet: 0.5,
  gap: { min: 14, max: 40 },
  skipChance: 0.35,
  rareChance: 0.1,
  rare: 'breath',
  bed: [
    /* Something breathing, at the very bottom of hearing. */
    {
      kind: 'hum',
      hz: 34,
      spread: 0.18,
      freq: 34,
      gain: 0.045,
      drift: [{ rate: 0.026, depth: 0.014, target: 'gain' }],
    },
    /* Ash and hot air. */
    {
      kind: 'noise',
      filter: 'lowpass',
      freq: 260,
      Q: 0.8,
      gain: 0.045,
      drift: [
        { rate: 0.014, depth: 90 },
        { rate: 0.005, depth: 60 },
      ],
    },
    /* A distant roar of flame, far below the audible floor. */
    { kind: 'tone', hz: 62, freq: 62, gain: 0.016 },
  ],
  events: [
    { event: 'groan', weight: 40 },
    { event: 'rockfall', weight: 20 },
    { event: 'gust', weight: 20 },
  ],
};

export const SCENES: Record<AmbienceScene, SceneSpec> = {
  machine: MACHINE,
  forest: FOREST,
  town: TOWN,
  cave: CAVE,
  lair: LAIR,
};

/** Every scene id, for iteration and tests. */
export const SCENE_IDS = Object.keys(SCENES) as AmbienceScene[];

/**
 * How loud the room tone sits, as a fraction of the master bus.
 *
 * Lives here rather than in `SoundEngine` so it can be asserted against the
 * sound catalogue without constructing an AudioContext — the number is a mixing
 * decision, and the reason the keyboard was once inaudible, so it deserves to be
 * testable.
 *
 * THE HISTORY MATTERS, because this number has been wrong twice.
 *
 * It was 0.85, which put ~0.18 of wind on the bus against a keyclick peaking at
 * 0.083: the room was more than twice as loud as the thing the player was doing.
 * Dropping it to 0.05 fixed that and broke the opposite way — `ambience.ts` was
 * *also* ramping its own scene envelope to this value, so the level applied
 * twice and the beds arrived at 0.05 × 0.05 × 0.21 ≈ 0.0005. Audible to nobody.
 *
 * With the double-attenuation gone, one honest multiplier does the whole job.
 * 0.2 puts the loudest bed (the forest, ~0.21 summed) at ~0.042 against a
 * keypress peak of 0.046: plainly audible in a quiet room, never competing with
 * the thing the player is doing. The mix test enforces both halves of that.
 */
export const AMBIENCE_LEVEL = 0.2;

/** The summed gain of a scene's continuous bed, before AMBIENCE_LEVEL. */
export function bedSum(scene: AmbienceScene): number {
  return SCENES[scene].bed.reduce((sum, layer) => sum + layer.gain, 0);
}

/**
 * The loudest bed of any scene.
 *
 * Used by the mix test: the *worst case* room must still sit under a keypress,
 * not merely the average one.
 */
export function loudestBedSum(): number {
  return Math.max(...SCENE_IDS.map(bedSum));
}

/**
 * Which scene a game location maps to.
 *
 * Locations in the game are cheap and numerous; scenes are expensive and few.
 * Mapping many-to-one here means adding a shop screen later costs nothing — it
 * just inherits the town palette, which is what it should sound like.
 */
export function sceneForLocation(location: string): AmbienceScene {
  switch (location) {
    case 'forest':
    case 'encounter':
      return 'forest';
    case 'dragon':
      return 'lair';
    case 'shop':
    case 'bank':
    case 'healer':
    case 'inn':
    case 'hub':
    case 'character':
    case 'who':
    case 'hall':
    case 'pvp':
    case 'create':
    case 'title':
      return 'town';
    default:
      /* Anything unrecognised is indoors by default — the quieter failure. */
      return 'town';
  }
}
