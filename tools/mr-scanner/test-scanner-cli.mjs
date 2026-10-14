#!/usr/bin/env node
/**
 * test-scanner-cli.mjs — test di mr-scanner da riga di comando (MR v0.5.1)
 *
 * Costruisce in una cartella temporanea un repo git di prova:
 *
 *   outer/
 *     matrix.md                ← matrix di un "altro progetto", sopra la root del repo
 *     repo/                    ← git init
 *       .gitignore             ← ignora ignorata/
 *       docs/a.md, docs/b.md   ← doc MR (b depends_on a)
 *       node_modules/x.md      ← escluso
 *       dist/y.md, build/y.md  ← esclusi
 *       .nascosta/z.md         ← escluso
 *       ignorata/w.md          ← escluso dal .gitignore
 *       annidato/.git, n.md    ← repo annidato, escluso
 *
 * e controlla: sola lettura senza --write, esclusioni di default, matrix.md
 * cercato solo fino alla root del repo (rilievo S4), profilo light, profilo full.
 *
 * Invocazione: node test-scanner-cli.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { normalizeBodyForHash } from './mr-scanner.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const SCANNER = join(here, 'mr-scanner.mjs');

const MATRIX = `---
mr_version: '0.5'
id: test/matrix
title: Matrix di prova
type: spec
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
---
# Matrix

<!-- MR-REGISTRY-START -->

| vecchia tabella |

<!-- MR-REGISTRY-END -->
`;

const doc = (id, extra = '') => `---
mr_version: '0.5'
id: ${id}
title: Doc ${id}
type: explanation
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
${extra}---

# ${id}
`;

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function buildFixture({ withMatrixInRepo }) {
  const outer = realpathSync(mkdtempSync(join(tmpdir(), 'mr-scanner-test-')));
  const repo = join(outer, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q', repo]);
  write(join(outer, 'matrix.md'), MATRIX);
  if (withMatrixInRepo) write(join(repo, 'matrix.md'), MATRIX);
  write(join(repo, '.gitignore'), 'ignorata/\n');
  write(join(repo, 'docs/a.md'), doc('test/a'));
  write(join(repo, 'docs/b.md'), doc('test/b', 'depends_on:\n  - id: test/a\n    reason: usa a\n'));
  for (const p of ['node_modules/x.md', 'dist/y.md', 'build/y.md', '.nascosta/z.md', 'ignorata/w.md']) {
    write(join(repo, p), doc(`test/escluso-${p.split('/')[0].replace('.', '')}`));
  }
  execFileSync('git', ['init', '-q', join(repo, 'annidato')]);
  write(join(repo, 'annidato/n.md'), doc('test/annidato'));
  return { outer, repo };
}

/** sha256 di tutti i file sotto dir (escluso .git): mappa path relativo → hash */
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
  return out;
}

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [SCANNER, ...args], { cwd, encoding: 'utf-8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const results = [];
const cleanup = [];
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

console.log('\ntest-scanner-cli.mjs\n');

test('senza --write: nessun file modificato o creato', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  const before = snapshot(outer);
  const { code, out } = run(repo, '.');
  assert(code === 0, `exit atteso 0, ottenuto ${code}\n${out}`);
  assert(out.includes('[DRY-RUN]'), 'atteso banner DRY-RUN');
  assert(JSON.stringify(snapshot(outer)) === JSON.stringify(before), 'il filesystem è cambiato');
  assert(!existsSync(join(repo, 'mr-status.json')), 'mr-status.json creato senza --write');
});

test('--dry-run esplicito: come il default', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  const before = snapshot(outer);
  const { code } = run(repo, '.', '--dry-run');
  assert(code === 0, `exit atteso 0, ottenuto ${code}`);
  assert(JSON.stringify(snapshot(outer)) === JSON.stringify(before), 'il filesystem è cambiato');
});

test('esclusioni di default: solo matrix.md, docs/a.md, docs/b.md', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  const { out } = run(repo, '.');
  assert(out.includes('File .md raccolti: 3'), `attesi 3 file\n${out}`);
  for (const escluso of ['escluso-node_modules', 'escluso-dist', 'escluso-build', 'escluso-nascosta', 'escluso-ignorata', 'test/annidato']) {
    assert(!out.includes(escluso), `file escluso presente nell'output: ${escluso}`);
  }
});

test('esclusioni anche fuori da un repo git (walk del filesystem)', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  rmSync(join(repo, '.git'), { recursive: true, force: true });
  const { out } = run(repo, '.');
  // senza repo il .gitignore non vale: ignorata/w.md entra, il resto resta escluso
  assert(out.includes('File .md raccolti: 4'), `attesi 4 file\n${out}`);
  assert(out.includes('escluso-ignorata'), 'fuori da un repo il .gitignore non si applica');
  assert(!out.includes('test/annidato'), 'repo annidato non escluso');
});

test('matrix.md sopra la root del repo: non trovato, mai riscritto (S4)', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: false });
  cleanup.push(outer);
  const outerMatrix = readFileSync(join(outer, 'matrix.md'), 'utf-8');
  const { code, out } = run(repo, 'docs', '--write');
  assert(code === 0, `exit atteso 0, ottenuto ${code}\n${out}`);
  assert(out.includes('matrix.md non trovato'), `atteso "matrix.md non trovato"\n${out}`);
  assert(readFileSync(join(outer, 'matrix.md'), 'utf-8') === outerMatrix, 'matrix.md esterno riscritto');
  assert(!existsSync(join(outer, 'mr-status.json')), 'mr-status.json scritto fuori dal repo');
});

