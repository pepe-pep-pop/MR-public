#!/usr/bin/env node
/**
 * test-scan.mjs — test di `mr scan` (R1-R4, R10 minimo) e `mr impact` (R6), MR v0.6-b.
 *
 * Repo git di prova in una cartella temporanea, due commit (A: doc allineato, B: codice
 * cambiato). Un caso per ogni esito di R3 (N8): ok, drift, moved, missing, unverified,
 * unresolvable; più livelli di R4, ancore (R2), doc storici, --rev, --code-repo con
 * abbinamento al remote, diff con righe sensibili omesse, impact su commit/staged/path,
 * e sola lettura.
 *
 * Invocazione: node tools/mr/test-scan.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { findSymbol } from './lib/symbols.mjs';
import { readCodeRefs } from './lib/coderefs.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');

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
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return JSON.stringify(out);
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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\ntest-scan.mjs\n');
// 0.6-z35: impact legge l'indice dei doc: nei test un indice inesistente, mai quello della macchina
process.env.MR_INDICE_DIR = join(tmpdir(), 'mr-test-indice-inesistente-' + process.pid);

// ── unit ──
test('findSymbol: livelli regex (TS, Python, SQL) e occorrenze', () => {
  const ts = 'import x\n\nexport function calcola(a: number,\n  b: number) {\n  if (a) { return 1 }\n  return "}" + b\n}\nconst dopo = 1\n';
  const s1 = findSymbol(ts, 'calcola', 'a.ts');
  assert(s1 && s1.level === 'regex' && s1.start === 3 && s1.end === 7, `TS: ${JSON.stringify(s1)}`);
  const py = 'def f(x):\n    if x:\n        return 1\n\n    return 2\n\ndef g():\n    pass\n';
  const s2 = findSymbol(py, 'f', 'a.py');
  assert(s2 && s2.start === 1 && s2.end === 5, `Python: ${JSON.stringify(s2)}`);
  const sql = 'create table public.spedizioni (\n  id int,\n  stato text\n);\ncreate table altro (id int);\n';
  const s3 = findSymbol(sql, 'spedizioni', 'm.sql');
  assert(s3 && s3.start === 1 && s3.end === 4, `SQL: ${JSON.stringify(s3)}`);
  const env = 'const a = Deno.env.get("API_TOKEN")\nfoo()\nlog(API_TOKEN)\n';
  const s4 = findSymbol(env, 'API_TOKEN', 'e.ts');
  assert(s4 && s4.level === 'occurrences' && JSON.stringify(s4.lines) === '[1,3]', `env: ${JSON.stringify(s4)}`);
  assert(findSymbol(ts, 'inesistente', 'a.ts') === null, 'simbolo assente deve dare null');
  const route = "app.post('/api/ordini', async (c) => {\n  return c.json(1)\n})\n";
  const s5 = findSymbol(route, 'POST /api/ordini', 'r.ts');
  assert(s5 && s5.start === 1 && s5.end === 3, `route: ${JSON.stringify(s5)}`);
});

test('readCodeRefs: hash di commit tutti cifre o «scientifici» restano stringhe esatte', () => {
  const { refs } = readCodeRefs('---\ncode_refs:\n  - { path: a.ts, verified: { commit: 0164750 } }\n  - path: b.ts\n    verified: { commit: 3e45123 }\n---\n# T\n');
  assert(refs[0].verified.commit === '0164750', `ottenuto ${refs[0].verified.commit}`);
  assert(refs[1].verified.commit === '3e45123', `ottenuto ${refs[1].verified.commit}`);
});

test('readCodeRefs (0.6-w): un\'ancora citata tra backtick o in un blocco di codice non è un\'ancora', () => {
  const text = [
    '# Doc', '', '## Sintassi', '',
    '| Codice ↔ doc | ancore `<!-- mr:code path=… symbol=… verified=… -->` e `code_refs` | legano una sezione |',
    'Esempio: ``<!-- mr:code path=src/a.ts symbol=f -->`` in linea.',
    '```', '<!-- mr:code path=src/b.ts symbol=g -->', '```', '',
    '## Vera', '', '<!-- mr:code path=src/c.ts symbol=h --> e la sintassi `<!-- mr:code path=x.ts -->` sulla stessa riga',
  ].join('\n');
  const { refs, errors } = readCodeRefs(text);
  assert(refs.length === 1 && refs[0].path === 'src/c.ts' && refs[0].section === '## Vera', JSON.stringify(refs));
  assert(errors.length === 0, `nessun errore «ancora senza path» per la sintassi citata: ${errors}`);
});

test('readCodeRefs: frontmatter + ancore, l\'ancora prevale sulla stessa sezione (R2)', () => {
  const text = `---\nid: x\ncode_refs:\n  - path: a.ts\n    section: "## Quote"\n  - path: b.ts\n    verified: { commit: abc1234 }\n---\n# T\n\n## Quote\n\n<!-- mr:code path=c.ts symbol=f verified=def5678 -->\nTesto\n`;
  const { refs, errors } = readCodeRefs(text);
  assert(!errors.length, errors.join(';'));
  const paths = refs.map((r) => r.path).sort().join(',');
  assert(paths === 'b.ts,c.ts', `link effettivi: ${paths}`);
  const anc = refs.find((r) => r.path === 'c.ts');
  assert(anc.source === 'anchor' && anc.section === '## Quote' && anc.verified.commit === 'def5678' && anc.line === 13, JSON.stringify(anc));
});

// ── integrazione ──
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-scan-test-')));
execFileSync('git', ['init', '-q', root]);
write(root, 'src/lib/fees.ts', [
  'export function calcolaQuota(importo: number) {',
  '  return importo * 2;',
  '}',
  '',
  'export function altra() {',
  '  return 1;',
  '}',
  '',
  'export function sparita() {',
  '  return 0;',
  '}',
  '',
  'export function spostata() {',
  '  return 3;',
  '}',
  '',
].join('\n'));
write(root, 'src/env.ts', 'export const t = Deno.env.get("API_TOKEN");\n');
write(root, 'src/old.ts', 'export const vecchio = 1;\nexport const due = 2;\nexport const tre = 3;\n');
write(root, 'src/gone.ts', 'export const x = 1;\n');
write(root, 'sql/001.sql', 'create table public.spedizioni (\n  id int\n);\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'A');
const A = git(root, 'rev-parse', '--short', 'HEAD').trim();

const DOC = `---
mr_version: '0.6'
id: test/doc
title: Doc con link
type: reference
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
code_refs:
  - { path: src/lib/fees.ts, symbol: calcolaQuota, section: "## Quote", verified: { commit: ${A} } }
  - { path: src/lib/fees.ts, symbol: altra, verified: { commit: ${A} } }
  - { path: src/env.ts, symbol: API_TOKEN, verified: { commit: ${A} } }
  - { path: src/old.ts, verified: { commit: ${A} } }
  - { path: src/gone.ts, verified: { commit: ${A} } }
  - { path: src/lib/fees.ts, symbol: sparita, verified: { commit: ${A} } }
  - { path: src/lib/fees.ts, symbol: spostata, verified: { commit: ${A} } }
  - { path: src/lib/fees.ts, symbol: altra }
  - { path: src/x.ts, repo: altri/repo, verified: { commit: ${A} } }
  - { path: src/env.ts, verified: { commit: deadbee } }
  - { path: sql/001.sql, symbol: spedizioni, verified: { commit: ${A} } }
  - { path: "src/lib/*.ts", verified: { commit: ${A} } }
---

# Doc

## Quote

<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=${A} -->
La quota è il doppio dell'importo.
`;
write(root, 'docs/doc.md', DOC);
write(root, 'docs/_archive/vecchio.md', `# Vecchio\n\n<!-- mr:code path=src/gone.ts verified=${A} -->\n`);
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'doc');
const DOCC = git(root, 'rev-parse', '--short', 'HEAD').trim();

// commit B: il codice cambia
write(root, 'src/lib/fees.ts', [
  'export function calcolaQuota(importo: number) {',
  '  const token = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH";',
  '  // referente: mario.rossi@example.com',
  '  return importo * 3;',
  '}',
  '',
  'export function altra() {',
  '  return 1;',
  '}',
  '',
].join('\n'));
write(root, 'src/other.ts', 'export function spostata() {\n  return 3;\n}\n');
renameSync(join(root, 'src/old.ts'), join(root, 'src/new.ts'));
rmSync(join(root, 'src/gone.ts'));
write(root, 'sql/001.sql', 'create table public.spedizioni (\n  id int,\n  stato text\n);\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'B');
const B = git(root, 'rev-parse', '--short', 'HEAD').trim();

let rep;
test('scan: un esito per tipo (N8)', () => {
  const r = run(root, 'scan', 'docs/doc.md', '--format', 'json', '--fail');
  assert(r.code === 1, `exit atteso 1 con --fail, ottenuto ${r.code}\n${r.err}`);
  rep = JSON.parse(r.out);
  const find = (pred) => rep.refs.filter(pred);
  const one = (path, symbol, extra = () => true) => {
    const hits = find((x) => x.path === path && (x.symbol || null) === (symbol || null) && extra(x));
    assert(hits.length >= 1, `link ${path}#${symbol} non trovato`);
    return hits[0];
  };
  const expect = [
    [one('src/lib/fees.ts', 'calcolaQuota'), 'drift', 'regex'],
    [one('src/lib/fees.ts', 'altra', (x) => x.verified), 'ok', 'regex'],
    [one('src/env.ts', 'API_TOKEN'), 'ok', 'occurrences'],
    [one('src/old.ts', null), 'moved', 'file'],
    [one('src/gone.ts', null), 'missing', 'file'],
    [one('src/lib/fees.ts', 'sparita'), 'missing', 'file'],
    [one('src/lib/fees.ts', 'spostata'), 'moved', 'regex'],
    [one('src/lib/fees.ts', 'altra', (x) => !x.verified), 'unverified', 'regex'],
    [one('src/x.ts', null), 'unresolvable', 'n/a'],
    [one('src/env.ts', null, (x) => x.verified === 'deadbee'), 'unresolvable', 'n/a'],
    [one('sql/001.sql', 'spedizioni'), 'drift', 'regex'],
    [one('src/lib/*.ts', null), 'drift', 'glob'],
  ];
  const wrong = expect.filter(([x, st, lv]) => x.status !== st || x.level !== lv).map(([x, st, lv]) => `${x.path}#${x.symbol || ''}: atteso ${st}/${lv}, ottenuto ${x.status}/${x.level} ${x.note || ''}`);
  assert(!wrong.length, wrong.join('\n     '));
  assert(one('src/old.ts', null).moved_to === 'src/new.ts', 'moved_to del file rinominato errato');
  assert(one('src/lib/fees.ts', 'spostata').moved_to === 'src/other.ts', 'moved_to del simbolo spostato errato');
});

test('R2: l\'ancora sostituisce il code_ref della stessa sezione; doc storici solo informativi', () => {
  const quota = rep.refs.filter((x) => x.symbol === 'calcolaQuota');
  assert(quota.length === 1 && quota[0].via === 'ancora', `atteso un solo link (ancora), trovati ${quota.length}: ${quota.map((q) => q.via)}`);
  const all = JSON.parse(run(root, 'scan', 'docs', '--format', 'json').out);
  const h = all.refs.find((x) => x.doc === 'docs/_archive/vecchio.md');
  assert(h && h.status === 'missing' && h.historical, 'link nel doc storico non marcato');
  assert(all.refs_summary.historical === 1, `refs_summary.historical: ${all.refs_summary.historical}`);
});

test('diff ridotto al simbolo, con segreti ed email omessi; commit senza oggetto di default', () => {
  const quota = rep.refs.find((x) => x.symbol === 'calcolaQuota');
  const diff = quota.diff.join('\n');
  assert(diff.includes('+  return importo * 3;') && diff.includes('-  return importo * 2;'), `diff inatteso:\n${diff}`);
  assert(!diff.includes('abcdefghijklmnopqrstuvwxyz') && diff.includes('[riga omessa: possibile segreto]'), 'riga con segreto non omessa');
  assert(!diff.includes('mario.rossi@example.com') && diff.includes('[email]'), 'email non omessa');
  assert(!diff.includes('altra'), 'il diff deve essere ridotto al simbolo');
  assert(quota.commits.length === 1 && quota.commits[0].hash === B && !('subject' in quota.commits[0]), JSON.stringify(quota.commits));
  const withSubj = JSON.parse(run(root, 'scan', 'docs/doc.md', '--format', 'json', '--subjects').out);
  assert(withSubj.refs.find((x) => x.symbol === 'calcolaQuota').commits[0].subject === 'B', '--subjects non mostra l\'oggetto');
});

test('scan --rev: al commit in cui il doc era allineato nessuna deriva', () => {
  const r = run(root, 'scan', 'docs/doc.md', '--format', 'json', '--rev', DOCC);
  const j = JSON.parse(r.out);
  const bad = j.refs.filter((x) => !['ok', 'unverified', 'unresolvable'].includes(x.status));
  assert(!bad.length, bad.map((x) => `${x.path}#${x.symbol || ''}: ${x.status}`).join(', '));
  assert(j.refs_summary.ok === 9, `attesi 9 ok, ottenuti ${j.refs_summary.ok}`);
  assert(run(root, 'scan', 'docs/doc.md', '--rev', A).code === 2, 'doc assente al commit → 2');
});

test('md: tabella dei link e diff in <details>', () => {
  const r = run(root, 'scan', 'docs/doc.md');
  assert(r.out.includes('# Link al codice') && r.out.includes('❌ drift') && r.out.includes('<details><summary>diff src/lib/fees.ts#calcolaQuota'), 'md incompleto');
});

test('--code-repo: doc in un altro repo, repo: owner/nome abbinato al remote origin', () => {
  git(root, 'remote', 'add', 'origin', 'https://github.com/acme/codice.git');
  const docs = realpathSync(mkdtempSync(join(tmpdir(), 'mr-scan-docs-')));
  execFileSync('git', ['init', '-q', docs]);
  write(docs, 'nota.md', `---\ncode_refs:\n  - { path: src/lib/fees.ts, symbol: altra, repo: acme/codice, verified: { commit: ${A} } }\n  - { path: src/lib/fees.ts, symbol: calcolaQuota, verified: { commit: ${A} } }\n---\n# Nota\n`);
  const r = JSON.parse(run(docs, 'scan', 'nota.md', '--format', 'json', '--code-repo', root).out);
  const st = (s) => r.refs.find((x) => x.symbol === s);
  assert(st('altra').status === 'ok' && st('altra').code_repo === root.split('/').pop(), JSON.stringify(st('altra')));
  assert(st('calcolaQuota').status === 'drift', 'il link senza repo deve usare il primo --code-repo');
  const none = JSON.parse(run(docs, 'scan', 'nota.md', '--format', 'json').out);
  assert(none.refs.find((x) => x.symbol === 'altra').status === 'unresolvable', 'senza --code-repo il repo acme/codice non è disponibile');
  rmSync(docs, { recursive: true, force: true });
});

test('impact <commit>: doc e sezioni da ricontrollare (R6)', () => {
  const r = run(root, 'impact', B, '--format', 'json');
  assert(r.code === 0, `exit atteso 0 senza --fail, ottenuto ${r.code}\n${r.err}`);
  const j = JSON.parse(r.out);
  const reasons = j.items.filter((i) => i.doc === 'docs/doc.md').map((i) => `${i.ref}: ${i.reason}`);
  const has = (frag) => reasons.some((x) => x.includes(frag));
  assert(has('src/lib/fees.ts#calcolaQuota: simbolo del link toccato'), reasons.join('\n'));
  assert(has('src/lib/fees.ts#sparita: simbolo del link non più trovato'), reasons.join('\n'));
  assert(has('src/gone.ts: file del link cancellato'), reasons.join('\n'));
  assert(has('sql/001.sql#spedizioni: simbolo del link toccato'), reasons.join('\n'));
  assert(j.items.some((i) => i.doc === 'docs/_archive/vecchio.md' && i.historical), 'doc storico non marcato');
  assert(run(root, 'impact', B, '--fail').code === 1, '--fail deve dare 1 con doc impattati');
});

test('impact --staged e impact <path>; il doc stesso non conta', () => {
  write(root, 'src/env.ts', 'export const t = Deno.env.get("API_TOKEN") ?? "";\n');
  git(root, 'add', 'src/env.ts');
  const s = JSON.parse(run(root, 'impact', '--staged', '--format', 'json').out);
  assert(s.items.some((i) => i.ref === 'src/env.ts#API_TOKEN' && i.reason === 'simbolo del link toccato'), JSON.stringify(s.items));
  git(root, 'reset', '-q', 'src/env.ts');
  git(root, 'checkout', '-q', '--', 'src/env.ts');
  const p = JSON.parse(run(root, 'impact', 'src/new.ts', '--format', 'json').out);
  assert(p.touched_files.length === 1 && p.touched_files[0] === 'src/new.ts', JSON.stringify(p.touched_files));
  const d = JSON.parse(run(root, 'impact', 'docs/doc.md', '--format', 'json').out);
  assert(!d.items.some((i) => i.doc === 'docs/doc.md'), 'il doc toccato non deve segnalare se stesso');
  assert(d.touched_files.length === 0 && d.touched_docs_ignored === 1, 'i .md toccati vanno esclusi di default');
  const di = JSON.parse(run(root, 'impact', 'docs/doc.md', '--format', 'json', '--include-docs').out);
  assert(di.touched_files.length === 1, '--include-docs deve considerarli');
  assert(run(root, 'impact').code === 2 && run(root, 'impact', 'nonesiste').code === 2, 'bersaglio mancante o non valido → 2');
});

test('--format segnalazione: una segnalazione doc-stale per doc, con path:riga e commit (R11, A20)', () => {
  const r = run(root, 'scan', 'docs', '--format', 'segnalazione', '--workspace', 'prova');
  assert(r.code === 0, `exit atteso 0 senza --fail (0.6-z10), ottenuto ${r.code}`);
  assert(r.out.includes('# Segnalazione — docs/doc.md') && r.out.includes('**Tipo:** doc-stale') && r.out.includes('**Workspace:** prova'), 'intestazione mancante');
  assert(r.out.includes('**Peso:** alto (quanto lavoro sul doc)'), 'peso atteso alto (link missing/moved)');
  assert(r.out.includes('**Quando:** dopo la task in corso (MR segnala, non blocca)'), 'riga «Quando» nella segnalazione');
  assert(r.out.includes(`link \`src/lib/fees.ts#calcolaQuota\` → **drift**`) && r.out.includes(B), 'link in deriva senza commit');
  assert(r.out.includes('Arch non applica la patch') && r.out.includes('## Cosa non fare'), 'sezioni del template mancanti');
  assert(!r.out.includes('docs/_archive/vecchio.md'), 'i doc storici non producono segnalazioni');
  // claim non trovato con il commit che l'ha causato
  write(root, 'docs/claim.md', '# Claim\n\nVedi `src/gone.ts`.\n');
  const c = run(root, 'claims', 'docs/claim.md', '--format', 'segnalazione');
  const gone = git(root, 'log', '-n1', '--format=%h', '--diff-filter=D', '--', 'src/gone.ts').trim();
  assert(c.out.includes('riga 3') && c.out.includes(`path \`src/gone.ts\` non trovato`) && c.out.includes(`causato da ${gone}`), c.out);
  rmSync(join(root, 'docs/claim.md'));
  assert(run(root, 'impact', 'HEAD', '--format', 'segnalazione').code === 2, 'segnalazione non vale per impact');
});

test('sola lettura: nessun file creato o modificato, HEAD invariato', () => {
  const before = snapshot(root);
  const head = git(root, 'rev-parse', 'HEAD');
  run(root, 'scan', 'docs');
  run(root, 'scan', 'docs', '--rev', A, '--format', 'json');
  run(root, 'impact', B);
  run(root, 'impact', `${A}..${B}`);
  assert(snapshot(root) === before, 'il filesystem è cambiato');
  assert(git(root, 'rev-parse', 'HEAD') === head, 'HEAD cambiato');
});

rmSync(root, { recursive: true, force: true });

test('scan exit code (0.6-p): con tutti i link ok esce 0 anche con claim non trovati; senza link valgono i claim', () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'mr-scan-exit-')));
  execFileSync('git', ['init', '-q', d]);
  write(d, 'src/lib.ts', 'export function calcola(x: number) {\n  return x * 2;\n}\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'codice');
  const c = git(d, 'rev-parse', '--short', 'HEAD').trim();
  write(d, 'docs/con-link.md', `# Con link\n\n<!-- mr:code path=src/lib.ts symbol=calcola verified=${c} -->\nLa funzione \`calcola()\`; vedi anche \`src/inesistente.ts\`.\n`);
  write(d, 'docs/senza-link.md', '# Senza link\n\nVedi `src/inesistente.ts`.\n');
  git(d, 'add', '-A');
  git(d, 'commit', '-q', '-m', 'doc');
  const a = run(d, 'scan', 'docs/con-link.md', '--format', 'json');
  const ja = JSON.parse(a.out);
  const b = run(d, 'scan', 'docs/senza-link.md', '--fail');
  const both = run(d, 'scan', 'docs', '--fail');
  write(d, 'src/lib.ts', 'export function calcola(x: number) {\n  return x * 3;\n}\n');
  git(d, 'commit', '-q', '-am', 'cambia calcola');
  const drift = run(d, 'scan', 'docs/con-link.md', '--fail');
  rmSync(d, { recursive: true, force: true });
  assert(a.code === 0, `link ok + claim non trovato: exit atteso 0, ottenuto ${a.code}`);
  assert(ja.claims.some((x) => x.claim === 'src/inesistente.ts' && x.status === 'not_found') && ja.refs.every((r) => r.status === 'ok'), 'il claim non trovato resta nel report');
  assert(b.code === 1, `doc senza link con claim non trovato: exit atteso 1, ottenuto ${b.code}`);
  assert(both.code === 1, `cartella con un doc senza link e un claim non trovato: exit atteso 1, ottenuto ${both.code}`);
  assert(drift.code === 1, `link in drift: exit atteso 1, ottenuto ${drift.code}`);
});

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
