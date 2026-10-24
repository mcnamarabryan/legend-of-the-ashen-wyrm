import type { Rng } from './types';

export type { Rng };

/**
 * mulberry32 — small, fast, deterministic. Seeded from crypto where available
 * so each session differs, with an override for reproducible tests.
 *
 * Engine code NEVER calls Math.random(); the RNG is always injected.
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const buf = new Uint32Array(1);
    globalThis.crypto.getRandomValues(buf);
    return buf[0];
  }
  return Date.now() & 0xffffffff;
}

export function createRng(seed?: number): Rng {
  return mulberry32(seed ?? randomSeed());
}

/** Integer in [min, max], inclusive. */
export function randInt(rng: Rng, min: number, max: number): number {
  if (max < min) return min;
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: Rng, list: readonly T[]): T {
  if (list.length === 0) throw new Error('pick() called on an empty list');
  return list[Math.floor(rng() * list.length)];
}

export function chance(rng: Rng, probability: number): boolean {
  return rng() < probability;
}

/** Weighted pick. Weights must be positive. */
export function weightedPick<T>(rng: Rng, entries: readonly { value: T; weight: number }[]): T {
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = rng() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}
