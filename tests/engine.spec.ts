import { describe, expect, it } from 'vitest';
import { gameRules, levelForXp, toRoman, dayKey, daysBetween } from '../server/engine/rules';
import { mulberry32, randInt } from '../server/engine/rng';
import { maxHpForLevel, awardXp, xpToNext } from '../server/engine/progression';
import { applyDeath, rolloverDay, bankDeposit, applyDailyInterest, sellEquipped } from '../server/engine/economy';
import { buildStartingCharacter } from '../server/engine/creation';
import { resolveFight, hitChance } from '../server/engine/combat';
import { monstersForLevel, wyrm } from '../server/content/monsters';
import { armorById, weaponById, shopArmors, shopWeapons } from '../server/content/items';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hero(overrides: Partial<Parameters<typeof buildStartingCharacter>[0]> = {}) {
  return buildStartingCharacter({
    name: 'Testward',
    sex: 'm',
    cls: 'warrior',
    now: '2025-01-01T00:00:00.000Z',
    ...overrides,
  });
}

/* ------------------------------------------------------------------ */

describe('rules tables', () => {
  it('has a twelve-entry level table', () => {
    expect(gameRules.xpTable).toHaveLength(13);
    expect(gameRules.xpTable[12]).toBe(19000);
    expect(gameRules.maxLevel).toBe(12);
  });

  it('XP thresholds never decrease', () => {
    for (let l = 2; l <= gameRules.maxLevel; l += 1) {
      expect(gameRules.xpTable[l]).toBeGreaterThan(gameRules.xpTable[l - 1]);
    }
  });

  it('maxHp is monotonic: 15 at level 1, 136 at level 12', () => {
    expect(maxHpForLevel(1)).toBe(15);
    expect(maxHpForLevel(12)).toBe(136);
    for (let l = 2; l <= 12; l += 1) {
      expect(maxHpForLevel(l)).toBeGreaterThan(maxHpForLevel(l - 1));
    }
  });

  it('levelForXp matches the table exactly at boundaries', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
    expect(levelForXp(299)).toBe(2);
    expect(levelForXp(300)).toBe(3);
    expect(levelForXp(19000)).toBe(12);
    expect(levelForXp(999999)).toBe(12);
  });

  it('roman numerals are correct for 1..12', () => {
    const expected = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
    for (let l = 1; l <= 12; l += 1) {
      expect(toRoman(l)).toBe(expected[l - 1]);
    }
  });

  it('dayKey is UTC and daysBetween counts whole days', () => {
    expect(dayKey(Date.parse('2025-03-09T23:59:00Z'))).toBe('2025-03-09');
    expect(dayKey(Date.parse('2025-03-10T00:01:00Z'))).toBe('2025-03-10');
    expect(daysBetween('2025-01-01', '2025-01-02')).toBe(1);
    expect(daysBetween('2025-01-01', '2025-01-01')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 20; i += 1) {
      expect(a()).toBe(b());
    }
  });

  it('produces values in [0,1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('randInt stays within bounds inclusive', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 500; i += 1) {
      const v = randInt(rng, -2, 2);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThanOrEqual(2);
    }
  });
});

/* ------------------------------------------------------------------ */

