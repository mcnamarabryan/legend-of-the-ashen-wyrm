import type { Character, CombatLine } from './types';
import { gameRules, levelForXp, xpForLevel, toRoman } from './rules';
import * as msg from '../content/strings';

/**
 * Level progression. Pure: takes a character, returns a character.
 * XP is never lost here — only applyDeath subtracts XP.
 */

export function maxHpForLevel(level: number): number {
  return gameRules.hp.base + gameRules.hp.perLevel * (level - 1);
}

export function maxManaForLevel(level: number): number {
  return gameRules.mana.base + gameRules.mana.perLevel * (level - 1);
}

export interface LevelUpResult {
  character: Character;
  leveled: boolean;
  lines: CombatLine[];
  levelsGained: number;
}

/**
 * Award XP and resolve any level-ups. Stats are auto-allocated by class,
 * HP is recomputed and topped up to full, and mana recovers 25%.
 */
export function awardXp(character: Character, xp: number): LevelUpResult {
  const c: Character = { ...character, xp: Math.max(0, character.xp) + Math.max(0, xp) };
  const lines: CombatLine[] = [];

  let targetLevel = levelForXp(c.xp);
  if (targetLevel > gameRules.maxLevel) targetLevel = gameRules.maxLevel;

  let levelsGained = 0;

  while (c.level < targetLevel) {
    const next = c.level + 1;
    const gains = gameRules.levelUpGains[c.class] ?? { str: 0, def: 0, agi: 0, chm: 0 };

    c.level = next;
    c.str += gains.str;
    c.def += gains.def;
    c.agi += gains.agi;
    c.chm += gains.chm;
    c.maxHp = maxHpForLevel(next);
    c.hp = c.maxHp;
    c.mana = Math.min(
      maxManaForLevel(next),
      c.mana + Math.round(maxManaForLevel(next) * gameRules.mana.levelUpRestorePct),
    );

    levelsGained += 1;

    lines.push(
      {
        text: msg.levelUp.announce(toRoman(next), msg.titleForLevel(next, c.isWyrmbane)),
        tone: 'bright',
      },
      { text: msg.levelUp.fullHeal },
    );

    if (next >= gameRules.maxLevel) {
      lines.push({ text: msg.levelUp.maxLevel, tone: 'gold' });
    }
  }

  return { character: c, leveled: levelsGained > 0, lines, levelsGained };
}

/** XP still needed to reach the next level. 0 at max level. */
export function xpToNext(character: Character): number {
  if (character.level >= gameRules.maxLevel) return 0;
  return Math.max(0, xpForLevel(character.level + 1) - character.xp);
}

/** Progress through the current level, 0–1. Used for the header bar. */
export function levelProgress(character: Character): number {
  if (character.level >= gameRules.maxLevel) return 1;
  const floorXp = xpForLevel(character.level);
  const ceilXp = xpForLevel(character.level + 1);
  const span = ceilXp - floorXp;
  if (span <= 0) return 1;
  return Math.max(0, Math.min(1, (character.xp - floorXp) / span));
}
