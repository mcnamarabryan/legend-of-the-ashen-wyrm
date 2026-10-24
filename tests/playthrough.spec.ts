import { describe, expect, it } from 'vitest';
import type { Character, SaveFile } from '../server/engine/types';
import { mulberry32, type Rng } from '../server/engine/rng';
import { gameRules } from '../server/engine/rules';
import { buildStartingCharacter } from '../server/engine/creation';
import { rolloverDay, healCost, healFully, bankDeposit, bankWithdraw } from '../server/engine/economy';
import { itemsCatalog, shopArmors, shopWeapons } from '../server/content/items';
import { wyrmAvailability } from '../server/engine/dragon';
import * as flow from '../server/flow';
import { emptySave, serialize, loadSave } from '../server/engine/save';

/**
 * The definition of done, in code.
 *
 * A player goes from boot to Wyrmbane in a simulated run: spending turns in
 * the forest, buying the best kit they can afford, banking surplus, healing
 * before walking north, and finally facing the wyrm. Saves are round-tripped
 * through JSON at every step, because a save that does not survive a reload
 * is not a save.
 *
 * The day budget is deliberately generous. Reaching 19,000 XP at the spec's
 * XP-per-fight rates takes roughly 200 victories, and a 1-in-8 encounter rate
 * means about 8.75 fights per day — so ~23 days of unfailing play is the
 * arithmetic floor, not a tuning failure. The harness asserts the *journey*
 * completes, not that it completes in twenty days.
 */

const DAY = 86_400_000;
const START = Date.parse('2025-01-01T09:00:00Z');
const MAX_DAYS = 40;

type Base = Omit<flow.FlowContext, 'character' | 'rng' | 'now'>;

/**
 * Buy the best affordable upgrade, pulling from the bank if that closes the
 * gap, then bank the remainder. A real player moves money around; a harness
 * that hoards banked gold while fighting in rags is testing the wrong thing.
 */
function shopAndBank(c: Character, now: number): Character {
  let current = c;
  const stock = itemsCatalog();

  for (let guard = 0; guard < 12; guard += 1) {
    const upgrades = stock
      .filter((i) => {
        const equippedId = i.kind === 'weapon' ? current.weaponId : current.armorId;
        const equippedItem = stock.find((s) => s.id === equippedId);
        return i.power > (equippedItem?.power ?? 0);
      })
      .sort((a, b) => b.price - a.price);

    if (upgrades.length === 0) break;

    /* Take the best upgrade we can afford, withdrawing if a top-up helps. */
    let bought = false;
    for (const pick of upgrades) {
      const shortfall = pick.price - current.gold;
      if (shortfall > 0 && current.banked > 0) {
        current = bankWithdraw(current, Math.min(shortfall, current.banked));
      }
      if (current.gold < pick.price || current.gems < pick.gems) continue;

      const tab = pick.kind === 'weapon' ? 'weapon' : 'armor';
      const page = tab === 'weapon' ? shopWeapons() : shopArmors();
      const index = page.findIndex((p) => p.id === pick.id);
      if (index < 0) continue;

      const step = flow.shopBuy(
        { character: current, residents: [], hall: [], others: [], now, rng: mulberry32(1) },
        tab,
        index,
      );
      if (step.character.gold === current.gold) continue;
      current = step.character;
      bought = true;
      break;
    }

    if (!bought) break;
  }

  /* Keep a working purse in hand; the rest earns interest. */
  const buffer = 40;
  if (current.gold > buffer) {
    current = bankDeposit(current, current.gold - buffer);
  }
  return current;
}

/** Full heal if we can afford it. Returns the (possibly unchanged) character. */
function healIfHurt(c: Character): Character {
  if (c.hp >= c.maxHp) return c;
  const cost = healCost(c);
  if (cost <= 0) return c;

  let wallet = c;
  if (wallet.gold < cost && wallet.banked > 0) {
    wallet = bankWithdraw(wallet, Math.min(cost - wallet.gold, wallet.banked));
  }
  if (wallet.gold < cost) return c;

  const healed = healFully(wallet);
  return healed.ok ? healed.character : c;
}

describe('headless playthrough', () => {
  it('reaches level 12 and slays the wyrm', () => {
    const rng: Rng = mulberry32(20250101);
    const base: Base = { residents: [], hall: [], others: [] };

    const startChar = buildStartingCharacter({
      name: 'Harness',
      sex: 'm',
      cls: 'warrior',
      now: new Date(START).toISOString(),
    });

    let save: SaveFile = emptySave(startChar);
    let daysPlayed = 0;

    for (let day = 0; day < MAX_DAYS; day += 1) {
      const now = START + day * DAY + 9 * 3_600_000;

      const roll = rolloverDay(save.character, now);
      save = { ...save, character: roll.character };

      /* Spend every turn the day gives us. */
      for (let t = 0; t < 60; t += 1) {
        if (save.character.turnsRemaining <= 0) break;

        /* Patch up before a fight so a bad roll is not a death spiral. */
        const healed = healIfHurt(save.character);
        if (healed.hp > save.character.hp) save = { ...save, character: healed };

        const step = flow.forestTurn({ ...base, now, rng, character: save.character });
        save = { ...save, character: step.character };

        /* Round-trip the save; a save that does not survive reload is a bug. */
        const reloaded = loadSave(JSON.parse(serialize(save)), now);
        expect(reloaded).not.toBeNull();
        save = reloaded!.save;
      }

      /* Re-kit and bank between days. */
      save = { ...save, character: shopAndBank(save.character, now) };
      daysPlayed = day + 1;

      if (save.character.level >= gameRules.maxLevel) break;
    }

    expect(daysPlayed).toBeLessThan(MAX_DAYS);
    expect(save.character.level).toBe(gameRules.maxLevel);
    expect(save.character.xp).toBeGreaterThanOrEqual(gameRules.xpTable[12]);

    /* Walk north, fully rested, with the best kit the run could buy. */
    let champion = healIfHurt(save.character);
    let slain = false;
    let attempts = 0;

    while (!slain && attempts < 20) {
      attempts += 1;
      const attemptTime = START + (daysPlayed + attempts) * DAY;

      champion = healIfHurt(champion);

      expect(wyrmAvailability(champion, attemptTime).available).toBe(true);

      const step = flow.faceWyrm({ ...base, now: attemptTime, rng, character: champion });
      champion = step.character;
      expect(step.lines.length).toBeGreaterThan(0);
      if (champion.isWyrmbane) slain = true;
    }

    expect(slain).toBe(true);
    expect(champion.titles).toContain('Wyrmbane');
  }, 120_000);
});
