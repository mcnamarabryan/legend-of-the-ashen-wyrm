/**
 * The six resident adventurers.
 *
 * They are ordinary Character records — nothing in combat or PvP
 * special-cases them. The README is explicit that they are simulated,
 * and the UI marks them with a dim "[resident]" tag. We do not pretend.
 */

export interface ResidentSeed {
  name: string;
  sex: 'm' | 'f';
  class: 'warrior' | 'magician' | 'thief';
  bio: string;
  /** 0–1. Higher means the resident spends more turns picking fights. */
  aggression: number;
  /** Flavor for who they are; drives nothing mechanically. */
  level: number;
}

export const residentSeeds: ResidentSeed[] = [
  {
    name: 'Grimwold',
    sex: 'm',
    class: 'warrior',
    bio: 'Grimwold the Unshod. Lost his boots to a bet. Won the bet.',
    aggression: 0.95,
    level: 3,
  },
  {
    name: 'Sable',
    sex: 'f',
    class: 'thief',
    bio: 'Sable. Knew your purse before she knew your name.',
    aggression: 0.75,
    level: 4,
  },
  {
    name: 'Orin',
    sex: 'm',
    class: 'magician',
    bio: 'Orin of the Low Tower. Reads by candlelight. Burns things by it too.',
    aggression: 0.6,
    level: 2,
  },
  {
    name: 'Halvard',
    sex: 'm',
    class: 'warrior',
    bio: 'Halvard the Patient. Has been level four for a year. Unbothered.',
    aggression: 0.5,
    level: 4,
  },
  {
    name: 'Juniper',
    sex: 'f',
    class: 'magician',
    bio: 'Juniper. Sells charms by day, uses them by night.',
    aggression: 0.65,
    level: 5,
  },
  {
    name: 'Coel',
    sex: 'm',
    class: 'thief',
    bio: 'Coel. Never carries coin. Somehow always has coin.',
    aggression: 0.85,
    level: 6,
  },
];

/** Bots need a stable id-ish identity for the realm feed. */
export function residentTag(name: string): string {
  return `{dim}${name} [resident]{/}`;
}
