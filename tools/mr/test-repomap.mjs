#!/usr/bin/env node
/**
 * test-repomap.mjs — mappa locale doc → repo `mr.repos.yaml` (PRD v0.6 R10, nota A9).
 *
 * Un repo di doc e due repo di codice (A, B) in una cartella temporanea. Vincolo A9: un claim
 * conta trovato solo nei repo mappati per il suo doc. In più: regola più specifica prima,
 * doc senza regola = solo il proprio repo, errori della mappa, --repos-file, precedenza di
 * --code-repo, scan e impact con la mappa, sola lettura.
 *
 * Invocazione: node tools/mr/test-repomap.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

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

console.log('\ntest-repomap.mjs\n');
// 0.6-z35: impact legge l'indice dei doc: nei test un indice inesistente, mai quello della macchina
process.env.MR_INDICE_DIR = join(tmpdir(), 'mr-test-indice-inesistente-' + process.pid);

const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-repomap-')));
const docs = join(base, 'docs-repo');
const codeA = join(docs, 'codice/repo-a'); // repo annidato: come apps/ dentro il monorepo
const codeB = join(docs, 'codice/repo-b');
for (const r of [docs, codeA, codeB]) {
  mkdirSync(r, { recursive: true });
  execFileSync('git', ['init', '-q', r]);
}
write(codeA, 'src/solo-a.ts', 'export function soloA() { return 1 }\n');
write(codeB, 'src/solo-b.ts', 'export function soloB() { return 2 }\n');
git(codeA, 'add', '-A'); git(codeA, 'commit', '-q', '-m', 'a');
git(codeB, 'add', '-A'); git(codeB, 'commit', '-q', '-m', 'b');
const A = git(codeA, 'rev-parse', '--short', 'HEAD').trim();
write(docs, '.gitignore', 'codice/\n');
const doc = (title) => `# ${title}\n\nCita \`src/solo-a.ts\` e \`src/solo-b.ts\`, \`soloA()\` e \`soloB()\`.\n`;
write(docs, 'note/a/uno.md', doc('Doc su A'));
write(docs, 'note/b/due.md', doc('Doc su B'));
write(docs, 'note/a/speciale/tre.md', doc('Doc su A e B'));
write(docs, 'radice.md', doc('Doc senza regola'));
write(docs, 'mr.repos.yaml', [
  'repos:',
  '  a: codice/repo-a',
  '  b: codice/repo-b',
  'map:',
  '  - docs: "note/a/speciale/**"',
  '    repos: [a, b]',
  '  - docs: "note/a/**"',
  '    repos: [a]',
  '  - docs: "note/b/**"',
  '    repos: [b, self]',
  '',
].join('\n'));
git(docs, 'add', '-A'); git(docs, 'commit', '-q', '-m', 'docs');

const statusOf = (rep, doc, claim) => rep.claims.find((c) => c.doc === doc && c.claim === claim)?.status;

let rep;
test('vincolo A9: trovato solo nei repo mappati per il doc', () => {
  const r = run(docs, 'claims', '.', '--format', 'json');
  rep = JSON.parse(r.out);
  const expect = [
    ['note/a/uno.md', 'src/solo-a.ts', 'found'], ['note/a/uno.md', 'src/solo-b.ts', 'not_found'],
    ['note/a/uno.md', 'soloA()', 'found'], ['note/a/uno.md', 'soloB()', 'not_found'],
    ['note/b/due.md', 'src/solo-a.ts', 'not_found'], ['note/b/due.md', 'src/solo-b.ts', 'found'],
    ['note/a/speciale/tre.md', 'src/solo-a.ts', 'found'], ['note/a/speciale/tre.md', 'src/solo-b.ts', 'found'],
    ['radice.md', 'src/solo-a.ts', 'not_found'], ['radice.md', 'soloB()', 'not_found'],
  ];
  const wrong = expect.filter(([d, c, s]) => statusOf(rep, d, c) !== s).map(([d, c, s]) => `${d} ${c}: atteso ${s}, ottenuto ${statusOf(rep, d, c)}`);
  assert(!wrong.length, wrong.join('\n     '));
  assert(rep.repos_map && rep.repos_map.rules.length === 3, 'repos_map assente nel report');
});

test('md: la mappa è dichiarata nell\'intestazione', () => {
  assert(run(docs, 'claims', 'note').out.includes('Mappa dei repo (mr.repos.yaml)'), 'intestazione mancante');
});

test('--code-repo ha la precedenza sulla mappa', () => {
  const r = JSON.parse(run(docs, 'claims', '.', '--format', 'json', '--code-repo', codeB).out);
  assert(statusOf(r, 'note/a/uno.md', 'src/solo-b.ts') === 'found' && statusOf(r, 'note/a/uno.md', 'src/solo-a.ts') === 'not_found', 'con --code-repo la mappa non va usata');
});

test('--repos-file: mappa esterna (piloti in sola lettura)', () => {
  const ext = join(base, 'mappa-esterna.yaml');
  writeFileSync(ext, 'repos:\n  b: codice/repo-b\nmap:\n  - docs: "**"\n    repos: [b]\n');
  const r = JSON.parse(run(docs, 'claims', '.', '--format', 'json', '--repos-file', ext).out);
  assert(statusOf(r, 'note/a/uno.md', 'src/solo-b.ts') === 'found' && statusOf(r, 'note/a/uno.md', 'src/solo-a.ts') === 'not_found', 'mappa esterna non applicata');
});

test('errori della mappa → exit 2', () => {
  const bad = join(base, 'mappa-errata.yaml');
  writeFileSync(bad, 'repos:\n  x: codice/manca\nmap:\n  - docs: "**"\n    repos: [x, y]\n');
  const r = run(docs, 'claims', '.', '--repos-file', bad);
  assert(r.code === 2 && r.err.includes('cartella non trovata') && r.err.includes('non dichiarati'), `${r.code} ${r.err}`);
  assert(run(docs, 'claims', '.', '--repos-file', join(base, 'manca.yaml')).code === 2, 'file mancante → 2');
});

test('scan: il link senza repo usa il primo repo mappato del doc', () => {
  write(docs, 'note/a/link.md', `---\ncode_refs:\n  - { path: src/solo-a.ts, symbol: soloA, verified: { commit: '${A}' } }\n---\n# Link\n`);
  const r = JSON.parse(run(docs, 'scan', 'note/a/link.md', '--format', 'json').out);
  assert(r.refs[0].status === 'ok' && r.refs[0].code_repo === 'repo-a', JSON.stringify(r.refs[0]));
  rmSync(join(docs, 'note/a/link.md'));
});

test('impact: solo i doc mappati sul repo del codice', () => {
  write(codeB, 'src/solo-b.ts', 'export function soloB() { return 3 }\n');
  git(codeB, 'commit', '-q', '-am', 'b2');
  const r = JSON.parse(run(codeB, 'impact', 'HEAD', '--docs', docs, '--format', 'json').out);
  const impacted = [...new Set(r.items.map((i) => i.doc))].sort();
  assert(JSON.stringify(impacted) === JSON.stringify(['note/a/speciale/tre.md', 'note/b/due.md']), `doc impattati: ${impacted}`);
  assert(r.docs_not_mapped === 2, `docs_not_mapped: ${r.docs_not_mapped}`);
});

test('sola lettura: nessun file creato o modificato', () => {
  const before = [snapshot(docs), snapshot(codeA), snapshot(codeB)].join();
  run(docs, 'claims', '.');
  run(docs, 'scan', '.', '--format', 'json');
  run(codeB, 'impact', 'HEAD', '--docs', docs);
  assert([snapshot(docs), snapshot(codeA), snapshot(codeB)].join() === before, 'il filesystem è cambiato');
});

rmSync(base, { recursive: true, force: true });

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
