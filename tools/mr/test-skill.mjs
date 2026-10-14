#!/usr/bin/env node
/**
 * test-skill.mjs — controlli sul testo delle skill che dipendono dal comportamento dei comandi (MR 0.6-t).
 *
 * Le skill sono procedure in markdown: qui si controlla che dicano quello che i comandi fanno.
 *   - mr-drift-review: mr-validate solo se il doc ha frontmatter MR, altrimenti lo dice e salta
 *     (prova del 07/10: su un doc di sole ancore rispondeva «Nessun file con header MR trovato»);
 *   - mr-link: le proposte tenute si scrivono con --only (suggest-links senza --only le scrive tutte).
 *
 * Invocazione: node tools/mr/test-skill.mjs   (exit 0 = tutti pass)
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const skills = join(dirname(fileURLToPath(import.meta.url)), '../../.claude/skills');
const read = (n) => readFileSync(join(skills, n, 'SKILL.md'), 'utf-8');
const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.push(false);
    console.log(`  ❌ ${name}\n     ${err.message}`);
  }
}
function assert(c, m) {
  if (!c) throw new Error(m);
}

console.log('\ntest-skill.mjs\n');

test('mr-drift-review: mr-validate solo con frontmatter MR; senza, lo dice e salta', () => {
  const t = read('mr-drift-review');
  const i = t.indexOf('mr-validate.mjs');
  assert(i > 0, 'mr-validate non citato');
  const before = t.slice(Math.max(0, i - 400), i);
  assert(/solo se il doc ha il frontmatter MR/i.test(before), `mr-validate senza la condizione sul frontmatter:\n${before}`);
  assert(/salta il passo/i.test(t) && /Nessun file con header MR trovato/.test(t), 'manca cosa fare senza frontmatter');
});

test('mr-link: le proposte tenute con suggest-links --write --only', () => {
  assert(/suggest-links <doc> --write --only <n,…>/.test(read('mr-link')), 'mr-link non usa --only');
});

test('freschezza (0.6-y): mr-tag e mr-drift-review dicono «rileggi; se è vero mr rivisto --write»', () => {
  for (const n of ['mr-tag', 'mr-drift-review']) {
    const t = read(n);
    assert(/mr\.mjs rivisto <doc> --write/.test(t) && /Mai `rivisto --write` senza aver riletto/.test(t), `${n}: regola di freschezza assente`);
    // review_needed (0.6-z): quando la correzione non si fa subito, e rivisto lo toglie
    assert(/review_needed: "<motivo breve>"/.test(t) && /toglie `review_needed`/.test(t), `${n}: regola di review_needed assente`);
    // lo schema non ha `done` (enum: active, draft, deprecated, superseded, paused)
    assert(!/`done`|status: done/.test(t), `${n}: cita lo stato «done», che lo schema non ammette`);
  }
});

test('date (0.6-z): mr-tag prende le date da mr date, senza i commit di redazione di mr.redazioni', () => {
  const t = read('mr-tag');
  assert(/mr\.mjs date <file\|cartella>/.test(t) && /mr\.redazioni/.test(t), 'mr-tag non usa mr date e mr.redazioni');
  assert(!/git log -1 --format=%as/.test(t), 'mr-tag dice ancora git log -1');
});

test('title tra virgolette (0.6-z3): mr-tag le mette sempre', () => {
  const t = read('mr-tag');
  assert(/title: "<dal titolo # del doc>"/.test(t) && /`title` sempre tra virgolette doppie/.test(t), 'mr-tag non mette il title tra virgolette');
});

const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
