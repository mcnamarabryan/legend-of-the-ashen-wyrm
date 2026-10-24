/**
 * READING THE ROOM.
 *
 * The client holds no game state — that is the whole point of the architecture.
 * So it cannot ask "did I level up?" It can only read the sentences the server
 * sent and decide which ones sound like what.
 *
 * That sounds fragile and is, in fact, exactly right: the server already commits
 * to a tone when it writes a line (`red` for damage, `gold` for loot), and that
 * tone IS the semantic signal. Prose matching is the fallback for the cases the
 * tone cannot express, like "this was a critical" versus "this was a normal hit".
 *
 * ORDER MATTERS. The rules are evaluated most-specific first. A critical hit
 * carries the word "damage", so if the generic damage rule came first every crit
 * would be scored as an ordinary hit.
 *
 * SILENCE IS THE DEFAULT. Most lines earn no sound at all. A terminal that beeps
 * at every sentence is an unpleasant terminal, and the moments that *do* make
 * noise are only meaningful because the ones around them do not.
 *
 * COMBAT IS LOADOUT-AWARE. The scored sound for a blow depends on the weapon in
 * the player's hand and the armour they are wearing — a dagger and a war hammer
 * should not make the same noise. `soundsForBatch` takes an optional profile and
 * swaps the generic `hit`/`crit`/`hurt` for the matching variant.
 */

import type { ClientLine } from '../state/client';
import type { SoundName } from './SoundEngine';

/**
 * Which families the player's kit belongs to.
 *
 * Derived from the item ids the server already sends in the header — no new
 * field on the wire, no duplication of item tables. The ids are stable public
 * identifiers (`runed-blade`, `plate-mail`), so mapping them here keeps the
 * client free of game data while still letting it choose a sword from a hammer.
 */
export type WeaponFamily = 'blade' | 'axe' | 'blunt' | 'finesse' | 'magic';
export type ArmorFamily = 'cloth' | 'leather' | 'chain' | 'plate';

export interface CombatProfile {
  weapon: WeaponFamily;
  armor: ArmorFamily;
}

const WEAPON_BY_ID: Record<string, WeaponFamily> = {
  'rusty-dagger': 'finesse',
  'weak-wand': 'magic',
  'short-sword': 'blade',
  'long-sword': 'blade',
  'two-handed-sword': 'blade',
  'runed-blade': 'magic',
  'hand-axe': 'axe',
  'war-hammer': 'blunt',
  'cursed-blade': 'finesse',
};

const ARMOR_BY_ID: Record<string, ArmorFamily> = {
  rags: 'cloth',
  'cloth-robes': 'cloth',
  leather: 'leather',
  'chain-mail': 'chain',
  'scale-mail': 'chain',
  'plate-mail': 'plate',
  'dragon-scale': 'plate',
};

/** A sensible default before the character exists. */
export const DEFAULT_PROFILE: CombatProfile = { weapon: 'blade', armor: 'cloth' };

/**
 * What the player is holding, from the ids the header already carries.
 *
 * Unknown ids fall back rather than throwing: a renamed item should degrade to a
 * generic sword sound, not silence the whole fight.
 */
export function profileFromLoadout(
  weaponId: string | null | undefined,
  armorId: string | null | undefined,
): CombatProfile {
  return {
    weapon: (weaponId && WEAPON_BY_ID[weaponId]) || 'blade',
    armor: (armorId && ARMOR_BY_ID[armorId]) || 'cloth',
  };
}

interface Rule {
  sound: SoundName;
  test: (line: ClientLine, text: string) => boolean;
}

const has = (text: string, ...needles: string[]) => {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
};

const RULES: Rule[] = [
  /* ---- the loud, rare ones ------------------------------------- */
  {
    sound: 'level',
    test: (_l, t) => has(t, 'reached level', 'feel whole again'),
  },
  {
    sound: 'death',
    test: (_l, t) =>
      has(t, 'straw pallet', 'heartbeat', 'ground comes up', 'the healer is standing over you'),
  },
  {
    sound: 'wyrm',
    test: (_l, t) => has(t, 'ashen wyrm', 'strikes twice'),
  },
  {
    sound: 'heal',
    test: (_l, t) => has(t, 'you are restored', 'wounds close', 'warmth moves through'),
  },
  {
    sound: 'spell',
    test: (_l, t) => has(t, 'you cast'),
  },

  /* ---- coins ---------------------------------------------------- */
  {
    sound: 'loot',
    test: (_l, t) => has(t, 'gold', 'gem', 'experience'),
  },

  /* ---- combat --------------------------------------------------- */
  {
    sound: 'crit',
    test: (_l, t) => has(t, 'critical blow'),
  },
  {
    sound: 'dodge',
    test: (_l, t) => has(t, 'slip aside', 'thieves learn this first'),
  },
  {
    sound: 'miss',
    test: (_l, t) =>
      has(
        t,
        'swing wide',
        'goes where',
        'footing slips',
        'turns your blow aside',
        'glances off',
        'overreaches',
        'lunges and misses',
      ),
  },
  {
    sound: 'hurt',
    /* A red line is, by convention, something happening to the player. */
    test: (l, t) => l.tone === 'red' || has(t, 'claws rake', 'too slow'),
  },
  {
    sound: 'hit',
    test: (_l, t) =>
      has(
        t,
        'your blade finds',
        'steel meets',
        'open a line',
        'put your weight',
        'you hit',
        'damage',
      ),
  },

  /* ---- acknowledgement ------------------------------------------ */
  {
    sound: 'deny',
    test: (_l, t) =>
      has(
        t,
        'cannot afford',
        'no turns left',
        'out of turns',
        'already known on this node',
        'not yours to play',
        'not ready',
        'already been to the mountain',
        'would be walking out of here',
      ),
  },
];

