/**
 * PROOF that combat sounds follow the kit.
 *
 * The whole point of the loadout-aware combat sounds is that a war hammer and a
 * rusty dagger do not make the same noise. That is easy to claim and easy to get
 * wrong: a typo in one id in the mapping silently falls back to the generic
 * sword, and the game still sounds fine — just undifferentiated.
 *
 * So this asserts the mapping explicitly, item by item, against the real item
 * ids the server ships.
 *
 *   npx tsx scripts/loadout-diag.ts
 */

import { profileFromLoadout, soundsForBatch, baseOf } from '../src/audio/cues';
import { DESIGNS, SOUND_NAMES } from '../src/audio/catalogue';
import { weapons, armors } from '../server/content/items';

let failures = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A hit line as the server words it. */
const HIT = [{ id: 1, text: 'Your blade finds its mark. {bright}12{/} damage.' }];
const CRIT = [{ id: 1, text: '{bright}A critical blow!{/} 24 damage.' }];
const HURT = [{ id: 1, text: 'It hits you. {red}9{/} damage.', tone: 'red' as const }];

function main(): void {
  console.log('\n  loadout → combat sound\n');

  /* ---- every weapon maps to an actual design ------------------- */
  console.log('  weapons:');
  for (const w of weapons) {
    const p = profileFromLoadout(w.id, 'rags');
    const hit = soundsForBatch(HIT, p)[0];
    const crit = soundsForBatch(CRIT, p)[0];

    const hitOk = hit !== undefined && DESIGNS[hit] !== undefined;
    const critOk = crit !== undefined && DESIGNS[crit] !== undefined;

    console.log(
      `    ${hitOk && critOk ? 'ok  ' : 'FAIL'} ${w.name.padEnd(18)} ` +
        `${p.weapon.padEnd(8)} ${String(hit).padEnd(13)} ${crit}`,
    );
    if (!hitOk || !critOk) failures += 1;
  }

  /* ---- every armour maps to an actual design ------------------ */
  console.log('\n  armour:');
  for (const a of armors) {
    const p = profileFromLoadout('short-sword', a.id);
    const hurt = soundsForBatch(HURT, p)[0];

    const ok = hurt !== undefined && DESIGNS[hurt] !== undefined;
    console.log(
      `    ${ok ? 'ok  ' : 'FAIL'} ${a.name.padEnd(18)} ${p.armor.padEnd(8)} ${hurt}`,
    );
    if (!ok) failures += 1;
  }

  /* ---- the families are genuinely distinct -------------------- */
  console.log('\n  distinctness:');
  const familyOf = (weaponId: string, armorId: string) =>
    soundsForBatch(HIT, profileFromLoadout(weaponId, armorId))[0];

  const dagger = familyOf('rusty-dagger', 'rags');
  const hammer = familyOf('war-hammer', 'rags');
  const axe = familyOf('hand-axe', 'rags');
  const sword = familyOf('long-sword', 'rags');

  check('a dagger does not sound like a sword', dagger !== sword, `${dagger} vs ${sword}`);
  check('a hammer does not sound like a sword', hammer !== sword, `${hammer} vs ${sword}`);
  check('an axe does not sound like a sword', axe !== sword, `${axe} vs ${sword}`);
  check(
    'all four weapon families are distinct',
    new Set([dagger, hammer, axe, sword]).size === 4,
    [dagger, hammer, axe, sword].join(', '),
  );

  const cloth = soundsForBatch(HURT, profileFromLoadout('short-sword', 'rags'))[0];
  const plate = soundsForBatch(HURT, profileFromLoadout('short-sword', 'plate-mail'))[0];
  const chain = soundsForBatch(HURT, profileFromLoadout('short-sword', 'chain-mail'))[0];
  const leather = soundsForBatch(HURT, profileFromLoadout('short-sword', 'leather'))[0];

  check(
    'all four armour families are distinct',
    new Set([cloth, plate, chain, leather]).size === 4,
    [cloth, plate, chain, leather].join(', '),
  );

  /* ---- base mapping still drives batch priority --------------- */
  check('a blade hit reports as a hit', baseOf('hit-blade') === 'hit');
  check('a plate hurt reports as a hurt', baseOf('hurt-plate') === 'hurt');
  check('a blunt crit reports as a crit', baseOf('crit-blunt') === 'crit');

  /* ---- unknown ids degrade, not crash ------------------------- */
  const unknown = soundsForBatch(HIT, profileFromLoadout('mystery-item', 'mystery-armour'))[0];
  check('an unknown weapon falls back to a blade', unknown === 'hit-blade', String(unknown));

  /* ---- every name referenced actually exists ------------------ */
  const referenced = new Set(
    weapons.map((w) => soundsForBatch(HIT, profileFromLoadout(w.id, 'rags'))[0]),
  );
  for (const name of referenced) {
    check(`"${name}" is in the catalogue`, SOUND_NAMES.includes(name));
  }

  console.log(failures === 0 ? '\n  combat follows the kit.\n' : `\n  ${failures} failed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
