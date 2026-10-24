import { readFileSync, writeFileSync } from 'node:fs';

const p = 'server/game.ts';
let s = readFileSync(p, 'utf8');

s = s.replaceAll("import('../src/engine/types').CombatLine[]", 'CombatLine[]');
s = s.replaceAll("import('../src/engine/types').CombatLine['tone']", "CombatLine['tone']");

/* Weapon/armor power should reflect the real kit, not a placeholder zero. */
s = s.replace(
  `    weaponPower: 0,
    armorPower: 0,`,
  `    weaponPower: itemById(c.weaponId).power,
    armorPower: itemById(c.armorId).power,`,
);

/* promptFor no longer needs the character. */
s = s.replace('function promptFor(view: flowView, c: Character): Screen[\'prompt\'] {',
  "function promptFor(view: flowView): Screen['prompt'] {");
s = s.replace('prompt: promptFor(view, c),', 'prompt: promptFor(view),');

writeFileSync(p, s);
console.log('game.ts cleaned');
