#!/usr/bin/env node
/**
 * test-codice.mjs — regola `codice:<glob>` di mr.claims.ignore (MR 0.6-m).
 *
 * Repo di prova con una copia di riferimento di un altro progetto in `ref/` (come
 * `input-reference/` di dashboard-b): stessi nomi di file, funzioni che nel codice vero non ci
 * sono, una migration. Senza la regola la copia inquina claim, suggest-links, impact e coverage;
 * con `codice:ref/*` sparisce da tutti e quattro. Un path citato per intero resta trovato.
 *
 * Invocazione: node tools/mr/test-codice.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { encoding: 'utf-8' });
}
function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [MR, ...args], { cwd, encoding: 'utf-8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
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

console.log('\ntest-codice.mjs\n');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-codice-')));
execFileSync('git', ['init', '-q', root]);
write(root, 'src/lib/hubspot.server.ts', 'export function valore(d) {\n  return d.amount;\n}\n');
write(root, 'ref/src/lib/hubspot.server.ts', 'export function buildConversions() {\n  return 1;\n}\nconst solo_nel_riferimento = 1;\n');
write(root, 'ref/supabase/migrations/001_vecchia.sql', 'create table x (id int);\n');
write(root, 'ref/README.md', '# Progetto d\'origine\n\nLa logica sta in `hubspot.server.ts` e `routeTree.gen.ts`.\n');
write(root, 'db/migrations/001_init.sql', 'create table y (id int);\n');
const DOC = [
  '# Dashboard', '',
  '## Metriche', '',
  'Il valore si calcola in `hubspot.server.ts` con `valore()`.', '',
  '## Origine', '',
  'Nel progetto di partenza c\'era `buildConversions()` e `solo_nel_riferimento`; il file completo è `ref/src/lib/hubspot.server.ts`.',
  'La migration `001_init` crea la tabella.', '',
].join('\n');
write(root, 'docs/dashboard.md', DOC);
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'primo');

const claims = () => Object.fromEntries(JSON.parse(run(root, 'claims', 'docs/dashboard.md', '--format', 'json', '--all').out).claims.map((c) => [c.claim, `${c.status}/${c.method}`]));
const suggest = () => JSON.parse(run(root, 'suggest-links', 'docs/dashboard.md', '--format', 'json').out).docs.flatMap((d) => d.proposals);

let before;
test('senza la regola: la copia di riferimento conta come codice (lo stato di partenza)', () => {
  before = claims();
  assert(before['buildConversions()'] === 'found/definition' && before.solo_nel_riferimento?.startsWith('found'), JSON.stringify(before));
  assert(suggest().some((p) => p.path.startsWith('ref/')), 'attese proposte verso ref/');
});

write(root, 'mr.claims.ignore', '# copia di riferimento del progetto d\'origine\ncodice:ref/*\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'regola codice');

test('claim: con codice:ref/* i nomi che vivono solo in ref/ non sono più trovati; il path intero sì', () => {
  const a = claims();
  assert(a['buildConversions()'] === 'not_found/definition', `buildConversions: ${a['buildConversions()']}`);
  assert(a.solo_nel_riferimento === 'not_found/word', `solo_nel_riferimento: ${a.solo_nel_riferimento}`);
  assert(a['ref/src/lib/hubspot.server.ts'] === 'found/exists', `path intero: ${a['ref/src/lib/hubspot.server.ts']}`);
  assert(a['hubspot.server.ts'] === 'found/basename' && a['valore()'] === 'found/definition', JSON.stringify(a));
});

test('suggest-links: nessuna proposta verso ref/', () => {
  const ps = suggest();
  assert(ps.length > 0 && !ps.some((p) => p.path.startsWith('ref/')), JSON.stringify(ps.map((p) => p.path)));
});

test('impact: il nome del file torna unico (il doc viene preso); un commit solo in ref/ non chiede verifiche', () => {
  write(root, 'src/lib/hubspot.server.ts', 'export function valore(d) {\n  return d.importoTotale || d.amount;\n}\n');
  git(root, 'commit', '-q', '-am', 'valore da importo');
  const a = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  assert(a.items.some((i) => i.doc === 'docs/dashboard.md' && i.ref === 'hubspot.server.ts'), `doc non preso:\n${JSON.stringify(a.items)}`);
  assert(!a.items.some((i) => i.doc.startsWith('ref/')), `i doc della copia esclusa non vanno in lista:\n${JSON.stringify(a.items.map((i) => i.doc))}`);
  write(root, 'ref/src/lib/hubspot.server.ts', 'export function buildConversions() {\n  return 2;\n}\n');
  git(root, 'commit', '-q', '-am', 'tocca solo il riferimento');
  const b = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  assert(b.items.length === 0 && b.touched_excluded_code === 1, `atteso 0 doc e 1 file escluso: ${JSON.stringify({ items: b.items, ex: b.touched_excluded_code })}`);
});

test('claims su tutto il repo: i doc dentro ref/ non si controllano', () => {
  const r = JSON.parse(run(root, 'claims', '.', '--format', 'json', '--all').out);
  assert(!r.claims.some((c) => c.doc.startsWith('ref/')), JSON.stringify([...new Set(r.claims.map((c) => c.doc))]));
});

test('coverage: la migration della copia non è un punto d\'ingresso', () => {
  const c = JSON.parse(run(root, 'coverage', '.', '--format', 'json').out);
  const mig = c.entries.filter((e) => e.kind === 'migration').map((e) => e.path);
  assert(mig.length === 1 && mig[0] === 'db/migrations/001_init.sql', JSON.stringify(mig));
});

test('impact (0.6-o): simbolo a livello occorrenze — conta la sua riga, non l\'intervallo fino agli altri nomi', () => {
  // PRIMA_VAR compare sopra e sotto la riga che cambierà (come APP_URL in auth.server.ts)
  write(root, 'src/env.ts', ['const a = process.env.PRIMA_VAR;', 'const b = process.env.SECONDA_VAR;', 'const mancanti = [!a && "PRIMA_VAR"];', ''].join('\n'));
  write(root, 'docs/env.md', '# Env\n\n<!-- mr:code path=src/env.ts symbol=PRIMA_VAR -->\n<!-- mr:code path=src/env.ts symbol=SECONDA_VAR -->\nLe variabili.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'env');
  // cambia solo la riga di SECONDA_VAR, che sta tra le due ancore
  write(root, 'src/env.ts', ['const a = process.env.PRIMA_VAR;', 'const b = process.env.SECONDA_VAR ?? "x";', 'const mancanti = [!a && "PRIMA_VAR"];', ''].join('\n'));
  git(root, 'commit', '-q', '-am', 'cambia seconda');
  const r = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const reason = (sym) => r.items.find((i) => i.doc === 'docs/env.md' && i.ref === `src/env.ts#${sym}`)?.reason;
  assert(reason('SECONDA_VAR') === 'simbolo del link toccato', `SECONDA_VAR: ${reason('SECONDA_VAR')}`);
  assert(reason('PRIMA_VAR') === 'file del link toccato (simbolo no)', `PRIMA_VAR (righe 1 e 3, cambiata la 2): ${reason('PRIMA_VAR')}`);
});

test('impact (0.6-q): funzione TS con tipo di ritorno a oggetto — una riga del corpo è il simbolo, non solo la firma', () => {
  // come verificaIdToken e requireAuth in auth.server.ts di dashboard-b
  const corpo = (v) => [
    'export async function verifica(token: string): Promise<{ email: string; name: string | null }> {',
    '  const dati = await leggi(token);',
    `  return { email: dati.email, name: ${v} };`,
    '}',
    'export const requireAuth = createMiddleware().server(async ({ next }) => {',
    '  return next();',
    '});',
    '',
  ].join('\n');
  write(root, 'src/token.ts', corpo('dati.name'));
  write(root, 'docs/token.md', '# Token\n\n<!-- mr:code path=src/token.ts symbol=verifica -->\n<!-- mr:code path=src/token.ts symbol=requireAuth -->\nLa verifica.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'token');
  write(root, 'src/token.ts', corpo('dati.name ?? null'));
  git(root, 'commit', '-q', '-am', 'cambia il corpo di verifica');
  const r = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const reason = (sym) => r.items.find((i) => i.doc === 'docs/token.md' && i.ref === `src/token.ts#${sym}`)?.reason;
  assert(reason('verifica') === 'simbolo del link toccato', `verifica (cambiata la riga 3): ${reason('verifica')}`);
  assert(reason('requireAuth') === 'file del link toccato (simbolo no)', `requireAuth: ${reason('requireAuth')}`);
});

test('output (0.6-t): impact e scan mettono le ancore in testa, con il conteggio; i claim sotto', () => {
  write(root, 'docs/note.md', '# Note\n\nIl token si legge in `src/token.ts`.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'note');
  write(root, 'src/token.ts', readFileSync(join(root, 'src/token.ts'), 'utf-8').replace('const dati = await leggi(token);', 'const dati = await leggi(token.trim());'));
  git(root, 'commit', '-q', '-am', 'verifica: token senza spazi');
  const md = run(root, 'impact', 'HEAD').out;
  const iA = md.indexOf('## Ancore');
  const iC = md.indexOf('## Claim');
  assert(iA > 0 && iC > iA, `ancore in testa, claim sotto:\n${md}`);
  assert(md.includes('Ancore toccate (simbolo o file ancorato): 1 · file del link toccato, simbolo no: 1'), `conteggio:\n${md}`);
  const anc = md.slice(iA, iC);
  assert(anc.indexOf('#verifica') < anc.indexOf('#requireAuth'), 'prima le ancore toccate, poi «simbolo no»');
  assert(md.slice(iC).includes('docs/note.md') && !anc.includes('docs/note.md'), 'il path citato sta tra i claim');
  const sc = run(root, 'scan', 'docs/token.md', 'docs/note.md').out;
  const iL = sc.indexOf('## Link al codice');
  const iSc = sc.indexOf('## Claim');
  assert(sc.startsWith('# Scan — ') && iL > 0 && iSc > iL && /Link: 2 · .*unverified 2/.test(sc), `scan: link in testa\n${sc}`);
});

test('impact --fail (0.6-t): 1 solo con un\'ancora toccata; i path citati dai claim e «simbolo no» non contano', () => {
  // HEAD: il corpo di verifica (ancorata) è cambiato
  assert(run(root, 'impact', 'HEAD', '--fail').code === 1, 'ancora toccata → 1');
  // file citato solo da un claim (path), nessuna ancora
  write(root, 'src/solo.ts', 'export const uno = 1;\n');
  write(root, 'docs/solo.md', '# Solo\n\nLa costante sta in `src/solo.ts`.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'solo');
  write(root, 'src/solo.ts', 'export const uno = 2;\n');
  git(root, 'commit', '-q', '-am', 'uno = 2');
  const c = run(root, 'impact', 'HEAD', '--fail');
  assert(c.code === 0 && c.out.includes('docs/solo.md'), `solo un path citato: exit ${c.code}, ma resta nel report\n${c.out}`);
  // file ancorato toccato fuori dai simboli: solo «simbolo no» (più il path citato da note.md)
  write(root, 'src/token.ts', readFileSync(join(root, 'src/token.ts'), 'utf-8') + '// nota in fondo\n');
  git(root, 'commit', '-q', '-am', 'nota in fondo');
  const d = run(root, 'impact', 'HEAD', '--fail');
  assert(d.code === 0 && d.out.includes('simbolo no'), `solo «simbolo no»: exit ${d.code}\n${d.out}`);
  assert(run(root, 'impact', 'HEAD~3', '--fail').code === 1, 'di nuovo il commit con l\'ancora toccata → 1');
});

test('impact (0.6-u): storico:<glob> di mr.claims.ignore vale anche per impact (solo informativo, niente --fail)', () => {
  write(root, 'docs/backlog-modifiche-02-10.md', '# Backlog\n\n<!-- mr:code path=src/solo.ts livello=file -->\nIl valore sta in `src/solo.ts`.\n');
  write(root, 'mr.claims.ignore', readFileSync(join(root, 'mr.claims.ignore'), 'utf-8') + 'storico:docs/backlog-*\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'backlog');
  write(root, 'src/solo.ts', 'export const uno = 3;\n');
  git(root, 'commit', '-q', '-am', 'uno = 3');
  const j = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const b = j.items.filter((i) => i.doc === 'docs/backlog-modifiche-02-10.md');
  assert(b.length && b.every((i) => i.historical), `il doc storico: va marcato historical\n${JSON.stringify(b)}`);
  assert(run(root, 'impact', 'HEAD', '--fail').code === 0, 'l\'ancora in un doc storico non fa uscire 1');
  assert(!run(root, 'impact', 'HEAD').out.includes('| `docs/backlog-modifiche-02-10.md`'), 'il doc storico non sta nelle tabelle');
});

test('impact (0.6-u): package.json e package-lock.json con il solo numero di versione non contano; le dipendenze sì', () => {
  const pkg = (v, dep) => JSON.stringify({ name: 'app', version: v, private: true, dependencies: { zod: dep } }, null, 2) + '\n';
  const lock = (v, dep) => JSON.stringify({ name: 'app', version: v, lockfileVersion: 3, requires: true, packages: { '': { name: 'app', version: v, dependencies: { zod: dep } }, 'node_modules/zod': { version: dep.replace('^', ''), license: 'MIT' } } }, null, 2) + '\n';
  write(root, 'package.json', pkg('0.15.1', '^3.23.0'));
  write(root, 'package-lock.json', lock('0.15.1', '^3.23.0'));
  write(root, 'docs/deploy.md', '# Deploy\n\nAlza la versione in `package.json` e `package-lock.json`, poi il tag.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'pacchetto');
  write(root, 'package.json', pkg('0.15.2', '^3.23.0'));
  write(root, 'package-lock.json', lock('0.15.2', '^3.23.0'));
  git(root, 'commit', '-q', '-am', 'versione 0.15.2');
  const a = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  assert(!a.items.some((i) => i.doc === 'docs/deploy.md') && a.touched_version_only === 2, `solo versione: ${JSON.stringify({ items: a.items, vo: a.touched_version_only })}`);
  assert(run(root, 'impact', 'HEAD').out.includes('Non contati: 2 file con il solo numero di versione'), 'il report lo dice');
  // aggiornamento di una dipendenza: in package.json e nel lock (packages["node_modules/zod"]) → cambio vero
  write(root, 'package.json', pkg('0.15.2', '^3.24.0'));
  write(root, 'package-lock.json', lock('0.15.2', '^3.24.0'));
  git(root, 'commit', '-q', '-am', 'zod 3.24');
  const b = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const hit = b.items.filter((i) => i.doc === 'docs/deploy.md').map((i) => i.ref).sort();
  assert(JSON.stringify(hit) === JSON.stringify(['package-lock.json', 'package.json']) && !b.touched_version_only, `dipendenza: ${JSON.stringify({ hit, vo: b.touched_version_only })}`);
  // versione del pacchetto e una dipendenza insieme: il file conta
  write(root, 'package.json', pkg('0.15.3', '^3.25.0'));
  git(root, 'commit', '-q', '-am', 'versione e dipendenza');
  const c = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  assert(c.items.some((i) => i.doc === 'docs/deploy.md' && i.ref === 'package.json'), 'versione + dipendenza: conta');
  // nel lock cambia solo la "version" di una dipendenza (stesso rientro di packages[""]): conta
  write(root, 'package-lock.json', readFileSync(join(root, 'package-lock.json'), 'utf-8').replace('"version": "3.24.0"', '"version": "3.24.1"'));
  git(root, 'commit', '-q', '-am', 'zod 3.24.1 nel lock');
  const d = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  assert(d.items.some((i) => i.doc === 'docs/deploy.md' && i.ref === 'package-lock.json') && !d.touched_version_only, `versione di una dipendenza nel lock: ${JSON.stringify(d.items)}`);
});

test('impact (0.6-u): colonna «Testo» con la riga del doc, accorciata, con email e segreti oscurati', () => {
  const lunga = 'La procedura di rilascio alza la versione in `src/solo.ts` e poi ' + 'continua a spiegare i passi uno per uno '.repeat(6);
  write(root, 'docs/testo.md', ['# Testo', '', lunga, '', 'Scrivi a nome.cognome@example.com se `src/solo.ts` non parte.', '', 'Per provare: `src/solo.ts` con password: hunter.', ''].join('\n'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'testo');
  write(root, 'src/solo.ts', 'export const uno = 4;\n');
  git(root, 'commit', '-q', '-am', 'uno = 4');
  const j = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const t = Object.fromEntries(j.items.filter((i) => i.doc === 'docs/testo.md').map((i) => [i.line, i.text]));
  assert(t[3] && t[3].length <= 120 && t[3].endsWith('…') && t[3].startsWith('La procedura di rilascio'), `riga lunga: ${t[3]}`);
  assert(t[5] && t[5].includes('[email]') && !t[5].includes('@example.com'), `email: ${t[5]}`);
  assert(t[7] && t[7].includes('[riga omessa: possibile segreto]') && !t[7].includes('hunter'), `segreto: ${t[7]}`);
  const md = run(root, 'impact', 'HEAD').out;
  assert(md.includes('| Riga | Testo | Sezione |') && md.includes('[email]'), md);
});

test('impact (0.6-u): un path dentro un comando tra backtick conta come path citato (rigioco di onboarding-c)', () => {
  write(root, 'ops/ci-command.sh', '#!/bin/sh\nREMOTA=ghcr.io/vecchio/app\n');
  write(root, 'docs/pubblica.md', ['# Pubblica', '', 'La VPS esegue `ops/ci-command.sh deploy <ver>` e carica.', '', 'Copia viva: `scp ops/ci-command.sh utente@vps:/srv/app/ops/`.', '', 'Niente qui: `docker compose up -d`.', '', '```', 'ops/ci-command.sh   script del deploy (albero dei file)', '```', ''].join('\n'));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'ci');
  write(root, 'ops/ci-command.sh', '#!/bin/sh\nREMOTA=ghcr.io/nuovo/app\n');
  git(root, 'commit', '-q', '-am', 'remota');
  const j = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const p = j.items.filter((i) => i.doc === 'docs/pubblica.md');
  assert(p.length === 2 && p.every((i) => i.reason === 'path citato in un comando: file toccato' && i.ref === 'ops/ci-command.sh') && p.map((i) => i.line).join(',') === '3,5', JSON.stringify(p));
  assert(run(root, 'impact', 'HEAD', '--fail').code === 0, 'resta un claim: non cambia --fail');
});

test('impact (0.6-u): funzione TS con tipo di ritorno a oggetto scritto per esteso — il corpo è il simbolo', () => {
  // come scegliStudente e percorsiPerLaRegola in src/proposta.ts di onboarding-c
  const corpo = (v) => [
    'export function scegli<T>(contatti: readonly A<T>[]): { scelto: A<T>; trovato: boolean } {',
    '  const primo = contatti[0];',
    `  return { scelto: primo, trovato: ${v} };`,
    '}',
    'export function altra(): { n: number } | null {',
    '  return null;',
    '}',
    '',
  ].join('\n');
  write(root, 'src/scelta.ts', corpo('true'));
  write(root, 'docs/scelta.md', '# Scelta\n\n<!-- mr:code path=src/scelta.ts symbol=scegli -->\n<!-- mr:code path=src/scelta.ts symbol=altra -->\nChi è lo studente.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'scelta');
  write(root, 'src/scelta.ts', corpo('Boolean(primo)'));
  git(root, 'commit', '-q', '-am', 'trovato solo se c\'è');
  const r = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const reason = (sym) => r.items.find((i) => i.doc === 'docs/scelta.md' && i.ref === `src/scelta.ts#${sym}`)?.reason;
  assert(reason('scegli') === 'simbolo del link toccato', `scegli (cambiata la riga 3): ${reason('scegli')}`);
  assert(reason('altra') === 'file del link toccato (simbolo no)', `altra: ${reason('altra')}`);
});

test('impact (0.6-w): un nome conta solo se cambia proprio lui nel diff, non se sta in una riga cambiata per altro', () => {
  // come DEAL_PROPS in ordini (52ba40a): una property in più nella stessa riga
  write(root, 'src/sync.ts', 'const DEAL_PROPS = ["stato_pagamenti", "fonte_vip", "owner_id"];\nexport const ENDPOINT = "/api/deals";\n');
  write(root, 'docs/sync.md', '# Sync\n\nLo stato sta in `stato_pagamenti`; il flag è `fonte_vip`; la nuova `rata_chiusa` arriva dopo.\n\nL\'API è `GET /api/deals`.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'sync');
  write(root, 'src/sync.ts', 'const DEAL_PROPS = ["stato_pagamenti", "fonte_vip", "owner_id", "rata_chiusa"];\nexport const ENDPOINT = "/api/deals";\n');
  git(root, 'commit', '-q', '-am', 'rata_chiusa');
  const j = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const refs = j.items.filter((i) => i.doc === 'docs/sync.md').map((i) => i.ref).sort();
  assert(JSON.stringify(refs) === JSON.stringify(['rata_chiusa']), `solo il nome aggiunto: ${JSON.stringify(refs)}`);
  // il nome tolto conta
  write(root, 'src/sync.ts', 'const DEAL_PROPS = ["stato_pagamenti", "owner_id", "rata_chiusa"];\nexport const ENDPOINT = "/api/deals";\n');
  git(root, 'commit', '-q', '-am', 'via fonte_vip');
  const k = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  // tolto fonte_vip: conta lui, e il nome subito accanto alla modifica (stato_pagamenti); owner_id no
  assert(JSON.stringify(k.items.filter((i) => i.doc === 'docs/sync.md').map((i) => i.ref).sort()) === JSON.stringify(['fonte_vip', 'stato_pagamenti']), JSON.stringify(k.items));
  // il nome accanto a un token cambiato conta (onboarding-c 84c1899: la condizione su aggiornata_il)
  write(root, 'src/db.ts', "const q = sql`select id from righe where stato = 'eccezione' and aggiornata_il < now()`;\n");
  write(root, 'docs/db.md', '# Db\n\nSi rileggono le righe in eccezione con `aggiornata_il` vecchio di un\'ora.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'db');
  write(root, 'src/db.ts', "const q = sql`select id from righe where aggiornata_il < now()`;\n");
  git(root, 'commit', '-q', '-am', 'tutte le righe');
  const m = JSON.parse(run(root, 'impact', 'HEAD', '--format', 'json').out);
  const r2 = m.items.filter((i) => i.doc === 'docs/db.md').map((i) => i.ref).sort();
  assert(JSON.stringify(r2) === JSON.stringify(['aggiornata_il']), `vicino alla modifica: ${JSON.stringify(r2)}`);
});

rmSync(root, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
