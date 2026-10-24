import type { Character, Combatant, CombatLine, Monster, Rng } from './types';
import { gameRules } from './rules';
import { chance, randInt } from './rng';
import { weaponById, armorById } from '../content/items';
import { combat as msg, dragon as dragonMsg } from '../content/strings';
import { spellDamage } from '../content/spells';

/**
 * Pure combat. No React, no DOM, no Math.random.
 *
 * A fight resolves to a full transcript of lines. The UI replays them at
 * typewriter speed. This is faithful to the genre — you watched the whole
 * fight scroll past, then read the outcome.
 */

export function playerCombatant(c: Character): Combatant {
  const weapon = weaponById(c.weaponId);
  const armor = armorById(c.armorId);
  const penalty = weapon.armorPenalty ?? 0;
  return {
    name: c.name,
    hp: c.hp,
    maxHp: c.maxHp,
    atk: c.str + weapon.power,
    def: Math.max(0, c.def + armor.power - penalty),
    agi: c.agi,
    isThief: c.class === 'thief',
  };
}

export function monsterCombatant(m: Monster, scalar = 1): Combatant {
  return {
    name: m.name,
    hp: Math.round(m.hp * scalar),
    maxHp: Math.round(m.hp * scalar),
    atk: Math.round(m.atk * scalar),
    def: m.def,
    agi: Math.max(3, m.tier + 2),
    isThief: false,
  };
}

/** Base 80%, ±2% per point of AGI difference, clamped 55–95%. */
export function hitChance(attackerAgi: number, defenderAgi: number, defenderIsThief: boolean): number {
  const { base, perAgiPoint, min, max } = gameRules.hit;
  const raw = base + (attackerAgi - defenderAgi) * perAgiPoint;
  const dodged = raw - (defenderIsThief ? gameRules.thiefDodge : 0);
  return Math.max(min, Math.min(max, dodged));
}

function damageRoll(rng: Rng, atk: number, def: number): number {
  const { variance, floor } = gameRules.damage;
  return Math.max(floor, atk - def + randInt(rng, -variance, variance));
}

export interface AttackOutcome {
  hit: boolean;
  crit: boolean;
  damage: number;
}

export function resolveAttack(
  rng: Rng,
  attacker: { atk: number; agi: number },
  defender: { def: number; agi: number; isThief: boolean },
): AttackOutcome {
  const landed = chance(rng, hitChance(attacker.agi, defender.agi, defender.isThief));
  if (!landed) return { hit: false, crit: false, damage: 0 };
  const crit = chance(rng, gameRules.crit.chance);
  const base = damageRoll(rng, attacker.atk, defender.def);
  return { hit: true, crit, damage: crit ? base * gameRules.crit.multiplier : base };
}

/* ------------------------------------------------------------------ */
/* Magician auto-cast                                                  */
/* ------------------------------------------------------------------ */

interface SpellChoice {
  id: string;
  label: string;
  /** Mana cost. */
  mana: number;
  damage: number;
  heal: number;
  ward: boolean;
  sleep: boolean;
}

/**
 * Magicians cast automatically. The policy is deliberately simple and
 * readable in the transcript: raise Ward when exposed, Drain when badly hurt,
 * finish with Fireball, otherwise Spark. Sleep is never auto-cast — it is too
 * situational to spend a turn on without the player asking for it.
 */
