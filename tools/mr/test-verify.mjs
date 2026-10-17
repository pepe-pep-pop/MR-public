#!/usr/bin/env node
/**
 * test-verify.mjs — `mr verify` (R7) e `mr suggest-links` (R8, nota A12), MR v0.6-c.
 *
 * Gli unici comandi che scrivono, e solo con --write e solo nel doc indicato. Controlli:
 * anteprima senza scritture; frontmatter riscritto conservando commenti e stili, hash tra
 * apici, date tolta; ancore aggiornate sulla loro riga; link bloccati (moved, file non
 * committato); sezione singola; _content_hash invariato (nota A2); suggest-links ancorato
 * alla funzione, file intero dichiarato con livello=file; doc storici saltati; codice mai
 * toccato.
 *
 * Invocazione: node tools/mr/test-verify.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBodyForHash } from '../mr-scanner/mr-scanner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const VALIDATE = join(here, '../mr-validate/mr-validate.mjs');

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}
function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf-8' });
}
function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [MR, ...args], { cwd, encoding: 'utf-8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}
const body = (t) => normalizeBodyForHash(t.replace(/^---\n[\s\S]*?\n---\n/, ''));

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\ntest-verify.mjs\n');

const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-verify-test-')));
execFileSync('git', ['init', '-q', root]);
write(root, 'src/lib/fees.ts', 'export function calcolaQuota(i: number) {\n  return i * 2;\n}\n\nexport function altra() {\n  return 1;\n}\n');
write(root, 'src/util.ts', 'export const VERSIONE = 1;\n');
write(root, 'src/old.ts', 'export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
write(root, 'src/server.ts', "const k = Deno.env.get('API_TOKEN');\napp.post('/api/ordini', (c) => {\n  return c.json(k);\n});\n");
write(root, 'sql/001.sql', 'create table public.spedizioni (\n  id int\n);\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'A');
const A = git(root, 'rev-parse', '--short', 'HEAD').trim();

const DOC = `---
mr_version: '0.6'
id: test/verify
title: Doc da verificare   # commento da conservare
type: reference
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
code_refs:
  # link a livello di file, stile a blocchi
  - path: src/util.ts
    verified:
      commit: '${A}'
      date: '2026-10-01'
  - { path: src/lib/fees.ts, symbol: altra }
  - { path: src/old.ts, verified: { commit: '${A}' } }
---

# Doc

## Quote

<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=${A} -->
La quota è il doppio.

## Altro

Testo che non cambia.
`;
write(root, 'docs/doc.md', DOC);
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'doc');

// commit B: cambia calcolaQuota, util.ts; old.ts rinominato
write(root, 'src/lib/fees.ts', 'export function calcolaQuota(i: number) {\n  return i * 3;\n}\n\nexport function altra() {\n  return 1;\n}\n');
write(root, 'src/util.ts', 'export const VERSIONE = 2;\n');
renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'));
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'B');
const B = git(root, 'rev-parse', '--short', 'HEAD').trim();
const BD = git(root, 'show', '-s', '--format=%as', 'HEAD').trim();

test('verify senza --write: anteprima, nessuna scrittura; moved bloccato → exit 1', () => {
  const before = readFileSync(join(root, 'docs/doc.md'), 'utf-8');
  const r = run(root, 'verify', 'docs/doc.md');
  assert(readFileSync(join(root, 'docs/doc.md'), 'utf-8') === before, 'il doc è cambiato senza --write');
  assert(r.code === 1, `exit atteso 1 (un link moved), ottenuto ${r.code}\n${r.err}`);
  assert(r.out.includes('anteprima') && r.out.includes(`verified=${B}`), `anteprima incompleta\n${r.out}`);
  assert(r.out.includes('aggiorna prima il link: ora è in src/new.ts'), 'motivo del blocco moved mancante');
  assert(r.out.includes('```diff') && r.out.includes('return i * 3'), 'diff o codice attuale mancanti');
});

test('verify --write: frontmatter e ancore aggiornati con commit e data (A16), resto identico, hash invariato (A2)', () => {
  const before = readFileSync(join(root, 'docs/doc.md'), 'utf-8');
  const r = run(root, 'verify', 'docs/doc.md', '--write');
  const after = readFileSync(join(root, 'docs/doc.md'), 'utf-8');
  assert(r.code === 1, `exit atteso 1 (moved ancora bloccato), ottenuto ${r.code}`);
  assert(after.includes(`<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=${B} date=${BD} -->`), `ancora non aggiornata:\n${after}`);
  assert(after.includes(`commit: '${B}'`) && after.includes(`date: '${BD}'`), 'commit/date del blocco non aggiornati tra apici');
  assert(!after.includes("date: '2026-10-01'"), 'date vecchia non sostituita');
  assert(after.includes(`{ path: src/lib/fees.ts, symbol: altra, verified: { commit: '${B}', date: '${BD}' } }`), `flow map non aggiornata:\n${after}`);
  assert(after.includes(`{ path: src/old.ts, verified: { commit: '${A}' } }`), 'il link moved non deve cambiare');
  assert(after.includes('# commento da conservare') && after.includes('# link a livello di file, stile a blocchi'), 'commenti persi');
  assert(body(after) === body(before), '_content_hash del corpo cambiato');
  // righe sparite e comparse: solo commit/date del blocco, la flow map, l'ancora
  const bl = before.split('\n');
  const al = after.split('\n');
  const gone = bl.filter((l) => !al.includes(l));
  const added = al.filter((l) => !bl.includes(l));
  assert(gone.length === 4 && added.length === 4, `righe cambiate inattese:\n     - ${gone.join('\n     - ')}\n     + ${added.join('\n     + ')}`);
  assert(after.includes('title: Doc da verificare   # commento da conservare'), 'spazi prima del commento non conservati');
  assert(git(root, 'status', '--porcelain', '--', 'src') === '', 'il codice è stato toccato');
});

test('dopo verify: mr-validate senza errori sugli apici, scan con i link verificati ok', () => {
  const v = spawnSync(process.execPath, [VALIDATE, 'docs/doc.md'], { cwd: root, encoding: 'utf-8' }).stdout;
  assert(!v.includes('tra apici'), `errore sugli apici dopo verify\n${v}`);
  const s = JSON.parse(run(root, 'scan', 'docs/doc.md', '--format', 'json').out);
  const st = (p, sym) => s.refs.find((x) => x.path === p && (x.symbol || null) === (sym || null)).status;
  assert(st('src/lib/fees.ts', 'calcolaQuota') === 'ok' && st('src/lib/fees.ts', 'altra') === 'ok' && st('src/util.ts', null) === 'ok', JSON.stringify(s.refs_summary));
  assert(st('src/old.ts', null) === 'moved', 'il link moved resta moved');
});

test('verify doc.md#sezione: solo i link di quella sezione; file non committato bloccato', () => {
  write(root, 'src/lib/fees.ts', 'export function calcolaQuota(i: number) {\n  return i * 4;\n}\n\nexport function altra() {\n  return 1;\n}\n');
  const r = JSON.parse(run(root, 'verify', 'docs/doc.md#Quote', '--format', 'json').out);
  assert(r.items.length === 1 && r.items[0].ref.symbol === 'calcolaQuota', `link selezionati: ${r.items.length}`);
  assert(r.items[0].blocked === 'modifiche non committate sul file nel repo del codice', JSON.stringify(r.items[0]));
  git(root, 'checkout', '-q', '--', 'src/lib/fees.ts');
});

test('verify: errori d\'uso → exit 2; --write rifiutato dai comandi in sola lettura', () => {
  assert(run(root, 'verify', 'docs/doc.md', 'altro.md').code === 2, 'due doc → 2');
  assert(run(root, 'verify', 'docs/doc.md', '--rev', A).code === 2, '--rev → 2');
  for (const cmd of ['claims', 'scan']) assert(run(root, cmd, 'docs', '--write').code === 2, `${cmd} --write → 2`);
  assert(run(root, 'impact', 'HEAD', '--write').code === 2, 'impact --write → 2');
});

// ── suggest-links ──
const SDOC = `# Guida

## Calcolo

La quota la calcola \`calcolaQuota()\` in \`src/lib/fees.ts\`.

## Funzione altra

Vedi \`src/lib/fees.ts\`: la funzione \`altra\` restituisce 1.

## Costanti

Le costanti stanno in \`src/util.ts\`.

## Server

Il token è \`API_TOKEN\`, la rotta \`POST /api/ordini\`, la tabella \`public.spedizioni\`.

## Già collegata

<!-- mr:code path=src/util.ts livello=file -->
Ancora \`src/util.ts\`.
`;

test('suggest-links: anteprima, ancoraggio alla funzione, file intero dichiarato (A12)', () => {
  write(root, 'docs/guida.md', SDOC);
  write(root, 'docs/_archive/vecchia.md', '# Vecchia\n\nCita `calcolaQuota()`.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'guida');
  const r = JSON.parse(run(root, 'suggest-links', 'docs', '--format', 'json').out);
  assert(readFileSync(join(root, 'docs/guida.md'), 'utf-8') === SDOC, 'scritto senza --write');
  const g = r.docs.find((d) => d.doc === 'docs/guida.md');
  const got = g.proposals.map((p) => `${p.section}|${p.path}|${p.symbol || ''}|${p.level}`).sort();
  const want = [
    '## Calcolo|src/lib/fees.ts|calcolaQuota|funzione',
    '## Costanti|src/util.ts||file',
    '## Funzione altra|src/lib/fees.ts|altra|funzione',
    '## Server|sql/001.sql|spedizioni|funzione',
    '## Server|src/server.ts|API_TOKEN|occorrenze', // 0.6-z5: letto fuori da ogni funzione: occorrenze, non funzione
    '## Server|src/server.ts|POST /api/ordini|funzione',
  ].sort();
  assert(JSON.stringify(got) === JSON.stringify(want), `proposte:\n     ${got.join('\n     ')}`);
  assert(r.docs.some((d) => d.doc === 'docs/_archive/vecchia.md' && d.historical), 'doc storico non saltato');
  const md = run(root, 'suggest-links', 'docs/guida.md').out;
  assert(md.includes('⚠️ file intero') && md.includes('livello=file') && md.includes('nessun simbolo della sezione'), 'il file intero non è dichiarato nel diff');
});

test('suggest-links --write: ancore sotto il titolo, hash invariato, poi scan le vede (unverified)', () => {
  const before = readFileSync(join(root, 'docs/guida.md'), 'utf-8');
  run(root, 'suggest-links', 'docs/guida.md', '--write');
  const after = readFileSync(join(root, 'docs/guida.md'), 'utf-8');
  assert(after.includes('## Calcolo\n<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota -->'), `ancora non sotto il titolo:\n${after}`);
  assert(after.includes('<!-- mr:code path=src/server.ts symbol="POST /api/ordini" -->'), 'simbolo con spazi non quotato');
  assert(body(after) === body(before), '_content_hash cambiato dopo suggest-links');
  const s = JSON.parse(run(root, 'scan', 'docs/guida.md', '--format', 'json').out);
  const nonOk = s.refs.filter((x) => x.status !== 'unverified');
  assert(s.refs.length === 7 && !nonOk.length, `link: ${s.refs.length}, non unverified: ${nonOk.map((x) => x.path + '#' + x.symbol + ':' + x.status)}`);
  const again = JSON.parse(run(root, 'suggest-links', 'docs/guida.md', '--format', 'json').out);
  assert(!again.docs.some((d) => d.proposals?.length), 'proposti di nuovo link già presenti');
  assert(git(root, 'status', '--porcelain', '--', 'src', 'sql') === '', 'il codice è stato toccato');
});

test('A13: file intero solo se il file È la funzione; altrimenti ancoraggio alla funzione', () => {
  write(root, 'supabase/functions/sync-x/index.ts', 'const LIMITE = 5;\nDeno.serve(async (req) => {\n  return new Response(String(LIMITE));\n});\n');
  write(root, 'src/solo.ts', 'const K = 2;\nexport function solo(a: number) {\n  return a * K;\n}\n');
  write(root, 'src/multi.ts', 'export function multi() {\n  return 1;\n}\nexport function altro() {\n  return 2;\n}\n');
  write(root, 'docs/funzioni.md', '# Funzioni\n\n## `sync-x`\n\nSincronizza.\n\n## `solo`\n\nRaddoppia.\n\n## `multi`\n\nRestituisce 1.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'funzioni');
  const r = JSON.parse(run(root, 'suggest-links', 'docs/funzioni.md', '--format', 'json').out);
  const got = r.docs[0].proposals.map((p) => `${p.section}|${p.path}|${p.symbol || ''}|${p.level}`).sort();
  const want = [
    '## `multi`|src/multi.ts|multi|funzione',
    '## `solo`|src/solo.ts||file-funzione',
    '## `sync-x`|supabase/functions/sync-x/index.ts||file-funzione',
  ];
  assert(JSON.stringify(got) === JSON.stringify(want), `proposte:\n     ${got.join('\n     ')}`);
  const md = run(root, 'suggest-links', 'docs/funzioni.md').out;
  assert(md.includes('file = funzione') && md.includes('eccezione A13') && md.includes('livello=file'), 'eccezione non dichiarata nel diff');
});

test('A19: README nella cartella della funzione → link al suo index, sotto il titolo principale', () => {
  write(root, 'supabase/functions/sync-x/README.md', '# Sync X — setup\n\nLa funzione scrive una property sul Contact.\n');
  write(root, 'src/altro/README.md', '# Altro\n\nNon è una cartella-funzione.\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'readme');
  const r = JSON.parse(run(root, 'suggest-links', 'supabase/functions/sync-x/README.md', 'src/altro/README.md', '--format', 'json').out);
  const fn = r.docs.find((d) => d.doc === 'supabase/functions/sync-x/README.md');
  assert(fn && fn.proposals.length === 1 && fn.proposals[0].path === 'supabase/functions/sync-x/index.ts' && fn.proposals[0].level === 'file-funzione' && fn.proposals[0].section === '# Sync X — setup', JSON.stringify(fn && fn.proposals));
  assert(!r.docs.some((d) => d.doc === 'src/altro/README.md'), 'README fuori da una cartella-funzione: nessuna proposta');
  run(root, 'suggest-links', 'supabase/functions/sync-x/README.md', '--write');
  const after = readFileSync(join(root, 'supabase/functions/sync-x/README.md'), 'utf-8');
  assert(after.startsWith('# Sync X — setup\n<!-- mr:code path=supabase/functions/sync-x/index.ts livello=file -->'), after);
});

test('A15: diari esclusi per default (hof-*.md, handoff/, segnalazioni/, log/), --include-journals li include', () => {
  const diario = '# Diario\n\nOggi `calcolaQuota()` in `src/lib/fees.ts`.\n';
  for (const p of ['docs/hof-1.md', 'docs/handoff/sessione.md', 'docs/segnalazioni/x.md', 'docs/log/2026.md']) write(root, p, diario);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'diari');
  const r = JSON.parse(run(root, 'suggest-links', 'docs', '--format', 'json').out);
  assert(r.journals_excluded === 4, `diari esclusi: ${r.journals_excluded}`);
  assert(!r.docs.some((d) => /hof-1|handoff|segnalazioni|log\//.test(d.doc)), 'proposte su un diario');
  const all = JSON.parse(run(root, 'suggest-links', 'docs', '--format', 'json', '--include-journals').out);
  assert(all.journals_excluded === 0 && all.docs.filter((d) => /hof-1|handoff|segnalazioni|log\//.test(d.doc) && d.proposals.length).length === 4, 'opt-in non applicato');
});

test('suggest-links --only (0.6-t): numeri dell\'anteprima; --write scrive solo quelli; numero assente → exit 2, niente scritto', () => {
  const ODOC = '# Scelte\n\n## Uno\n\nUsa `calcolaQuota()`.\n\n## Due\n\nLe costanti in `src/util.ts`.\n\n## Tre\n\nVedi `altra` in `src/lib/fees.ts`.\n';
  write(root, 'docs/scelte.md', ODOC);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'scelte');
  const pre = JSON.parse(run(root, 'suggest-links', 'docs/scelte.md', '--format', 'json').out);
  const ps = pre.docs[0].proposals;
  assert(ps.length === 3 && ps.map((p) => p.n).join(',') === '1,2,3', `numeri: ${JSON.stringify(ps.map((p) => [p.n, p.section]))}`);
  const md = run(root, 'suggest-links', 'docs/scelte.md').out;
  assert(md.includes('| # | Sezione |') && /\| 2 \| ## Due \|/.test(md), md);
  const two = ps.find((p) => p.n === 2);
  const bad = run(root, 'suggest-links', 'docs/scelte.md', '--write', '--only', '2,9');
  assert(bad.code === 2 && /non presenti nell'anteprima \(1-3\): 9/.test(bad.err), `numero assente: ${bad.code} ${bad.err}`);
  assert(readFileSync(join(root, 'docs/scelte.md'), 'utf-8') === ODOC, 'con un numero sbagliato non deve scrivere niente');
  assert(run(root, 'suggest-links', 'docs/scelte.md', '--only', 'a').code === 2, '--only non numerico → 2');
  assert(run(root, 'scan', 'docs/scelte.md', '--only', '1').code === 2, '--only fuori da suggest-links → 2');
  const w = run(root, 'suggest-links', 'docs/scelte.md', '--write', '--only', '2');
  assert(w.code === 0, w.err);
  const after = readFileSync(join(root, 'docs/scelte.md'), 'utf-8');
  const anchors = after.match(/<!-- mr:code [^>]*-->/g) || [];
  assert(anchors.length === 1 && anchors[0].includes(`path=${two.path}`) && after.includes(`${two.section}\n<!-- mr:code`), `una sola ancora, la 2:\n${after}`);
});

rmSync(root, { recursive: true, force: true });

test('verify --write con working tree sporco (0.6-l): tocca solo il doc indicato, non l\'indice né altri file', () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'mr-verify-sporco-')));
  execFileSync('git', ['init', '-q', d]);
  write(d, 'src/util.ts', 'export const VERSIONE = 1;\n');
  write(d, 'altro/collega.md', '# Note\n\nversione committata\n');
  write(d, 'altro/staged.txt', 'prima\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'A');
  const a = git(d, 'rev-parse', '--short', 'HEAD').trim();
  const doc = `---\nmr_version: '0.6'\nid: test/sporco\ntitle: Sporco\ntype: reference\nowner: test\nstatus: active\ncreated: '2026-10-03'\nlast_updated: '2026-10-03'\ncode_refs:\n  - path: src/util.ts\n    verified: { commit: '${a}' }\n---\n\n# Doc\n`;
  write(d, 'docs/doc.md', doc);
  write(d, 'docs/altro.md', doc.replace('test/sporco', 'test/altro'));
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'doc');
  write(d, 'src/util.ts', 'export const VERSIONE = 2;\n');
  git(d, 'commit', '-q', '-am', 'B');
  // lavoro in corso di qualcun altro: tracciato modificato, staged, non tracciato, altro doc MR modificato
  write(d, 'altro/collega.md', '# Note\n\nmodifica non committata di un collega\n');
  write(d, 'altro/staged.txt', 'dopo, in staging\n');
  git(d, 'add', 'altro/staged.txt');
  write(d, 'altro/nuovo.txt', 'file nuovo non tracciato\n');
  write(d, 'docs/altro.md', readFileSync(join(d, 'docs/altro.md'), 'utf-8') + '\nriga in corso\n');
  const snap = () => Object.fromEntries(['altro/collega.md', 'altro/staged.txt', 'altro/nuovo.txt', 'docs/altro.md', 'src/util.ts'].map((f) => [f, readFileSync(join(d, f), 'utf-8')]));
  const before = snap();
  const cachedBefore = git(d, 'diff', '--cached', '--name-only');
  const stagedContentBefore = git(d, 'diff', '--cached');
  const r = run(d, 'verify', 'docs/doc.md', '--write');
  const after = snap();
  const status = git(d, 'status', '--porcelain');
  const stagedContentAfter = git(d, 'diff', '--cached');
  rmSync(d, { recursive: true, force: true });
  assert(r.code === 0, `exit atteso 0, ottenuto ${r.code}\n${r.err}${r.out}`);
  for (const f of Object.keys(before)) assert(before[f] === after[f], `${f} è cambiato`);
  assert(cachedBefore.trim() === 'altro/staged.txt', 'indice di partenza inatteso');
  assert(stagedContentAfter === stagedContentBefore, 'l\'indice (staging) è cambiato');
  assert(/^ M docs\/doc\.md$/m.test(status), `docs/doc.md deve risultare modificato e non in staging:\n${status}`);
  assert(/^M  altro\/staged\.txt$/m.test(status) && /^ M altro\/collega\.md$/m.test(status) && /^\?\? altro\/nuovo\.txt$/m.test(status) && /^ M docs\/altro\.md$/m.test(status), `stato degli altri file cambiato:\n${status}`);
  assert(status.trim().split('\n').length === 5, `file toccati in più:\n${status}`);
  assert(stagedContentBefore.length > 0, 'staging di prova vuoto');
});

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
