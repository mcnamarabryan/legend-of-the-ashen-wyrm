import type { Character, Resident, SaveFile, Settings } from './types';
import { dayKey, gameRules, slotKey } from './rules';
import { rolloverDay } from './economy';
import { residentSeeds } from '../content/bots';
import { buildStartingCharacter } from './creation';

/**
 * Save schema, migration, and the load-time rollover.
 *
 * There is no server in Phase 1, and the README says so plainly: the client
 * clock is authoritative and therefore gameable.
 *
 * Saves are stored as a MAP OF SLOTS, keyed by lowercased character name.
 * That is what makes same-browser multiplayer work: two tabs can hold two
 * characters without overwriting each other, because they write to different
 * keys. Each tab separately remembers which slot it is playing — in
 * sessionStorage, which is per-tab, so a second tab opens empty and can create
 * its own character.
 *
 * The old single-key save is migrated into a slot on first load. Migrated,
 * never dropped.
 */

export const CURRENT_SAVE_VERSION = 2;

export const defaultSettings: Settings = {
  theme: 'green',
  scanlines: true,
  flicker: true,
  grain: true,
  curvature: true,
  sound: false,
  typewriterMs: gameRules.terminal.typewriterMs,
  contrastBoost: false,
};

export function makeResidents(): Resident[] {
  return residentSeeds.map((seed) => ({
    bio: seed.bio,
    aggression: seed.aggression,
    character: buildStartingCharacter({
      name: seed.name,
      sex: seed.sex,
      cls: seed.class,
      now: new Date().toISOString(),
      level: seed.level,
    }),
  }));
}

export function makeRealmId(): string {
  return 'bkm-node-01';
}

export function emptySave(character: Character): SaveFile {
  return {
    version: CURRENT_SAVE_VERSION,
    realmId: makeRealmId(),
    character,
    hallOfFame: [],
    realmFeed: [],
    residents: makeResidents(),
    settings: { ...defaultSettings },
    residentsProgressedDay: dayKey(),
  };
}

/* ------------------------------------------------------------------ */
/* Slots                                                               */
/* ------------------------------------------------------------------ */

/** Every character slot in this browser, keyed by `slotKey(name)`. */
export type SaveSlots = Record<string, SaveFile>;

export interface SlotEntry {
  key: string;
  save: SaveFile;
}

/**
 * The slots a player can pick from at the title screen, most experienced
 * first. Retired characters are included — they are trophies, not corpses.
 */
export function slotEntries(slots: SaveSlots): SlotEntry[] {
  return Object.entries(slots)
    .map(([key, save]) => ({ key, save }))
    .sort((a, b) => {
      if (a.save.character.retired !== b.save.character.retired) {
        return a.save.character.retired ? 1 : -1;
      }
      return b.save.character.xp - a.save.character.xp;
    });
}

/* ------------------------------------------------------------------ */
/* Migration                                                           */
/* ------------------------------------------------------------------ */

/**
 * Never silently drop a save. Unknown versions are returned intact and the
 * caller decides; missing fields are filled with sane defaults.
 */
export function migrate(raw: unknown): SaveFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const save = raw as Partial<SaveFile> & { version?: number };

  if (!save.character) return null;

  const character: Character = {
    ...save.character,
    titles: save.character.titles ?? [],
    spells: save.character.spells ?? [],
    wyrmRespawnAt: save.character.wyrmRespawnAt ?? 0,
    wyrmAttemptDay: save.character.wyrmAttemptDay ?? null,
    gems: save.character.gems ?? 0,
    banked: save.character.banked ?? 0,
  } as Character;

  return {
    version: CURRENT_SAVE_VERSION,
    realmId: save.realmId ?? makeRealmId(),
    character,
    hallOfFame: save.hallOfFame ?? [],
    realmFeed: save.realmFeed ?? [],
    residents: save.residents ?? makeResidents(),
    settings: { ...defaultSettings, ...(save.settings ?? {}) },
    residentsProgressedDay: save.residentsProgressedDay ?? dayKey(),
  };
}

/**
 * Fold a legacy single-key save into the slot map. Called once, on load, when
 * the slot map is empty and an old key is present.
 */
export function migrateLegacy(legacyRaw: unknown, existing: SaveSlots): SaveSlots {
  const migrated = migrate(legacyRaw);
  if (!migrated) return existing;
  const key = slotKey(migrated.character.name);
  if (existing[key]) return existing;
  return { ...existing, [key]: migrated };
}

/**
 * Load-time pipeline: validate, roll the day over, and report what happened.
 * Idempotent — calling it twice on the same day changes nothing.
 */
export interface LoadResult {
  save: SaveFile;
  rolled: boolean;
  interest: number;
  today: string;
}

export function loadSave(raw: unknown, now: number = Date.now()): LoadResult | null {
  const migrated = migrate(raw);
  if (!migrated) return null;

  const rollover = rolloverDay(migrated.character, now);
  const save: SaveFile = {
    ...migrated,
    character: rollover.character,
    residentsProgressedDay: dayKey(now),
  };

  return { save, rolled: rollover.rolled, interest: rollover.interest, today: rollover.today };
}

export function serialize(save: SaveFile): string {
  return JSON.stringify(save);
}