describe('character creation', () => {
  it('matches the spec starting stats', () => {
    const w = hero({ cls: 'warrior' });
    expect([w.str, w.def, w.agi, w.chm]).toEqual([12, 8, 5, 5]);

    const m = hero({ cls: 'magician', name: 'Mage' });
    expect([m.str, m.def, m.agi, m.chm]).toEqual([5, 5, 6, 9]);

    const t = hero({ cls: 'thief', name: 'Thief' });
    expect([t.str, t.def, t.agi, t.chm]).toEqual([8, 6, 11, 7]);
  });

  it('starts with 50 gold, the warrior kit, and 10 turns', () => {
    const c = hero();
    expect(c.gold).toBe(50);
    expect(c.gems).toBe(0);
    expect(c.weaponId).toBe('rusty-dagger');
    expect(c.armorId).toBe('rags');
    expect(c.turnsRemaining).toBe(10);
    expect(c.level).toBe(1);
    expect(c.xp).toBe(0);
  });

  /*
   * THE KIT IS PER CLASS.
   *
   * A magician handed a rusty dagger is a warrior with worse numbers — the class
   * choice would not read as a choice until the spells arrived at level five.
   * These assertions exist so a future refactor cannot quietly collapse the kits
   * back into one.
   */
  it('gives a magician a wand and cloth, not a dagger and rags', () => {
    const m = hero({ cls: 'magician', name: 'Mage' });
    expect(m.weaponId).toBe('weak-wand');
    expect(m.armorId).toBe('cloth-robes');
  });

  it('keeps the dagger for warriors and thieves', () => {
    expect(hero({ cls: 'warrior' }).weaponId).toBe('rusty-dagger');
    expect(hero({ cls: 'thief', name: 'Cutpurse' }).weaponId).toBe('rusty-dagger');
    expect(hero({ cls: 'thief', name: 'Cutpurse' }).armorId).toBe('rags');
  });

  it('makes the wand weaker than the dagger and the robes worse than nothing', () => {
    /* The wand is meant to be a stick. If it ever out-damages the dagger, the
       magician has become a free upgrade rather than a trade-off. */
    expect(weaponById('weak-wand').power).toBeLessThan(weaponById('rusty-dagger').power);
    /* Robes beat rags — barely. A magician should feel fragile, not punished. */
    expect(armorById('cloth-robes').power).toBeGreaterThan(armorById('rags').power);
  });

  it('never sells either starting kit in the shop', () => {
    const weaponIds = shopWeapons().map((w) => w.id);
    const armorIds = shopArmors().map((a) => a.id);

    expect(weaponIds).not.toContain('weak-wand');
    expect(weaponIds).not.toContain('rusty-dagger');
    expect(armorIds).not.toContain('cloth-robes');
    expect(armorIds).not.toContain('rags');
  });

  it('refuses to sell the starter but does sell an upgrade', () => {
    const mage = { ...hero({ cls: 'magician', name: 'Mage' }), weaponId: 'short-sword' };

    /* Selling the sword drops the magician back to a WAND, not a dagger —
       the fallback is per class, and getting that wrong is a silent class change. */
    const sold = sellEquipped(mage, 'weapon');
    expect(sold.ok).toBe(true);
    expect(sold.character.weaponId).toBe('weak-wand');

    /* The starter itself is unsellable: there is nothing to fall back to. */
    const refused = sellEquipped(sold.character, 'weapon');
    expect(refused.ok).toBe(false);
  });

  it('magicians know Spark', () => {
    expect(hero({ cls: 'magician', name: 'Mage' }).spells).toContain('spark');
    expect(hero().spells).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */

describe('progression', () => {
  it('levels up exactly at the threshold', () => {
    const c = hero();
    const below = awardXp(c, 99);
    expect(below.leveled).toBe(false);
    expect(below.character.level).toBe(1);

    const at = awardXp(c, 100);
    expect(at.leveled).toBe(true);
    expect(at.character.level).toBe(2);
  });

  it('heals to full and grants class stats on level up', () => {
    const c = { ...hero(), hp: 3 };
    const result = awardXp(c, 100);
    expect(result.character.hp).toBe(result.character.maxHp);
    expect(result.character.str).toBe(13);
    expect(result.character.def).toBe(9);
  });

  it('can gain several levels at once and never exceeds 12', () => {
    const result = awardXp(hero(), 25000);
    expect(result.character.level).toBe(12);
    expect(result.character.maxHp).toBe(136);
    expect(xpToNext(result.character)).toBe(0);
  });

  it('level never decreases when XP is below the threshold', () => {
    const c = { ...hero(), level: 5 };
    const result = awardXp(c, 0);
    expect(result.character.level).toBe(5);
  });
});

/* ------------------------------------------------------------------ */

describe('day rollover', () => {
  it('grants exactly ten turns once per day', () => {
    const c = { ...hero(), turnsRemaining: 2, lastTurnResetDay: '2025-01-01' };
    const first = rolloverDay(c, Date.parse('2025-01-02T10:00:00Z'));
    expect(first.rolled).toBe(true);
    expect(first.character.turnsRemaining).toBe(10);

    const second = rolloverDay(first.character, Date.parse('2025-01-02T22:00:00Z'));
    expect(second.rolled).toBe(false);
    expect(second.character.turnsRemaining).toBe(10);
  });

  it('is idempotent across repeated calls in one day', () => {
    const c = { ...hero(), turnsRemaining: 0, lastTurnResetDay: '2025-01-01' };
    const now = Date.parse('2025-01-05T12:00:00Z');
    let current = c;
    for (let i = 0; i < 20; i += 1) {
      current = rolloverDay(current, now).character;
    }
    expect(current.turnsRemaining).toBe(10);
  });

  it('never grants retroactive turns for skipped days', () => {
    const c = { ...hero(), turnsRemaining: 4, lastTurnResetDay: '2025-01-01' };
    const after = rolloverDay(c, Date.parse('2025-01-20T12:00:00Z')).character;
    expect(after.turnsRemaining).toBe(10);
  });

  it('refills mana on rollover', () => {
    const c = { ...hero({ cls: 'magician' }), mana: 0, lastTurnResetDay: '2025-01-01' };
    const after = rolloverDay(c, Date.parse('2025-01-02T12:00:00Z')).character;
    expect(after.mana).toBe(8);
  });
});

/* ------------------------------------------------------------------ */

describe('bank', () => {
  it('pays 2% interest', () => {
    const c = { ...hero(), banked: 1000 };
    const { interest, character } = applyDailyInterest(c);
    expect(interest).toBe(20);
    expect(character.banked).toBe(1020);
  });

  it('caps interest at 5000 banked', () => {
    const c = { ...hero(), banked: 50_000 };
    const { interest } = applyDailyInterest(c);
    expect(interest).toBe(Math.floor(5000 * 0.02));
  });

  it('cannot deposit beyond the cap', () => {
    const c = { ...hero(), gold: 10_000, banked: 4900 };
    const after = bankDeposit(c, 10_000);
    expect(after.banked).toBe(5000);
    expect(after.gold).toBe(9900);
  });

  it('pays no interest on an empty bank', () => {
    expect(applyDailyInterest(hero()).interest).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

describe('death', () => {
  const rng = mulberry32(1);

  it('loses 25% of carried gold and revives at half health', () => {
    const c = { ...hero(), gold: 100, hp: 0, deaths: 0 };
    const { character } = applyDeath(c, rng);
    expect(character.gold).toBe(75);
    expect(character.hp).toBe(Math.round(character.maxHp * 0.5));
    expect(character.deaths).toBe(1);
  });

  it('leaves banked gold alone', () => {
    const c = { ...hero(), gold: 100, banked: 500, hp: 0 };
    expect(applyDeath(c, rng).character.banked).toBe(500);
  });

  it('never de-levels', () => {
    const c = { ...hero(), level: 5, xp: 1500, hp: 0 };
    const after = applyDeath(c, rng).character;
    expect(after.level).toBe(5);
    expect(after.xp).toBeGreaterThanOrEqual(gameRules.xpTable[5]);
  });
});

/* ------------------------------------------------------------------ */

describe('combat', () => {
  it('clamps hit chance between 55% and 95%', () => {
    expect(hitChance(100, 1, false)).toBeLessThanOrEqual(0.95);
    expect(hitChance(1, 100, false)).toBeGreaterThanOrEqual(0.55);
  });

  it('a thief is harder to hit than a warrior', () => {
    expect(hitChance(10, 10, true)).toBeLessThan(hitChance(10, 10, false));
  });

  it('always terminates and produces a spread of outcomes', () => {
    const rng = mulberry32(1234);
    const monster = monstersForLevel(1)[0];
    let wins = 0;
    for (let i = 0; i < 50; i += 1) {
      const result = resolveFight({ rng, character: hero(), monster });
      expect(result.rounds).toBeGreaterThan(0);
      expect(result.rounds).toBeLessThanOrEqual(120);
      expect(result.lines.length).toBeGreaterThan(0);
      if (result.won) wins += 1;
    }
    expect(wins).toBeGreaterThan(0);
  });

  it('the wyrm can kill a level 12 warrior', () => {
    const rng = mulberry32(99);
    const strong = { ...hero(), level: 12, xp: 19000, str: 30, def: 20, maxHp: 136, hp: 136 };
    let losses = 0;
    for (let i = 0; i < 30; i += 1) {
      const result = resolveFight({ rng, character: strong, monster: wyrm, isWyrm: true });
      if (!result.won) losses += 1;
    }
    expect(losses).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const monster = monstersForLevel(3)[0];
    const a = resolveFight({ rng: mulberry32(5), character: hero({ cls: 'warrior' }), monster });
    const b = resolveFight({ rng: mulberry32(5), character: hero({ cls: 'warrior' }), monster });
    expect(a.lines.map((l) => l.text)).toEqual(b.lines.map((l) => l.text));
  });
});

/* ------------------------------------------------------------------ */

describe('monsters', () => {
  it('has 18 forest monsters across 6 tiers', () => {
    let total = 0;
    for (let tier = 1; tier <= 6; tier += 1) {
      const pool = monstersForLevel(tier * 2);
      expect(pool.length).toBe(3);
      total += pool.length;
    }
    expect(total).toBe(18);
  });

  it('tier 1 is what a level 1 character meets', () => {
    const pool = monstersForLevel(1);
    expect(pool.map((m) => m.name)).toContain('Field Rat');
    expect(pool.every((m) => m.tier === 1)).toBe(true);
  });

  it('the wyrm is 400 HP and 45 attack', () => {
    expect(wyrm.hp).toBe(400);
    expect(wyrm.atk).toBe(45);
  });
});
