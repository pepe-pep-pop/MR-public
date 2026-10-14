#!/usr/bin/env node
/**
 * test-giro-salute.mjs — sezione «Salute dei doc» del giro (MR 0.6-x).
 *
 * Workspace di prova con doc vivi con e senza frontmatter MR, e un handoff (storico per path) con
 * frontmatter. Controlla: copertura (vivi, con frontmatter, senza), problemi del profilo light (campi
 * mancanti, id duplicato, superseded senza successore, riferimenti a id che non esistono, doc vecchi),
 * riferimenti risolti anche verso un doc storico per path, conteggio a parte (--precisione invariato),
 * doc da aggiornare con `review_needed` (0.6-z): conteggio e lista per repo, non un problema.
 *
 * Invocazione: node tools/mr/test-giro-salute.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precisione } from './giro.mjs';
import { saluteDocs } from './lib/salute.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GIRO = join(here, 'giro.mjs');
function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}
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
const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n\n# Doc\n`;
const oggi = new Date().toISOString().slice(0, 10);
const base = { mr_version: '"0.6"', title: 'T', type: 'guide', owner: 'app', created: oggi, last_updated: oggi };

console.log('\ntest-giro-salute.mjs\n');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-giro-salute-')));
const app = join(root, 'ws', 'app');
write(app, 'src/a.ts', 'export const a = 1;\n');
write(app, 'docs/ok.md', fm({ ...base, id: 'app/ok', status: 'active', depends_on: '[{ id: app/hof-1 }]', review_needed: '"elenco fermo a 52 funzioni, oggi 93"' }));
write(app, 'docs/manca.md', fm({ id: 'app/manca', type: 'guide', status: 'active' }));
write(app, 'docs/doppio.md', fm({ ...base, id: 'app/ok', status: 'active' }));
write(app, 'docs/superato.md', fm({ ...base, id: 'app/superato', status: 'superseded', review_needed: '"non conta, doc storico"' }));
write(app, 'docs/rotto.md', fm({ ...base, id: 'app/rotto', status: 'active', depends_on: '[{ id: app/non-esiste }]' }));
write(app, 'docs/vecchio.md', fm({ ...base, id: 'app/vecchio', status: 'active', last_updated: '2025-01-01' }));
write(app, 'docs/senza.md', '# Senza frontmatter\n\nNiente.\n');
// 0.6-z3: titolo di portale-b senza virgolette, il frontmatter non si legge
write(app, 'docs/illeggibile.md', fm({ ...base, id: 'app/illeggibile', status: 'active', title: 'Runbook — Bivio pool quiz Prodotto: opzione A (volume) vs B (qualità)' }));
write(app, 'docs/hof-app-1.md', fm({ ...base, id: 'app/hof-1', type: 'report', status: 'superseded', superseded_by: 'app/ok' }));
execFileSync('git', ['init', '-q', app]);
execFileSync('git', ['-C', app, 'add', '-A']);
execFileSync('git', ['-C', app, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'doc']);
const indice = join(root, 'indice.md');
writeFileSync(indice, ['# Indice', '', '| Slug | Gruppo | Path | Nota |', '|---|---|---|---|', `| \`ws\` | software | \`${join(root, 'ws')}\` | — |`, ''].join('\n'));
const r = spawnSync(process.execPath, [GIRO, '--indice', indice, '--senza-pr'], { encoding: 'utf-8', cwd: root });
const out = r.stdout;
const iSez = out.indexOf('## Salute dei doc');
const sez = out.slice(iSez, out.indexOf('\n## ', iSez + 5));

test('la sezione c\'è, dopo le ancore e prima dell\'appendice, con la riga in testa al report', () => {
  assert(r.status === 0, r.stderr);
  assert(iSez > out.indexOf('## Ancore in deriva') && out.indexOf('## Appendice') > iSez, 'ordine delle sezioni');
  assert(/Salute dei doc \(conteggio a parte, sezione «Salute dei doc»\): 7 doc vivi su 8 con frontmatter MR, in 1 repo su 1; da aggiornare \(review_needed\): 1\./.test(out), out.split('\n').slice(0, 8).join('\n'));
});

test('copertura: 8 doc vivi, 7 con frontmatter (anche quello rotto), 1 senza; l\'handoff conta a parte', () => {
  assert(/\| ws \| app \| 8 \| 7 \(\+1 storici\) \| 1 \| 1 \| 1 \| \d+ \|/.test(sez), sez);
});

test('problemi: campi mancanti, id duplicato, superseded senza successore, riferimento rotto, doc vecchio', () => {
  const has = (re) => re.test(sez);
  assert(has(/docs\/manca\.md: campi mancanti: mr_version, title, owner, created, last_updated/), 'campi mancanti');
  assert(has(/docs\/(doppio|ok)\.md: id `app\/ok` già usato da `docs\/(ok|doppio)\.md`/), 'id duplicato');
  assert(has(/docs\/superato\.md: `status: superseded` senza `superseded_by`/), 'superseded senza successore');
  assert(has(/docs\/rotto\.md: `depends_on` verso un id che non esiste in nessun repo letto: `app\/non-esiste`/), 'riferimento rotto');
  assert(has(/docs\/vecchio\.md: vecchio: \d+ giorni.*→ rileggi; se è ancora vero `mr rivisto docs\/vecchio\.md --write`/), 'doc vecchio, con l\'azione (0.6-y)');
});

test('riferimenti verso un doc storico per path risolti; un doc storico per stato non è «vecchio»', () => {
  assert(!/docs\/ok\.md: `depends_on`/.test(sez), 'depends_on verso app/hof-1 (handoff) è risolto');
  assert(!/hof-app-1\.md: (vecchio|`superseded_by`)/.test(sez), 'l\'handoff superato punta a un id che esiste e non è vecchio');
});

test('conteggio a parte: le segnalazioni e --precisione non cambiano', () => {
  assert(/segnalazioni: 0 · affermazioni con prova di deriva: 0\./.test(out), 'nessuna segnalazione');
  assert(precisione([out]).prodotte === 0, 'precisione legge solo il riepilogo');
});

test('da aggiornare (0.6-z): review_needed contato e in lista col motivo, non tra i problemi; un doc storico no', () => {
  assert(/da aggiornare \(review_needed\): 1 ·/.test(sez), 'conteggio nella riga della sezione');
  assert(/Da aggiornare \(review_needed\), per repo:\n\n- ws\/app\/docs\/ok\.md: elenco fermo a 52 funzioni, oggi 93/.test(sez), sez);
  assert(!/superato\.md: non conta, doc storico/.test(sez), 'review_needed di un doc superseded non conta');
  assert(!/ok\.md: .*review_needed/.test(sez.slice(sez.indexOf('Problemi nei doc'))), 'non è un problema');
});

test('frontmatter non leggibile (0.6-z3): conta tra quelli con frontmatter, con il problema e la riga', () => {
  assert(/docs\/illeggibile\.md: frontmatter non leggibile \(riga 3: Nested mappings are not allowed in compact mappings\)/.test(sez), sez);
});

test('saluteDocs: senza doc', () => {
  const s = saluteDocs([], oggi);
  assert(s.vivi === 0 && s.taggati === 0 && s.problemi.length === 0, JSON.stringify(s));
});

rmSync(root, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
