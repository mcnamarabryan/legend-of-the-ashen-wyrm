import type { Character, CombatLine, Rng } from './types';
import { dayKey, daysBetween, gameRules, toRoman } from './rules';
import { resolveFight } from './combat';
import { awardXp } from './progression';
import { applyDeath } from './economy';
import { wyrm as wyrmMonster } from '../content/monsters';
import { dragon as msg, death as deathMsg, realm } from '../content/strings';

/**
 * The Ashen Wyrm — the endgame.
 *
 * One attempt per day. Unlocks at level 12. Winning marks the character
 * Wyrmbane; the player then chooses to retire or to let the mountain
 * grudge for seven days.
 */

export interface WyrmAvailability {
  available: boolean;
  reason: 'ok' | 'locked' | 'already-tried' | 'respawn';
  lines: CombatLine[];
  scalar: number;
}

export function wyrmAvailability(c: Character, now: number = Date.now()): WyrmAvailability {
  if (c.level < gameRules.wyrm.requiredLevel) {
    return {
      available: false,
      reason: 'locked',
      lines: [{ text: msg.locked, tone: 'dim' }],
      scalar: 1,
    };
  }

  const today = dayKey(now);

  if (c.wyrmAttemptDay === today) {
    return {
      available: false,
      reason: 'already-tried',
      lines: [{ text: msg.attemptUsed, tone: 'dim' }],
      scalar: 1,
    };
  }

  if (c.wyrmRespawnAt > 0 && now < c.wyrmRespawnAt) {
    const days = Math.max(1, Math.ceil((c.wyrmRespawnAt - now) / 86_400_000));
    return {
      available: false,
      reason: 'respawn',
      lines: [{ text: msg.respawn(days), tone: 'dim' }],
      scalar: wyrmScalar(c),
    };
  }

  return { available: true, reason: 'ok', lines: [], scalar: wyrmScalar(c) };
}

/** Each kill the character has survived makes the returning wyrm worse. */
function wyrmScalar(c: Character): number {
  if (!c.titles.includes('Wyrmbane')) return 1;
  return gameRules.wyrm.respawnScalar;
}

export interface WyrmResult {
  character: Character;
  lines: CombatLine[];
  won: boolean;
  feed?: string;
}

export function attemptWyrm(rng: Rng, c: Character, now: number = Date.now()): WyrmResult {
  const availability = wyrmAvailability(c, now);
  if (!availability.available) {
    return { character: c, lines: availability.lines, won: false };
  }

  const spent: Character = {
    ...c,
    turnsRemaining: Math.max(0, c.turnsRemaining - 1),
    wyrmAttemptDay: dayKey(now),
  };

  const fight = resolveFight({
    rng,
    character: spent,
    monster: wyrmMonster,
    scalar: availability.scalar,
    isWyrm: true,
  });

  const intro: CombatLine[] = msg.intro.map((text) => ({ text }));

  if (fight.won) {
    const victor: Character = {
      ...spent,
      hp: Math.max(1, fight.playerHp),
      mana: fight.manaLeft,
      isWyrmbane: true,
      titles: spent.titles.includes('Wyrmbane') ? spent.titles : [...spent.titles, 'Wyrmbane'],
    };
    const lines: CombatLine[] = [
      ...intro,
      ...fight.lines,
      ...msg.victory.map((text) => ({ text })),
      { text: msg.offerRetire, tone: 'dim' },
      { text: msg.offerContinue, tone: 'dim' },
    ];
    return { character: victor, lines, won: true, feed: realm.wyrmSlain(c.name) };
  }

  const death = applyDeath({ ...spent, hp: Math.max(0, fight.playerHp) }, rng);
  const lines: CombatLine[] = [
    ...intro,
    ...fight.lines,
    { text: msg.defeat, tone: 'red' },
    { text: deathMsg.wyrmLaugh, tone: 'red' },
    ...death.lines,
  ];

  return { character: death.character, lines, won: false };
}

/** Retire: freeze the character, keep the entry forever. */
export function retire(c: Character): Character {
  return { ...c, retired: true, turnsRemaining: 0 };
}

/** Continue: keep the title, the wyrm returns in seven days, 25% worse. */
export function continueAfterWyrm(c: Character, now: number = Date.now()): Character {
  const respawn = now + gameRules.wyrm.respawnDays * 86_400_000;
  return { ...c, wyrmRespawnAt: respawn };
}

export interface HallRow {
  date: string;
  name: string;
  class: string;
  days: number;
  resident: boolean;
}

export function daysTaken(c: Character, now: number = Date.now()): number {
  const start = c.createdAt.slice(0, 10);
  const today = dayKey(now);
  return Math.max(1, daysBetween(start, today) + 1);
}

export function hallRowFor(c: Character, now: number = Date.now(), resident = false): HallRow {
  return {
    date: dayKey(now),
    name: c.name,
    class: c.class,
    days: daysTaken(c, now),
    resident,
  };
}

/** Applies the level-up pipeline to encounter XP without spamming the log. */
export function absorbXp(c: Character, xp: number): Character {
  const { character } = awardXp(c, xp);
  return character;
}

export function romanLevel(c: Character): string {
  return toRoman(c.level);
}
