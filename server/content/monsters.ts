import type { Monster } from '../engine/types';

/**
 * The forest. Eighteen monsters in six tiers, plus the wyrm.
 * Defense is derived from tier — the design spec gives HP and attack,
 * so defense follows the same shape rather than inventing a new curve.
 */
const DEF_BY_TIER: Record<number, number> = { 1: 1, 2: 3, 3: 5, 4: 8, 5: 11, 6: 14 };

type MonsterSeed = Omit<Monster, 'def'>;

const seeds: MonsterSeed[] = [
  // Tier 1 — levels 1–2
  {
    id: 'field-rat',
    name: 'Field Rat',
    tier: 1,
    hp: 8,
    atk: 4,
    xp: 12,
    gold: 6,
    desc: 'The size of a cat, and considerably worse tempered.',
  },
  {
    id: 'starving-dog',
    name: 'Starving Dog',
    tier: 1,
    hp: 10,
    atk: 5,
    xp: 15,
    gold: 8,
    desc: 'It has ribs like a washboard and no interest in your sympathy.',
  },
  {
    id: 'mud-kobold',
    name: 'Mud Kobold',
    tier: 1,
    hp: 12,
    atk: 6,
    xp: 18,
    gold: 12,
    desc: 'Knee-high, mud-caked, and holding a sharpened stick with conviction.',
  },

  // Tier 2 — levels 3–4
  {
    id: 'goblin-scout',
    name: 'Goblin Scout',
    tier: 2,
    hp: 22,
    atk: 9,
    xp: 30,
    gold: 20,
    desc: 'It saw you three trees ago. It has been waiting since.',
  },
  {
    id: 'restless-skeleton',
    name: 'Restless Skeleton',
    tier: 2,
    hp: 26,
    atk: 10,
    xp: 34,
    gold: 24,
    desc: 'Still wearing the belt it died in. Still walking.',
  },
  {
    id: 'grave-slime',
    name: 'Grave Slime',
    tier: 2,
    hp: 30,
    atk: 8,
    xp: 28,
    gold: 30,
    desc: 'It has eaten something that was buried with gold.',
  },

  // Tier 3 — levels 5–6
  {
    id: 'orc-brute',
    name: 'Orc Brute',
    tier: 3,
    hp: 45,
    atk: 15,
    xp: 55,
    gold: 45,
    desc: 'It cracks its knuckles one at a time, in no hurry at all.',
  },
  {
    id: 'ghoul',
    name: 'Ghoul',
    tier: 3,
    hp: 40,
    atk: 17,
    xp: 60,
    gold: 40,
    desc: 'It smells the blood on your sleeve and smiles with too many teeth.',
  },
  {
    id: 'road-bandit',
    name: 'Road Bandit',
    tier: 3,
    hp: 48,
    atk: 14,
    xp: 58,
    gold: 90,
    desc: 'A purse with a man attached. He has done this before.',
  },

  // Tier 4 — levels 7–8
  {
    id: 'ogre',
    name: 'Ogre',
    tier: 4,
    hp: 75,
    atk: 22,
    xp: 95,
    gold: 80,
    desc: 'Ten feet of bad mood holding a tree it did not bother to trim.',
  },
  {
    id: 'wraith',
    name: 'Wraith',
    tier: 4,
    hp: 65,
    atk: 25,
    xp: 110,
    gold: 70,
    desc: 'Cold arrives first. The shape arrives after.',
  },
  {
    id: 'hill-giant',
    name: 'Hill Giant',
    tier: 4,
    hp: 90,
    atk: 20,
    xp: 100,
    gold: 120,
    desc: 'It mistakes you for a mushroom. The mistake will be brief.',
  },

  // Tier 5 — levels 9–10
  {
    id: 'cave-troll',
    name: 'Cave Troll',
    tier: 5,
    hp: 120,
    atk: 30,
    xp: 150,
    gold: 140,
    desc: 'Its wounds close while you watch. Yours will not.',
  },
  {
    id: 'dark-knight',
    name: 'Dark Knight',
    tier: 5,
    hp: 110,
    atk: 33,
    xp: 165,
    gold: 180,
    desc: 'The visor is closed. The sword is not.',
  },
  {
    id: 'wyvern',
    name: 'Wyvern',
    tier: 5,
    hp: 130,
    atk: 31,
    xp: 175,
    gold: 160,
    desc: 'It drops out of the canopy without a sound, which is the worst part.',
  },

  // Tier 6 — levels 11–12
  {
    id: 'pit-demon',
    name: 'Pit Demon',
    tier: 6,
    hp: 165,
    atk: 40,
    xp: 240,
    gold: 260,
    desc: 'It climbed out of somewhere the forest does not talk about.',
  },
  {
    id: 'lich',
    name: 'Lich',
    tier: 6,
    hp: 150,
    atk: 44,
    xp: 260,
    gold: 240,
    desc: 'It speaks your name before you give it. That is a bad sign.',
  },
  {
    id: 'young-dragon',
    name: 'Young Dragon',
    tier: 6,
    hp: 180,
    atk: 42,
    xp: 255,
    gold: 300,
    desc: 'Young is relative. It is still bigger than the inn.',
  },
];

export const monsters: Monster[] = seeds.map((s) => ({
  ...s,
  def: DEF_BY_TIER[s.tier] ?? 1,
}));

export function monstersForLevel(level: number): Monster[] {
  const tier = Math.max(1, Math.min(6, Math.ceil(level / 2)));
  return monsters.filter((m) => m.tier === tier);
}

export function monsterById(id: string): Monster | undefined {
  return monsters.find((m) => m.id === id);
}

/** The endgame. Not in the forest table — it has its own rules. */
export const wyrm: Monster = {
  id: 'ashen-wyrm',
  name: 'The Ashen Wyrm',
  tier: 7,
  hp: 400,
  atk: 45,
  xp: 0,
  gold: 0,
  def: 8,
  desc: 'Ash falls from a ceiling you cannot see. Something the size of a barn is breathing.',
};
