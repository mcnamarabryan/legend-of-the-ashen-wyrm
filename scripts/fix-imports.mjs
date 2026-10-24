import { readFileSync, writeFileSync } from 'node:fs';

const files = [
  'server/flow.ts',
  'server/game.ts',
  'server/engine/save.ts',
  'server/engine/pvp.ts',
  'server/engine/creation.ts',
  'server/engine/dragon.ts',
  'server/engine/encounters.ts',
  'server/engine/combat.ts',
  'server/engine/economy.ts',
  'server/engine/progression.ts',
];

for (const p of files) {
  let s;
  try {
    s = readFileSync(p, 'utf8');
  } catch {
    continue;
  }

  /* Imports that pointed at the old client tree. */
  s = s.replaceAll("from '../engine/", "from './engine/");
  s = s.replaceAll("from '../content/", "from './content/");
  s = s.replaceAll("from './engine/engine/", "from './engine/");
  s = s.replaceAll("from './content/content/", "from './content/");

  /* Engine files live one level deeper now: server/engine/* */
  if (p.startsWith('server/engine/')) {
    s = s.replaceAll("from './engine/", "from './");
    s = s.replaceAll("from '../content/", "from '../content/");
    s = s.replaceAll("from './content/", "from '../content/");
  }

  /* Server files live at server/* : engine and content are siblings. */
  if (p === 'server/flow.ts' || p === 'server/game.ts') {
    s = s.replaceAll("from '../engine/", "from './engine/");
    s = s.replaceAll("from '../content/", "from './content/");
    s = s.replaceAll("from '../src/engine/", "from './engine/");
    s = s.replaceAll("from '../src/content/", "from './content/");
  }

  writeFileSync(p, s);
}

console.log('imports rewritten');
