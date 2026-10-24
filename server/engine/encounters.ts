import type { Character, CombatLine, EncounterId } from './types';
import { gameRules } from './rules';
import { chance, pick, randInt, weightedPick, type Rng } from './rng';
import { weapons } from '../content/items';
import { spells } from '../content/spells';
import { encounters as msg, forest } from '../content/strings';

/**
 * The special forest encounters. One in eight forest turns.
 *
 * Every encounter returns a `prompt` when it needs a yes/no decision, and
 * `lines` for whatever happens immediately. The UI collects the answer and
 * calls `resolveEncounter` with the choice.
 */

export interface Encounter {
  id: EncounterId;
  title: string;
  lines: CombatLine[];
  /** A Y/N question, if this encounter needs one. */
  prompt?: string;
  /** True when the encounter is purely narrative and must not cost a turn. */
  free: boolean;
}

export function rollEncounter(rng: Rng, character: Character): Encounter {
  const ids: EncounterId[] = ['soldier', 'gypsy', 'stranger', 'wizard', 'shrine', 'peddler'];
  const id = pick(rng, ids);
  return describeEncounter(id, character);
}

export function describeEncounter(id: EncounterId, c: Character): Encounter {
  const base: CombatLine[] = [{ text: forest.encounter, tone: 'dim' }];

  switch (id) {
    case 'soldier':
      return {
        id,
        title: msg.soldier.title,
        lines: [...base, ...msg.soldier.lines.map((text) => ({ text }))],
        prompt: c.gold >= gameRules.encounters.soldier.goldCost ? msg.soldier.prompt : undefined,
        free: !c.gold || c.gold < gameRules.encounters.soldier.goldCost,
      };
    case 'gypsy':
      return {
        id,
        title: msg.gypsy.title,
        lines: [...base, ...msg.gypsy.lines.map((text) => ({ text }))],
        prompt: c.gems >= gameRules.encounters.gypsy.gems ? msg.gypsy.prompt : undefined,
        free: c.gems < gameRules.encounters.gypsy.gems,
      };
    case 'stranger':
      return {
        id,
        title: msg.stranger.title,
        lines: [...base, ...msg.stranger.lines.map((text) => ({ text }))],
        free: false,
      };
    case 'wizard':
      return {
        id,
        title: msg.wizard.title,
        lines: [...base, ...msg.wizard.lines.map((text) => ({ text }))],
        free: false,
      };
    case 'shrine':
      return {
        id,
        title: msg.shrine.title,
        lines: [...base, ...msg.shrine.lines.map((text) => ({ text }))],
        prompt: msg.shrine.prompt,
        free: false,
      };
    case 'peddler':
      return {
        id,
        title: msg.peddler.title,
        lines: [...base, ...msg.peddler.lines.map((text) => ({ text }))],
        prompt: c.gold >= gameRules.encounters.peddler.cost ? msg.peddler.prompt : undefined,
        free: c.gold < gameRules.encounters.peddler.cost,
      };
    default:
      return { id, title: 'The Forest', lines: base, free: true };
  }
}

export interface EncounterResult {
  character: Character;
  lines: CombatLine[];
  /** The encounter is fully resolved; the caller returns to the hub. */
  done: boolean;
}

/**
 * Resolve the player's answer. `answer` is 'yes' | 'no' | 'ack'.
 */
export function resolveEncounter(
  rng: Rng,
  c: Character,
  id: EncounterId,
  answer: 'yes' | 'no' | 'ack' = 'ack',
): EncounterResult {
  switch (id) {
    case 'soldier':
      return resolveSoldier(rng, c, answer);
    case 'gypsy':
      return resolveGypsy(rng, c, answer);
    case 'stranger':
      return resolveStranger(rng, c);
    case 'wizard':
      return resolveWizard(rng, c);
    case 'shrine':
      return resolveShrine(rng, c, answer);
    case 'peddler':
      return resolvePeddler(c, answer);
    default:
      return { character: c, lines: [], done: true };
  }
}

/* ------------------------------------------------------------------ */

function resolveSoldier(_rng: Rng, c: Character, answer: string): EncounterResult {
  const rule = gameRules.encounters.soldier;
  if (answer !== 'yes') {
    return { character: c, lines: [{ text: msg.soldier.refuse, tone: 'dim' }], done: true };
  }
  if (c.gold < rule.goldCost) {
    return { character: c, lines: [{ text: msg.soldier.noGold, tone: 'dim' }], done: true };
  }
  const next: Character = {
    ...c,
    gold: c.gold - rule.goldCost,
    chm: c.chm + rule.chmReward,
  };
  const awarded = awardFlatXp(next, rule.xpReward);
  return {
    character: awarded,
    lines: [
      ...msg.soldier.accept.map((text) => ({ text })),
      { text: `{gold}+${rule.xpReward} experience{/} {bright}+${rule.chmReward} Charm{/}`, tone: 'gold' },
    ],
    done: true,
  };
}