test('--write --profile light: doc intatti, registry e mr-status.json scritti, required_by calcolato', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  const a = readFileSync(join(repo, 'docs/a.md'), 'utf-8');
  const b = readFileSync(join(repo, 'docs/b.md'), 'utf-8');
  const { code, out } = run(repo, '.', '--write', '--profile', 'light');
  assert(code === 0, `exit atteso 0, ottenuto ${code}\n${out}`);
  assert(readFileSync(join(repo, 'docs/a.md'), 'utf-8') === a, 'docs/a.md modificato');
  assert(readFileSync(join(repo, 'docs/b.md'), 'utf-8') === b, 'docs/b.md modificato');
  const matrix = readFileSync(join(repo, 'matrix.md'), 'utf-8');
  assert(matrix.includes('`test/a`') && matrix.includes('`docs/b.md`'), 'registry non rigenerato');
  assert(!matrix.includes('vecchia tabella'), 'vecchia tabella non sostituita');
  const status = JSON.parse(readFileSync(join(repo, 'mr-status.json'), 'utf-8'));
  assert(JSON.stringify(status.files['test/a'].required_by) === '["test/b"]', 'required_by calcolato errato');
});

test('--write (profilo full): campi _* scritti nei doc', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  const { code, out } = run(repo, '.', '--write');
  assert(code === 0, `exit atteso 0, ottenuto ${code}\n${out}`);
  assert(readFileSync(join(repo, 'docs/a.md'), 'utf-8').includes("_content_hash: 'sha256:"), '_content_hash non scritto');
  // i file esclusi restano intatti
  assert(!readFileSync(join(repo, 'node_modules/x.md'), 'utf-8').includes('_content_hash'), 'scritto dentro node_modules');
  assert(!readFileSync(join(repo, 'annidato/n.md'), 'utf-8').includes('_content_hash'), 'scritto dentro il repo annidato');
});

test('ancore mr:code escluse dall\'hash (nota A2), come in mr-validate', () => {
  const base = '# T\n\nTesto.\n';
  const conAncora = '# T\n\n<!-- mr:code path=src/a.ts verified=1111111 -->\nTesto.\n';
  const altroVerified = '# T\n\n<!-- mr:code path=src/a.ts verified=2222222 -->\nTesto.\n';
  const inLinea = '# T\n\nTesto.<!-- mr:code path=src/a.ts -->\n';
  const h = (t) => normalizeBodyForHash(t);
  assert(h(conAncora) === h(base), 'un\'ancora su riga propria cambia l\'hash');
  assert(h(altroVerified) === h(conAncora), 'cambiare verified= cambia l\'hash');
  assert(h(inLinea) === h(base), 'un\'ancora in linea cambia l\'hash');
  assert(h('# T\n\nAltro testo.\n') !== h(base), 'un cambio vero del testo deve cambiare l\'hash');
  // stesso hash calcolato da mr-validate
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  write(join(repo, 'docs/ancora.md'), doc('test/ancora').replace('# test/ancora\n', '# test/ancora\n\n<!-- mr:code path=x.ts verified=1234567 -->\nTesto.\n'));
  const scan = run(repo, 'docs/ancora.md');
  const val = spawnSync(process.execPath, [join(here, '../mr-validate/mr-validate.mjs'), 'docs/ancora.md'], { cwd: repo, encoding: 'utf-8' }).stdout;
  const hs = scan.out.match(/_content_hash:\s+(sha256:[0-9a-f]+)/)?.[1];
  const hv = val.match(/_content_hash calcolato: (sha256:[0-9a-f]+)/)?.[1];
  assert(hs && hs === hv, `hash diversi: scanner ${hs}, validate ${hv}`);
});

test('flag in conflitto o sconosciuti: exit 2', () => {
  assert(run(here, '.', '--write', '--dry-run').code === 2, '--write --dry-run deve dare 2');
  assert(run(here, '.', '--profile', 'pesante').code === 2, 'profilo sconosciuto deve dare 2');
  assert(run(here, '.', '--force').code === 2, 'flag sconosciuto deve dare 2');
});

for (const dir of cleanup) rmSync(dir, { recursive: true, force: true });

test('frontmatter non leggibile (0.6-z3): un doc MR rotto è segnalato con la riga, contato nel riepilogo, exit 1', () => {
  const { outer, repo } = buildFixture({ withMatrixInRepo: true });
  cleanup.push(outer);
  // titolo di portale-b (handoff_sim-20.md) senza virgolette
  write(join(repo, 'docs/rotto.md'), doc('test/rotto').replace(/^title: .*$/m, 'title: Handoff — Simulatore: pausa 2.0 e pivot ad app iPhone nativa'));
  write(join(repo, 'docs/altro.md'), '---\nlayout: a: b\n---\n\n# Altro\n');
  const r = run(repo, 'docs');
  assert(r.code === 1, `exit atteso 1, ottenuto ${r.code}\n${r.out.slice(-1500)}`);
  assert(/❌ docs\/rotto\.md: frontmatter non leggibile \(riga \d+: /.test(r.out), r.out.slice(0, 1500));
  assert(/⚠️ +docs\/altro\.md: frontmatter non leggibile .*senza mr_version/.test(r.out), 'altro strumento: warning');
  assert(/Frontmatter non leggibile: +2 \(di doc MR: 1; saltati, non nel registry\)/.test(r.out), 'riepilogo assente');
});

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
