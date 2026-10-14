#!/usr/bin/env node
/**
 * test-remap.mjs — `mr remap` dopo una riscrittura vera con git filter-repo (nota A16).
 *
 * Repo temporaneo con commit A (codice), P (solo un file da togliere), B (codice), poi un doc
 * con link verificati ad A, B, P e a un hash mai esistito. `git filter-repo` sostituisce un
 * testo presente fin da A (cambiano tutti gli hash) e toglie il file di P (P diventa vuoto ed
 * è eliminato). Controlli: esatto via commit-map, eliminato, non trovato, ripiego per
 * data+file solo proposto, applicato solo con --accept-fallback e candidato unico,
 * anteprima senza scritture, --write solo sui link esatti, codice mai toccato.
 *
 * Serve git-filter-repo nel PATH (in CI: tools/mr/requirements-test.txt nel venv).
 * Invocazione: node tools/mr/test-remap.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCommitMap } from './lib/remap.mjs';

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

console.log('\ntest-remap.mjs\n');

const fr = spawnSync('git', ['filter-repo', '--version'], { encoding: 'utf-8' });
if (fr.status !== 0) {
  console.log('  ❌ git-filter-repo non disponibile nel PATH (in CI: pip install -r tools/mr/requirements-test.txt nel venv)');
  process.exit(1);
}

test('parseCommitMap: intestazione ignorata, sha minuscoli, zeri = eliminato', () => {
  const m = parseCommitMap(`old                                      new\n${'A'.repeat(40)} ${'b'.repeat(40)}\n${'c'.repeat(40)} ${'0'.repeat(40)}\nriga non valida\n`);
  assert(m.size === 2 && m.get('a'.repeat(40)) === 'b'.repeat(40) && m.get('c'.repeat(40)) === '0'.repeat(40), JSON.stringify([...m]));
});

const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-remap-test-')));
execFileSync('git', ['init', '-q', '-b', 'main', root]);
write(root, 'src/a.ts', 'export function f() {\n  return "VECCHIO";\n}\n');
write(root, 'src/b.ts', 'export const unico = 1;\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'A');
const A = git(root, 'rev-parse', '--short=8', 'HEAD').trim();
write(root, 'tmp/rimuovi.txt', 'da togliere\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'P');
const P = git(root, 'rev-parse', '--short=8', 'HEAD').trim();
write(root, 'src/a.ts', 'export function f() {\n  return "VECCHIO" + 1;\n}\n');
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'B');
const B = git(root, 'rev-parse', '--short=8', 'HEAD').trim();
const day = git(root, 'show', '-s', '--format=%as', 'HEAD').trim();
const DOC = `---
code_refs:
  - { path: src/a.ts, symbol: f, verified: { commit: '${A}', date: '${day}' } }
  - { path: tmp/rimuovi.txt, verified: { commit: '${P}', date: '${day}' } }
  - { path: src/a.ts, verified: { commit: 'abcdef12' } }
  - { path: src/b.ts, verified: { commit: '${A}', date: '${day}' } }
---
# Doc

## Codice

<!-- mr:code path=src/a.ts symbol=f verified=${B} date=${day} -->
Testo.
`;
write(root, 'docs/doc.md', DOC);
git(root, 'add', '-A');
git(root, 'commit', '-q', '-m', 'doc');

// riscrittura vera: testo cambiato fin da A, file di P tolto (P diventa vuoto)
writeFileSync(join(root, '..', `${root.split('/').pop()}-replace.txt`), 'VECCHIO==>NUOVO\n');
execFileSync('git', ['-C', root, 'filter-repo', '--force', '--quiet', '--replace-text', join(root, '..', `${root.split('/').pop()}-replace.txt`), '--invert-paths', '--path', 'tmp/rimuovi.txt'], { stdio: 'ignore' });
const MAP = join(root, '.git/filter-repo/commit-map');

test('dopo filter-repo i vecchi hash non esistono più', () => {
  for (const h of [A, B, P]) {
    const r = spawnSync('git', ['-C', root, 'cat-file', '-e', `${h}^{commit}`]);
    assert(r.status !== 0, `${h} esiste ancora`);
  }
});

test('remap --commit-map: esatto, eliminato, non trovato; anteprima senza scritture', () => {
  const before = readFileSync(join(root, 'docs/doc.md'), 'utf-8');
  const r = run(root, 'remap', 'docs/doc.md', '--commit-map', MAP, '--format', 'json');
  assert(readFileSync(join(root, 'docs/doc.md'), 'utf-8') === before, 'scritto senza --write');
  assert(r.code === 1, `exit atteso 1 (link non risolti), ottenuto ${r.code}\n${r.err}`);
  const items = JSON.parse(r.out).docs[0].items;
  const by = (path, old) => items.find((i) => i.ref.path === path && i.old === old.toLowerCase());
  assert(by('src/a.ts', A).outcome === 'esatto' && by('src/a.ts', B).outcome === 'esatto', JSON.stringify(items.map((i) => [i.ref.path, i.old, i.outcome])));
  assert(by('tmp/rimuovi.txt', P).outcome === 'eliminato', `P: ${by('tmp/rimuovi.txt', P).outcome}`);
  assert(by('src/a.ts', 'abcdef12').outcome === 'non_trovato', 'hash mai esistito: atteso non_trovato');
  const newA = git(root, 'log', '--format=%h', '--reverse', 'main').trim().split('\n')[0];
  assert(by('src/a.ts', A).newCommit.startsWith(newA.slice(0, 7)), `nuovo A ${by('src/a.ts', A).newCommit} ≠ ${newA}`);
});

test('remap --write: applica solo gli esatti (frontmatter e ancora), il resto resta', () => {
  run(root, 'remap', 'docs/doc.md', '--commit-map', MAP, '--write');
  const after = readFileSync(join(root, 'docs/doc.md'), 'utf-8');
  const firstRef = after.match(/path: src\/a\.ts, symbol: f, verified: \{ commit: '([0-9a-f]+)'/);
  assert(firstRef && firstRef[1] !== A, `link ad A non riancorato: ${firstRef && firstRef[1]}`);
  assert(!after.includes(`verified=${B} `), 'ancora non riancorata');
  assert(after.includes(`commit: '${P}'`), 'il link eliminato non va toccato');
  assert(after.includes("commit: 'abcdef12'"), 'il link non trovato non va toccato');
  const s = JSON.parse(run(root, 'scan', 'docs/doc.md', '--format', 'json').out);
  const fA = s.refs.filter((x) => x.path === 'src/a.ts' && x.symbol === 'f');
  assert(fA.length === 2 && fA.every((x) => x.status === 'ok' || x.status === 'drift'), `dopo remap i link ad A/B devono risolversi: ${fA.map((x) => x.status)}`);
});

test('ripiego per data + file: proposto, applicato solo con --accept-fallback e candidato unico', () => {
  // senza commit-map: src/b.ts ha un solo commit nel giorno (candidato unico),
  // src/a.ts ne ha più d'uno, quindi resta da scegliere a mano
  const fresh = DOC;
  write(root, 'docs/doc2.md', fresh);
  const r = JSON.parse(run(root, 'remap', 'docs/doc2.md', '--format', 'json').out);
  const items = r.docs[0].items;
  const b = items.find((i) => i.ref.path === 'src/b.ts');
  const a = items.find((i) => i.ref.path === 'src/a.ts' && i.ref.source === 'frontmatter' && i.old === A.toLowerCase());
  assert(b.outcome === 'ripiego' && b.newCommit && b.candidates.length === 1, JSON.stringify(b));
  assert(a.outcome === 'ripiego' && !a.newCommit && a.candidates.length > 1, JSON.stringify(a));
  run(root, 'remap', 'docs/doc2.md', '--write');
  assert(readFileSync(join(root, 'docs/doc2.md'), 'utf-8') === fresh, 'il ripiego non va applicato senza --accept-fallback');
  run(root, 'remap', 'docs/doc2.md', '--write', '--accept-fallback');
  const after = readFileSync(join(root, 'docs/doc2.md'), 'utf-8');
  assert(after.includes(`{ path: src/b.ts, verified: { commit: '${b.newCommit}'`), 'candidato unico non applicato');
  assert(after.includes(`{ path: src/a.ts, symbol: f, verified: { commit: '${A}'`), 'con più candidati non si applica nulla');
});

test('remap: errori d\'uso → exit 2; il codice non è mai toccato', () => {
  assert(run(root, 'remap', 'docs/doc.md', '--commit-map', join(root, 'manca')).code === 2, 'mappa mancante → 2');
  assert(run(root, 'remap', 'docs/doc.md', '--accept-fallback').code === 2, '--accept-fallback senza --write → 2');
  assert(git(root, 'status', '--porcelain', '--', 'src') === '', 'il codice è stato toccato');
});

rmSync(root, { recursive: true, force: true });
rmSync(join(root, '..', `${root.split('/').pop()}-replace.txt`), { force: true });

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
