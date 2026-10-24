export type ItemKind = 'weapon' | 'armor';

export interface Item {
  id: string;
  name: string;
  kind: ItemKind;
  /** Weapon damage or armor defense value. */
  power: number;
  /** Gold price. 0 means "not sold". */
  price: number;
  /** Gems required on top of gold. */
  gems: number;
  desc: string;
  /** Starting kit — never appears in the shop's buy list. */
  starting?: boolean;
  /** Sold by the forest peddler only. */
  cursed?: boolean;
  /** Defense penalty applied while equipped (the cursed blade). */
  armorPenalty?: number;
}

export const weapons: Item[] = [
  {
    id: 'rusty-dagger',
    name: 'Rusty Dagger',
    kind: 'weapon',
    power: 3,
    price: 0,
    gems: 0,
    desc: 'The blade turns in your grip. It is not a good blade.',
    starting: true,
  },
  {
    id: 'short-sword',
    name: 'Short Sword',
    kind: 'weapon',
    power: 6,
    price: 120,
    gems: 0,
    desc: 'Honest steel, honestly made. It will not save you. It will help.',
  },
  {
    id: 'hand-axe',
    name: 'Hand Axe',
    kind: 'weapon',
    power: 8,
    price: 300,
    gems: 0,
    desc: 'Meant for firewood. Acquires a second purpose in the forest.',
  },
  {
    id: 'long-sword',
    name: 'Long Sword',
    kind: 'weapon',
    power: 11,
    price: 700,
    gems: 0,
    desc: 'Reach, balance, weight. The smith was awake when he made this one.',
  },
  {
    id: 'war-hammer',
    name: 'War Hammer',
    kind: 'weapon',
    power: 14,
    price: 1400,
    gems: 0,
    desc: 'Armor is a suggestion. This is the counter-argument.',
  },
  {
    id: 'two-handed-sword',
    name: 'Two-Handed Sword',
    kind: 'weapon',
    power: 18,
    price: 2600,
    gems: 0,
    desc: 'You will not carry anything else. You will not need to.',
  },
  {
    id: 'runed-blade',
    name: 'Runed Blade',
    kind: 'weapon',
    power: 23,
    price: 5000,
    gems: 2,
    desc: 'Someone cut words into the steel. The words were not for you.',
  },
  {
    id: 'cursed-blade',
    name: 'Peddler\u2019s Blade',
    kind: 'weapon',
    power: 6,
    price: 200,
    gems: 0,
    desc: 'It cuts beautifully. It also cuts your defenses, somehow.',
    cursed: true,
    armorPenalty: 3,
  },
];

export const armors: Item[] = [
  {
    id: 'rags',
    name: 'Rags',
    kind: 'armor',
    power: 1,
    price: 0,
    gems: 0,
    desc: 'They are technically clothing. They are technically armor.',
    starting: true,
  },
  {
    id: 'leather',
    name: 'Leather',
    kind: 'armor',
    power: 3,
    price: 100,
    gems: 0,
    desc: 'Boiled hide. Smells of the tannery. Stops most of a knife.',
  },
  {
    id: 'chain-mail',
    name: 'Chain Mail',
    kind: 'armor',
    power: 6,
    price: 350,
    gems: 0,
    desc: 'Every ring closed by hand. You will hear yourself coming.',
  },
  {
    id: 'scale-mail',
    name: 'Scale Mail',
    kind: 'armor',
    power: 9,
    price: 800,
    gems: 0,
    desc: 'Overlapping plates. Heavy. Worth the weight.',
  },
  {
    id: 'plate-mail',
    name: 'Plate Mail',
    kind: 'armor',
    power: 13,
    price: 1800,
    gems: 0,
    desc: 'A knight\u2019s shell. You will not be fast. You will not need to be.',
  },
  {
    id: 'dragon-scale',
    name: 'Dragon Scale',
    kind: 'armor',
    power: 18,
    price: 6000,
    gems: 5,
    desc: 'Not from the wyrm. From something older that lost an argument.',
  },
];

const allItems: Item[] = [...weapons, ...armors];

export function itemById(id: string): Item {
  return allItems.find((i) => i.id === id) ?? weapons[0];
}

export function weaponById(id: string): Item {
  return weapons.find((i) => i.id === id) ?? weapons[0];
}

export function armorById(id: string): Item {
  return armors.find((i) => i.id === id) ?? armors[0];
}

/** Shop stock: everything not starting-grade, in ascending price order. */
export function shopWeapons(): Item[] {
  return weapons.filter((w) => !w.starting && !w.cursed).sort((a, b) => a.price - b.price);
}

export function shopArmors(): Item[] {
  return armors.filter((a) => !a.starting).sort((a, b) => a.price - b.price);
}

/** Shop stock: everything not starting-grade, cheapest first. */
export function itemsCatalog(): Item[] {
  return [...shopWeapons(), ...shopArmors()];
}

/** Gold the shop pays. Weapons and armor both buy back at 40% of list. */
export function buybackValue(item: Item, pct: number): number {
  return Math.floor(item.price * pct);
}