function chooseSpell(
  c: Character,
  mana: number,
  targetHp: number,
  wardActive: boolean,
): SpellChoice | null {
  if (c.class !== 'magician') return null;
  const known = (id: string) => c.spells.includes(id);

  if (known('ward') && mana >= 3 && !wardActive && c.hp < c.maxHp * 0.7) {
    return { id: 'ward', label: 'Ward', mana: 3, damage: 0, heal: 0, ward: true, sleep: false };
  }
  if (known('drain') && mana >= 4 && c.hp < c.maxHp * 0.45) {
    return { id: 'drain', label: 'Drain', mana: 4, damage: 6, heal: 3, ward: false, sleep: false };
  }

  const fireballDmg = spellDamage('fireball', c.level);
  if (known('fireball') && mana >= 7 && targetHp > fireballDmg) {
    return {
      id: 'fireball',
      label: 'Fireball',
      mana: 7,
      damage: fireballDmg,
      heal: 0,
      ward: false,
      sleep: false,
    };
  }
  if (known('spark') && mana >= 2) {
    return {
      id: 'spark',
      label: 'Spark',
      mana: 2,
      damage: spellDamage('spark', c.level),
      heal: 0,
      ward: false,
      sleep: false,
    };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Full fight                                                          */
/* ------------------------------------------------------------------ */

export interface FightInput {
  rng: Rng;
  character: Character;
  monster: Monster;
  /** Difficulty multiplier for a respawned wyrm, or 1. */
  scalar?: number;
  /** True for the endgame fight; changes the taunt line and double attacks. */
  isWyrm?: boolean;
}

export interface FightResult {
  lines: CombatLine[];
  won: boolean;
  /** Player HP at the end. Can be 0 or below — the caller applies death. */
  playerHp: number;
  monsterHp: number;
  /** Mana spent, so the caller can persist it. */
  manaLeft: number;
  rounds: number;
}

const MAX_ROUNDS = 120;

export function resolveFight(input: FightInput): FightResult {
  const { rng, character: c, monster, isWyrm = false } = input;
  const scalar = input.scalar ?? 1;

  const monsterMight = monsterCombatant(monster, scalar);
  const player = playerCombatant(c);

  let playerHp = Math.max(1, player.hp);
  let monsterHp = monsterMight.hp;
  let mana = c.mana;

  let ward = 0;
  let monsterAsleep = false;
  let round = 0;

  const lines: CombatLine[] = [];

  lines.push({ text: combatOpen(monster), tone: 'normal' });
  lines.push({ text: `{dim}${monster.desc}{/}`, tone: 'dim' });

  while (playerHp > 0 && monsterHp > 0 && round < MAX_ROUNDS) {
    round += 1;

    /* ---- Player turn ------------------------------------------- */
    const spell = chooseSpell(c, mana, monsterHp, ward > 0);

    if (spell) {
      mana -= spell.mana;
      if (spell.ward) {
        ward += 6;
        lines.push({ text: `{bright}You cast Ward.{/} {dim}The air hardens around you.{/}` });
      } else {
        if (spell.heal > 0) {
          playerHp = Math.min(player.maxHp, playerHp + spell.heal);
        }
        monsterHp -= spell.damage;
        lines.push({
          text: `{bright}You cast ${spell.label}.{/} ${monster.name} takes ${spell.damage} damage.`,
          tone: 'bright',
        });
      }
    } else {
      const swing = resolveAttack(rng, player, {
        def: monsterMight.def,
        agi: monsterMight.agi,
        isThief: false,
      });
      if (!swing.hit) {
        lines.push({ text: pickLine(rng, msg.miss), tone: 'dim' });
      } else if (swing.crit) {
        monsterHp -= swing.damage;
        lines.push({
          text: msg.crit[0].replace('{n}', String(swing.damage)),
          tone: 'bright',
        });
      } else {
        monsterHp -= swing.damage;
        lines.push({
          text: fill(pickLine(rng, msg.hit), swing.damage),
          tone: 'normal',
        });
      }
    }

    if (monsterHp <= 0) break;

    /* ---- Monster turn ------------------------------------------ */
    if (monsterAsleep) {
      monsterAsleep = false;
      lines.push({ text: `{dim}${monster.name} does not move. It is still asleep.{/}`, tone: 'dim' });
      continue;
    }

    const attacks = isWyrm && round % gameRules.wyrm.doubleAttackEvery === 0 ? 2 : 1;
    if (attacks > 1) {
      lines.push({ text: dragonMsg.doubleAttack, tone: 'red' });
    }

    for (let i = 0; i < attacks; i += 1) {
      const swing = resolveAttack(rng, monsterMight, {
        def: Math.max(0, player.def + ward),
        agi: player.agi,
        isThief: player.isThief,
      });
      if (!swing.hit) {
        if (player.isThief) {
          lines.push({ text: msg.dodge, tone: 'dim' });
        } else {
          lines.push({ text: pickLine(rng, msg.monsterMiss), tone: 'dim' });
        }
        continue;
      }
      playerHp -= swing.damage;
      lines.push({
        text: fill(pickLine(rng, msg.monsterHit), swing.damage),
        tone: 'red',
      });
    }
  }

  const won = monsterHp <= 0 && playerHp > 0;

  if (won) {
    lines.push({ text: pickLine(rng, msg.victory), tone: 'bright' });
  } else if (playerHp <= 0) {
    lines.push({ text: pickLine(rng, msg.defeat), tone: 'red' });
  } else {
    lines.push({ text: '{dim}The fight goes on too long. You break away.{/}', tone: 'dim' });
  }

  return {
    lines,
    won,
    playerHp: Math.max(0, playerHp),
    monsterHp: Math.max(0, monsterHp),
    manaLeft: Math.max(0, mana),
    rounds: round,
  };
}

function combatOpen(monster: Monster): string {
  const opener = msg.encounter[0];
  return `${opener} {bright}${monster.name}{/} comes at you!`;
}

function pickLine(rng: Rng, list: readonly string[]): string {
  return list[Math.floor(rng() * list.length)];
}

function fill(template: string, n: number): string {
  return template.replace('{n}', String(n));
}
