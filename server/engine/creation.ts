import type { Character, CharacterClass, Sex } from './types';
import { dayKey, gameRules, levelForXp, xpForLevel } from './rules';
import { maxHpForLevel, maxManaForLevel } from './progression';
import { spells as allSpells } from '../content/spells';

/**
 * Character creation. The player and the six residents are built by the same
 * code, which is the point — residents are ordinary Character records.
 */

export interface CreateInput {
  name: string;
  sex: Sex;
  cls: CharacterClass;
  now?: string;
  /** Residents start a few levels up so the realm is not empty. */
  level?: number;
}

export function validateName(name: string): { ok: boolean; error?: string } {
  const trimmed = name.trim();
  if (trimmed.length < gameRules.nameMinLength || trimmed.length > gameRules.nameMaxLength) {
    return { ok: false, error: 'length' };
  }
  if (!gameRules.namePattern.test(trimmed)) {
    return { ok: false, error: 'chars' };
  }
  return { ok: true };
}

export function buildStartingCharacter(input: CreateInput): Character {
  const level = Math.max(1, Math.min(gameRules.maxLevel, input.level ?? 1));
  const base = gameRules.baseStats[input.cls] ?? gameRules.baseStats.warrior;

  // Residents start above level 1: give them the stat gains they would have earned.
  const levelsAbove = level - 1;
  const gains = gameRules.levelUpGains[input.cls] ?? { str: 0, def: 0, agi: 0, chm: 0 };

  const str = base.str + gains.str * levelsAbove;
  const def = base.def + gains.def * levelsAbove;
  const agi = base.agi + gains.agi * levelsAbove;
  const chm = base.chm + gains.chm * levelsAbove;

  const maxHp = maxHpForLevel(level);
  const xp = xpForLevel(level);

  const known: string[] = [];
  if (input.cls === 'magician') {
    known.push('spark');
    if (level >= 5) known.push('ward');
    if (level >= 8) known.push('drain');
  }

  const char: Character = {
    name: input.name.trim(),
    sex: input.sex,
    class: input.cls,

    level,
    xp,

    hp: maxHp,
    maxHp,
    mana: maxManaForLevel(level),

    str,
    def,
    agi,
    chm,

    gold: gameRules.start.gold,
    banked: 0,
    gems: gameRules.start.gems,

    weaponId: gameRules.start.weaponId,
    armorId: gameRules.start.armorId,

    turnsRemaining: gameRules.turnsPerDay,
    lastTurnResetDay: dayKey(),

    playerKills: 0,
    deaths: 0,

    wrenStage: 0,

    isWyrmbane: false,
    retired: false,
    createdAt: input.now ?? new Date().toISOString(),

    wyrmAttemptDay: null,
    wyrmRespawnAt: 0,

    titles: [],
    spells: known,
  };

  return char;
}

/** Sanity check used by creation UI and by tests. */
export function levelFromXp(xp: number): number {
  return levelForXp(xp);
}

export const classNames: Record<CharacterClass, string> = {
  warrior: 'Warrior',
  magician: 'Magician',
  thief: 'Thief',
};

export const spellNames = allSpells.map((s) => s.name);
