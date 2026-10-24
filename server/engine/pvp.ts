import type { Character, CombatLine, Resident, Rng } from './types';
import { gameRules, toRoman } from './rules';
import { chance } from './rng';
import { resolveAttack, playerCombatant } from './combat';
import { applyDeath } from './economy';
import { className, pvp as msg } from '../content/strings';
import { weaponById, armorById } from '../content/items';

/**
 * PvP. Works between any two Character records — the player and a resident,
 * or the player and another tab's character. Nothing is special-cased.
 */

export interface PvpResult {
  attacker: Character;
  defender: Character;
  lines: CombatLine[];
  feed: string;
  winner: 'attacker' | 'defender';
}

export function canAttack(attacker: Character, defender: Character): boolean {
  return Math.abs(attacker.level - defender.level) <= gameRules.pvp.levelRange;
}

export function eligibleTargets(attacker: Character, all: Character[]): Character[] {
  return all.filter(
    (c) => c.name !== attacker.name && !c.retired && canAttack(attacker, c),
  );
}

/**
 * Fight another character. Costs the attacker a turn; the defender loses
 * nothing but gold. Winner takes 15% of the loser's carried gold.
 */
export function fightPlayer(
  rng: Rng,
  attacker: Character,
  defender: Character,
): PvpResult {
  const a = { ...attacker, turnsRemaining: Math.max(0, attacker.turnsRemaining - 1) };

  let aHp = a.hp;
  let dHp = defender.hp;
  let rounds = 0;
  const lines: CombatLine[] = [
    { text: `{bright}You attack ${defender.name}.{/}`, tone: 'bright' },
  ];

  while (aHp > 0 && dHp > 0 && rounds < 60) {
    rounds += 1;

    const swing = resolveAttack(rng, playerCombatant(a), {
      def: playerCombatant(defender).def,
      agi: defender.agi,
      isThief: defender.class === 'thief',
    });
    if (swing.hit) {
      dHp -= swing.damage;
      lines.push({ text: `You hit ${defender.name} for ${swing.damage}.`, tone: 'normal' });
    } else {
      lines.push({ text: `${defender.name} turns your blow aside.`, tone: 'dim' });
    }
    if (dHp <= 0) break;

    const back = resolveAttack(rng, playerCombatant(defender), {
      def: playerCombatant(a).def,
      agi: a.agi,
      isThief: a.class === 'thief',
    });
    if (back.hit) {
      aHp -= back.damage;
      lines.push({ text: `${defender.name} hits you for ${back.damage}.`, tone: 'red' });
    } else {
      lines.push({ text: `You slip ${defender.name}'s counter.`, tone: 'dim' });
    }
  }

  if (dHp <= 0) {
    const loot = Math.floor(defender.gold * gameRules.pvp.goldStealPct);
    const winnerChar: Character = {
      ...a,
      hp: Math.max(1, aHp),
      gold: a.gold + loot,
      playerKills: a.playerKills + 1,
    };
    const death = applyDeath({ ...defender, gold: defender.gold }, rng);
    const loser: Character = {
      ...death.character,
      gold: Math.max(0, death.character.gold - loot),
    };
    return {
      attacker: winnerChar,
      defender: loser,
      lines: [
        ...lines,
        { text: msg.win(defender.name, loot), tone: 'bright' },
        ...death.lines.map((l) => ({ ...l })),
      ],
      feed: msg.feedWin(a.name, defender.name, loot),
      winner: 'attacker',
    };
  }

  const loot = Math.floor(a.gold * gameRules.pvp.goldStealPct);
  const death = applyDeath({ ...a, gold: a.gold }, rng);
  const loser: Character = {
    ...death.character,
    gold: Math.max(0, death.character.gold - loot),
  };
  const winnerChar: Character = {
    ...defender,
    hp: Math.max(1, dHp),
    gold: defender.gold + loot,
    playerKills: defender.playerKills + 1,
  };

  return {
    attacker: loser,
    defender: winnerChar,
    lines: [...lines, ...death.lines.map((l) => ({ ...l }))],
    feed: msg.feedWin(defender.name, a.name, loot),
    winner: 'defender',
  };
}

