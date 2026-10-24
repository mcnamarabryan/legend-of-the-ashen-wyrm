/**
 * THE TUNING SURFACE.
 *
 * Every balance number in the design spec lives here and nowhere else.
 * If you are reaching for a literal in a combat or economy function, the
 * number belongs in this file instead.
 */

export const gameRules = {
  /* ---- Turns & the day ------------------------------------------- */
  turnsPerDay: 10,

  /* ---- Derived stats --------------------------------------------- */
  hp: {
    base: 15,
    perLevel: 11,
  },
  mana: {
    base: 8,
    perLevel: 4,
    levelUpRestorePct: 0.25,
  },
  damage: {
    /** randInt(-variance, +variance) added to atk - def. */
    variance: 2,
    /** Damage never drops below this. */
    floor: 1,
  },
  hit: {
    base: 0.8,
    perAgiPoint: 0.02,
    min: 0.55,
    max: 0.95,
  },
  crit: {
    chance: 0.05,
    multiplier: 2,
  },
  thiefDodge: 0.08,

  /* ---- Level progression ----------------------------------------- */
  /** Total XP required to *reach* the indexed level. Index 0 unused. */
  xpTable: [0, 0, 100, 300, 700, 1400, 2500, 4000, 6000, 8500, 11500, 15000, 19000],
  maxLevel: 12,
  /** Stat points granted per level, allocated by class archetype. */
  levelUpGains: {
    warrior: { str: 1, def: 1, agi: 0, chm: 0 },
    magician: { str: 1, def: 0, agi: 0, chm: 1 },
    thief: { str: 1, def: 0, agi: 1, chm: 0 },
  } as Record<string, { str: number; def: number; agi: number; chm: number }>,

  /* ---- Character creation ---------------------------------------- */
  start: {
    gold: 50,
    gems: 0,
    level: 1,
    xp: 0,
    /**
     * Starting kit, PER CLASS.
     *
     * A magician handed a rusty dagger is not a magician — it is a warrior with
     * worse stats. The kit is what makes the class read as a choice on turn one
     * rather than something you notice at level five when the spells arrive.
     *
     * The magician's wand is deliberately weak: 2 damage against the dagger's 3.
     * It is a stick. That is the joke, and the compensation is that they open
     * with Spark and can afford a real weapon sooner because they are not
     * spending gold replacing a decent starting kit.
     *
     * Cloth is 2 armor, Rags is 1. Marginal on purpose: a magician should feel
     * fragile, not merely start at a disadvantage.
     */
    kits: {
      warrior: { weaponId: 'rusty-dagger', armorId: 'rags' },
      magician: { weaponId: 'weak-wand', armorId: 'cloth-robes' },
      thief: { weaponId: 'rusty-dagger', armorId: 'rags' },
    } as Record<string, { weaponId: string; armorId: string }>,
  },
  baseStats: {
    warrior: { str: 12, def: 8, agi: 5, chm: 5, hp: 26 },
    magician: { str: 5, def: 5, agi: 6, chm: 9, hp: 18 },
    thief: { str: 8, def: 6, agi: 11, chm: 7, hp: 21 },
  } as Record<string, { str: number; def: number; agi: number; chm: number; hp: number }>,

  nameMinLength: 3,
  nameMaxLength: 16,
  namePattern: /^[A-Za-z' -]+$/,

  /* ---- Economy ---------------------------------------------------- */
  bank: {
    interestPct: 0.02,
    cap: 5000,
  },
  shop: {
    /** Fraction of list price the shop pays when buying back. */
    buybackPct: 0.4,
  },

  /* ---- Death ------------------------------------------------------ */
  death: {
    goldLossPct: 0.25,
    xpLossPct: 0.1,
    reviveHpPct: 0.5,
  },

  /* ---- PvP -------------------------------------------------------- */
  pvp: {
    levelRange: 2,
    goldStealPct: 0.15,
    stealChance: 0.6,
    stealPct: 0.1,
  },

  /* ---- Forest ----------------------------------------------------- */
  forest: {
    /** Chance a forest turn is a special encounter rather than a monster. */
    encounterChance: 1 / 8,
    /** Chance a special encounter costs a turn even when narrative-only. */
    encounterCostsTurn: false,
    /**
     * Chance a won forest fight yields a gem.
     *
     * Gems are the gate on the best armor, and the best armor is what makes
     * the wyrm survivable at level 12. Without a steady trickle the endgame
     * is mathematically unreachable, so this rate exists to keep the spec'd
     * 400/45 wyrm beatable inside a few weeks.
     */
    gemDropChance: 0.06,
  },

  /* ---- Special encounters ---------------------------------------- */
  encounters: {
    soldier: { goldCost: 50, xpReward: 40, chmReward: 2 },
    gypsy: { gems: 1 },
    stranger: { charmDifficulty: 12, goldTheftPct: 0.1 },
    shrine: {
      healWeight: 1,
      statWeight: 1,
      goldLossWeight: 1,
      nothingWeight: 1,
      goldLossPct: 0.2,
    },
    peddler: { cost: 200, bladeBonus: 6, armorPenalty: 3 },
  },

  /* ---- The Ashen Wyrm -------------------------------------------- */
  wyrm: {
    hp: 400,
    atk: 45,
    requiredLevel: 12,
    /** Rounds between the wyrm's double attacks. */
    doubleAttackEvery: 3,
    respawnDays: 7,
    respawnScalar: 1.25,
  },

  /* ---- Wren ------------------------------------------------------- */
  wren: {
    drinkCost: 20,
    ringCost: 500,
    charmRequirement: 10,
  },

  /* ---- Realm ------------------------------------------------------ */
  realm: {
    nodeName: 'BKM REALM NODE 01',
    channelName: 'ashen-wyrm-realm',
    feedLimit: 25,
    /** Cap resident progress so they never outrun a diligent player badly. */
    residentMaxLevelAhead: 1,
    residentTurnsPerDay: 10,
    /** Most days of resident catch-up granted after an absence. */
    maxCatchUpDays: 14,
    /**
     * All character slots, keyed by lowercased name. One browser profile can
     * hold several characters; each tab plays one of them.
     */
    savesKey: 'ashen-wyrm.saves.v2',
    /** Per-tab pointer, in sessionStorage: which slot this tab is playing. */
    tabSlotKey: 'ashen-wyrm.tab-slot.v1',
    /** Fallback pointer, in localStorage: the slot this browser used last. */
    lastSlotKey: 'ashen-wyrm.last-slot.v1',
    /** Legacy single-save key. Read once, then migrated into a slot. */
    legacySaveKey: 'ashen-wyrm.save.v1',
    realmKey: 'ashen-wyrm.realm.v1',
  },

  /* ---- Terminal --------------------------------------------------- */
  terminal: {
    typewriterMs: 18,
    typewriterFastMs: 0,
    /** Never block longer than this on one line for the skip handler. */
    maxLineBlockMs: 400,
    cursorBlinkMs: 530,
  },

  sound: {
    keyclickDb: -30,
    keyclickMs: 4,
  },
} as const;

export type GameRules = typeof gameRules;

/** Roman numerals for the character sheet. Level XII, not Level 12. */
export const ROMAN: string[] = [
  '',
  'I',
  'II',
  'III',
  'IV',
  'V',
  'VI',
  'VII',
  'VIII',
  'IX',
  'X',
  'XI',
  'XII',
];

export function toRoman(n: number): string {
  return ROMAN[n] ?? String(n);
}

/** UTC 'YYYY-MM-DD' for a timestamp. The one true day key. */
export function dayKey(at: number = Date.now()): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Whole UTC days between two 'YYYY-MM-DD' keys. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The identity of a character slot. Names are unique within the realm, so the
 * lowercased trimmed name IS the key — which means two tabs agreeing on a name
 * agree on a slot, with no coordination layer needed.
 */
export function slotKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Total XP needed to reach `level`. */
export function xpForLevel(level: number): number {
  const idx = Math.max(1, Math.min(level, gameRules.maxLevel));
  return gameRules.xpTable[idx];
}

/** Level implied by a total XP value. Monotonic by construction. */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let l = 2; l <= gameRules.maxLevel; l += 1) {
    if (xp >= gameRules.xpTable[l]) level = l;
    else break;
  }
  return level;
}