function resolveGypsy(rng: Rng, c: Character, answer: string): EncounterResult {
  if (answer !== 'yes') {
    return { character: c, lines: [{ text: msg.gypsy.refuse, tone: 'dim' }], done: true };
  }
  if (c.gems < gameRules.encounters.gypsy.gems) {
    return { character: c, lines: [{ text: msg.gypsy.noGems, tone: 'dim' }], done: true };
  }
  const won = chance(rng, 0.5);
  const next: Character = won ? { ...c, gems: c.gems + 1 } : { ...c, gems: c.gems - 1 };
  return {
    character: next,
    lines: (won ? msg.gypsy.win : msg.gypsy.lose).map((text) => ({ text })),
    done: true,
  };
}

function resolveStranger(rng: Rng, c: Character): EncounterResult {
  const rule = gameRules.encounters.stranger;
  const roll = randInt(rng, 1, 20) + Math.floor(c.chm / 2);
  if (roll >= rule.charmDifficulty) {
    return {
      character: { ...c, chm: c.chm + 1 },
      lines: msg.stranger.success.map((text) => ({ text })),
      done: true,
    };
  }
  const stolen = Math.floor(c.gold * rule.goldTheftPct);
  return {
    character: { ...c, gold: c.gold - stolen },
    lines: msg.stranger.fail.map((text) => ({ text })),
    done: true,
  };
}

function resolveWizard(_rng: Rng, c: Character): EncounterResult {
  if (c.class === 'magician') {
    const unknown = spells.filter((s) => !c.spells.includes(s.id));
    if (unknown.length > 0) {
      const learned = unknown[0];
      return {
        character: { ...c, spells: [...c.spells, learned.id] },
        lines: [
          ...msg.wizard.magician.map((text) => ({ text })),
          { text: `{bright}You learn ${learned.name}.{/}`, tone: 'bright' },
        ],
        done: true,
      };
    }
    const withGems = { ...c, gems: c.gems + 1 };
    return {
      character: withGems,
      lines: [{ text: 'You already know everything he has to teach.', tone: 'dim' }, { text: '{gold}+1 gem.{/}' }],
      done: true,
    };
  }
  return {
    character: { ...c, gems: c.gems + 1 },
    lines: msg.wizard.other.map((text) => ({ text })),
    done: true,
  };
}

function resolveShrine(rng: Rng, c: Character, answer: string): EncounterResult {
  if (answer !== 'yes') {
    return { character: c, lines: [{ text: msg.shrine.refuse, tone: 'dim' }], done: true };
  }

  const rule = gameRules.encounters.shrine;
  const outcome = weightedPick<'heal' | 'stat' | 'gold' | 'nothing'>(rng, [
    { value: 'heal', weight: rule.healWeight },
    { value: 'stat', weight: rule.statWeight },
    { value: 'gold', weight: rule.goldLossWeight },
    { value: 'nothing', weight: rule.nothingWeight },
  ]);

  switch (outcome) {
    case 'heal':
      return {
        character: { ...c, hp: c.maxHp },
        lines: msg.shrine.heal.map((text) => ({ text })),
        done: true,
      };
    case 'stat': {
      const which = pick(rng, ['str', 'def', 'agi', 'chm'] as const);
      return {
        character: { ...c, [which]: c[which] + 1 },
        lines: [...msg.shrine.stat.map((text) => ({ text })), { text: `{gold}+1 ${which.toUpperCase()}{/}` }],
        done: true,
      };
    }
    case 'gold': {
      const lost = Math.floor(c.gold * rule.goldLossPct);
      return {
        character: { ...c, gold: c.gold - lost },
        lines: [...msg.shrine.gold.map((text) => ({ text })), { text: `{red}−${lost} gold.{/}` }],
        done: true,
      };
    }
    default:
      return {
        character: c,
        lines: msg.shrine.nothing.map((text) => ({ text })),
        done: true,
      };
  }
}

function resolvePeddler(c: Character, answer: string): EncounterResult {
  const rule = gameRules.encounters.peddler;
  if (answer !== 'yes') {
    return { character: c, lines: [{ text: msg.peddler.refuse, tone: 'dim' }], done: true };
  }
  if (c.gold < rule.cost) {
    return { character: c, lines: [{ text: msg.peddler.noGold, tone: 'dim' }], done: true };
  }
  const blade = weapons.find((w) => w.id === 'cursed-blade');
  return {
    character: {
      ...c,
      gold: c.gold - rule.cost,
      weaponId: blade?.id ?? c.weaponId,
    },
    lines: msg.peddler.accept.map((text) => ({ text })),
    done: true,
  };
}

function awardFlatXp(c: Character, xp: number): Character {
  // Encounter XP does not trigger level-up lines; the caller re-derives level.
  return { ...c, xp: c.xp + xp };
}