/**
 * Which sound, if any, this line should make.
 *
 * Returns null for prose. Silence is the default and most lines earn it.
 */
export function soundForLine(line: ClientLine): SoundName | null {
  const text = line.text;
  if (!text) return null;

  for (const rule of RULES) {
    if (rule.test(line, text)) return rule.sound;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Loadout-aware variants                                             */
/* ------------------------------------------------------------------ */

/**
 * The specific sound for a blow, given the player's kit.
 *
 * Every variant is a full design in the catalogue, not a filter applied at
 * runtime: a hammer is a low wooden crush and a dagger is a fast bright hiss,
 * and those are different *shapes*, not one shape transposed.
 */
function variantFor(base: SoundName, profile: CombatProfile): SoundName {
  const { weapon, armor } = profile;

  if (base === 'hurt') {
    /* Armour changes the sound of being hit far more than the weapon does. */
    switch (armor) {
      case 'plate':
        return 'hurt-plate';
      case 'chain':
        return 'hurt-chain';
      case 'leather':
        return 'hurt-leather';
      default:
        return 'hurt-cloth';
    }
  }

  if (base === 'hit' || base === 'crit') {
    switch (weapon) {
      case 'axe':
        return base === 'crit' ? 'crit-axe' : 'hit-axe';
      case 'blunt':
        return base === 'crit' ? 'crit-blunt' : 'hit-blunt';
      case 'finesse':
        return base === 'crit' ? 'crit-finesse' : 'hit-finesse';
      case 'magic':
        return base === 'crit' ? 'crit-magic' : 'hit-magic';
      default:
        return base === 'crit' ? 'crit-blade' : 'hit-blade';
    }
  }

  return base;
}

/**
 * Severity ranking, so a batch yields one impact rather than a drum solo.
 *
 * A single fight produces a dozen damage lines. Playing a thud for every one
 * turns a two-second exchange into a machine-gun. The ear needs one impact per
 * exchange — the loudest one — and the narrative carries the rest.
 *
 * Ranked by the *base* sound, so a plate-armoured `hurt` outranks a blade hit
 * exactly as `hurt` did before the variants existed.
 */
const SEVERITY: Partial<Record<SoundName, number>> = {
  miss: 0,
  dodge: 1,
  hit: 2,
  hurt: 3,
  crit: 4,
};

/** Map a variant back to the base it came from, for severity lookup. */
export function baseOf(sound: SoundName): SoundName {
  if (sound.startsWith('hit-')) return 'hit';
  if (sound.startsWith('crit-')) return 'crit';
  if (sound.startsWith('hurt-')) return 'hurt';
  return sound;
}

export function soundsForBatch(lines: ClientLine[], profile?: CombatProfile): SoundName[] {
  const kit = profile ?? DEFAULT_PROFILE;
  const rare: SoundName[] = [];
  let combat: SoundName | null = null;
  let bestRank = -1;

  for (const line of lines) {
    const scored = soundForLine(line);
    if (!scored) continue;

    const rank = SEVERITY[baseOf(scored)];

    if (rank !== undefined) {
      /* One impact per exchange, and the loudest one wins. */
      if (rank > bestRank) {
        bestRank = rank;
        combat = variantFor(scored, kit);
      }
      continue;
    }

    const base = variantFor(scored, kit);
    if (!rare.includes(base)) rare.push(base);
  }

  /*
   * Rare events first, then the single strongest impact.
   *
   * A level-up should not be buried under the sword hit that earned it. Playing
   * the award before the blow that caused it also matches the reading order of
   * the log, which is what the listener is following.
   */
  return combat ? [...rare, combat] : rare;
}

/**
 * A keypress sound varies by what the key means.
 *
 * `select` for committing, `back` for leaving, `deny` never — a keypress cannot
 * know it was refused, so refusals are scored from the response text instead.
 * The distinction is small but it is the difference between a keyboard and a
 * click track.
 */
export function soundForKey(key: string): SoundName {
  const k = key.toLowerCase();
  if (k === 'escape' || k === 'b') return 'back';
  if (k === 'enter') return 'select';
  return 'key';
}