/**
 * Thief steal. 60% success, 10% of carried gold, no combat, costs a turn.
 * Always writes to the realm feed — a theft nobody hears about is not a theft.
 */
export function stealFrom(
  rng: Rng,
  thief: Character,
  target: Character,
): { thief: Character; target: Character; lines: CombatLine[]; feed: string; ok: boolean } {
  const spent: Character = { ...thief, turnsRemaining: Math.max(0, thief.turnsRemaining - 1) };

  if (!chance(rng, gameRules.pvp.stealChance)) {
    return {
      thief: spent,
      target,
      lines: [{ text: msg.stealFail(target.name), tone: 'red' }],
      feed: `${target.name} caught ${thief.name} reaching for their purse.`,
      ok: false,
    };
  }

  const loot = Math.max(1, Math.floor(target.gold * gameRules.pvp.stealPct));
  return {
    thief: { ...spent, gold: spent.gold + loot },
    target: { ...target, gold: Math.max(0, target.gold - loot) },
    lines: [{ text: msg.stealOk(loot), tone: 'bright' }],
    feed: msg.feedSteal(thief.name, target.name, loot),
    ok: true,
  };
}

/* ------------------------------------------------------------------ */
/* Residents                                                           */
/* ------------------------------------------------------------------ */

/**
 * Offline progression for the six residents. Runs on load and on rollover.
 * Capped so they never outrun a diligent player by more than a level.
 */
export function progressResidents(
  rng: Rng,
  residents: Resident[],
  playerLevel: number,
  days: number,
): { residents: Resident[]; feed: string[] } {
  const feed: string[] = [];
  const dayCount = Math.max(1, Math.min(days, 14));

  const next = residents.map((resident) => {
    const c = resident.character;
    const cap = Math.min(gameRules.maxLevel, playerLevel + gameRules.realm.residentMaxLevelAhead);
    let level = c.level;
    let xp = c.xp;
    let gold = c.gold;
    let kills = c.playerKills;
    let hp = c.hp;
    let weaponId = c.weaponId;
    let armorId = c.armorId;
    let str = c.str;
    let def = c.def;
    let agi = c.agi;
    let maxHp = c.maxHp;

    for (let d = 0; d < dayCount; d += 1) {
      const turns = Math.round(gameRules.realm.residentTurnsPerDay * resident.aggression);
      for (let t = 0; t < turns; t += 1) {
        if (level >= cap) break;
        const gain = Math.round(30 + level * 14 + rng() * 40);
        xp += gain;
        gold += Math.round(10 + level * 6 + rng() * 20);
        if (rng() < 0.12) kills += 1;
        hp = maxHp;

        const needed = gameRules.xpTable[Math.min(level + 1, gameRules.maxLevel)];
        if (level < cap && xp >= needed) {
          level += 1;
          str += 1;
          def += resident.character.class === 'warrior' ? 1 : 0;
          agi += resident.character.class === 'thief' ? 1 : 0;
          maxHp = 15 + 11 * (level - 1);
          hp = maxHp;
          feed.push(`{dim}${resident.character.name} reached level ${toRoman(level)}.{/}`);
        }
      }
    }

    // Residents re-kit at level tiers, cheaply.
    if (level >= 4 && !weaponById(weaponId).id.includes('sword')) weaponId = 'short-sword';
    if (level >= 7) weaponId = 'long-sword';
    if (level >= 5 && armorById(armorId).power < 6) armorId = 'chain-mail';
    if (level >= 9) armorId = 'plate-mail';

    return {
      ...resident,
      character: {
        ...c,
        level,
        xp,
        gold,
        playerKills: kills,
        hp,
        maxHp,
        weaponId,
        armorId,
        str,
        def,
        agi,
      },
    };
  });

  return { residents: next, feed };
}

export function describeResident(r: Resident): string {
  const c = r.character;
  return `${c.name} — ${className(c.class)}, level ${toRoman(c.level)}, ${c.playerKills} kills`;
}
