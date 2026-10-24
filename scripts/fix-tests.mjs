import { readFileSync, writeFileSync } from 'node:fs';

/* Tests exercise the SERVER's engine now. Point them at server/. */
for (const p of ['tests/engine.spec.ts', 'tests/playthrough.spec.ts']) {
  let s = readFileSync(p, 'utf8');
  s = s.replaceAll("from '../src/engine/", "from '../server/engine/");
  s = s.replaceAll("from '../src/content/", "from '../server/content/");
  s = s.replaceAll("from '../src/state/flow'", "from '../server/flow'");
  writeFileSync(p, s);
}

console.log('tests repointed at the server engine');
