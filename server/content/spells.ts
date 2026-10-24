export interface Spell {
  id: string;
  name: string;
  mana: number;
  desc: string;
}

export const spells: Spell[] = [
  {
    id: 'spark',
    name: 'Spark',
    mana: 2,
    desc: 'A jolt of blue fire. Ignores armor entirely.',
  },
  {
    id: 'ward',
    name: 'Ward',
    mana: 3,
    desc: 'A hard shell of air. +6 defense for this fight.',
  },
  {
    id: 'drain',
    name: 'Drain',
    mana: 4,
    desc: 'Borrows life from the target. Returns half to you.',
  },
  {
    id: 'sleep',
    name: 'Sleep',
    mana: 5,
    desc: 'The monster forgets, briefly, that it is fighting.',
  },
  {
    id: 'fireball',
    name: 'Fireball',
    mana: 7,
    desc: 'The expensive answer. 20 plus 3 per level.',
  },
];

export function spellById(id: string): Spell | undefined {
  return spells.find((s) => s.id === id);
}

export function spellDamage(id: string, level: number): number {
  switch (id) {
    case 'spark':
      return 8 + level * 2;
    case 'fireball':
      return 20 + level * 3;
    case 'drain':
      return 6;
    default:
      return 0;
  }
}
