#!/usr/bin/env node
/**
 * test-date.mjs — `mr date <doc|dir> [--redazioni <f>] [--rev]` (MR 0.6-z): created e last_updated da
 * git per il frontmatter. Controlla: commit di redazione saltati per sha e per messaggio, commit a
 * testo invariato (solo frontmatter) saltati, il commit di creazione che conta sempre, il rename seguito,
 * il confronto col frontmatter, --rev, i rifiuti (riga non valida, --write, --redazioni fuori da date);
 * commit d'importazione `import:` (0.6-z2, caso portale-b): date dal testo, o sconosciute.
 *
 * Invocazione: node tools/mr/test-date.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseRedazioni, dateDaCommit, corpo, dataNelTesto } from './lib/date.mjs';

const MR = join(dirname(fileURLToPath(import.meta.url)), 'mr.mjs');
function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}
const run = (cwd, ...a) => { const r = spawnSync(process.execPath, [MR, ...a], { cwd, encoding: 'utf-8' }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };
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

console.log('\ntest-date.mjs\n');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-date-')));
execFileSync('git', ['init', '-q', root]);
const commit = (date, msg) => {
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00`, GIT_COMMITTER_DATE: `${date}T12:00:00` } });
  return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
};
const FM = (id, lu) => `---\nmr_version: '0.6'\nid: ${id}\ntitle: T\ntype: guide\nowner: app\nstatus: active\ncreated: '2026-01-01'\nlast_updated: '${lu}'\n---\n`;

write(root, 'docs/a.md', '# A\n\nUno.\n');
write(root, 'docs/b.md', '# B\n\nUno.\n');
const C = '# C\n\n' + 'Una riga di testo abbastanza lunga perché git riconosca il rename.\n'.repeat(8);
write(root, 'docs/c.md', C);
write(root, 'docs/g.md', C.replace('# C', '# G'));
commit('2026-01-01', 'docs: primi doc');
write(root, 'docs/a.md', '# A\n\nUno. Due.\n');
commit('2026-02-01', 'docs: a aggiornato');
renameSync(join(root, 'docs/c.md'), join(root, 'docs/d.md'));
write(root, 'docs/d.md', C + 'Spostato.\n');
mkdirSync(join(root, 'docs/archivio'));
renameSync(join(root, 'docs/g.md'), join(root, 'docs/archivio/g.md'));
commit('2026-05-01', 'docs: c diventa d');
write(root, 'docs/a.md', '# A\n\nUno. Due. [nome redatto]\n');
write(root, 'docs/e.md', '# E\n\nNato nella redazione.\n');
const red = commit('2026-10-03', 'chore: dati tolti');
write(root, 'docs/b.md', '# B\n\nUno. [redatto]\n');
commit('2026-10-03', 'chore(privacy) Redazione residui');
write(root, 'docs/a.md', FM('app/a', '2026-02-01') + '\n# A\n\nUno. Due. [nome redatto]\n');
write(root, 'docs/b.md', FM('app/b', '2026-10-03') + '\n# B\n\nUno. [redatto]\n');
commit('2026-10-13', 'docs: frontmatter MR');
write(root, 'mr.redazioni', `# commit di sola redazione\n${red.slice(0, 8)}  # 03/10\nmessaggio: redazione residui\n`);

const date = (args = []) => JSON.parse(run(root, 'date', 'docs', '--format', 'json', ...args).out);
const by = (res, doc) => res.items.find((x) => x.doc === doc);

test('redazione per sha e frontmatter saltati: last_updated è l\'ultimo commit che cambia il testo', () => {
  const a = by(date(), 'docs/a.md');
  assert(a.created === '2026-01-01' && a.ultimo === '2026-10-13' && a.last_updated === '2026-02-01', JSON.stringify(a));
  assert(a.saltati.map((c) => c.motivo).join(',') === 'testo invariato,redazione', JSON.stringify(a.saltati));
  assert(a.fm_last_updated === '2026-02-01', 'frontmatter letto');
});

test('redazione per messaggio (maiuscole indifferenti); solo commit saltati → last_updated = created, e il frontmatter diverso si vede', () => {
  const res = run(root, 'date', 'docs');
  const b = by(date(), 'docs/b.md');
  assert(b.last_updated === '2026-01-01' && b.tutti_saltati, JSON.stringify(b));
  assert(/\| docs\/b\.md \| app\/b \| 2026-01-01 \| 2026-10-13 \| 2026-01-01 \| git \| 2026-10-03 ⚠ diverso \|/.test(res.out), res.out);
  assert(/Doc con commit saltati: 3 \(di redazione: 2\) · frontmatter con last_updated diverso: 1\./.test(res.out), res.out);
});

test('il commit che crea il file conta sempre, anche se è di redazione; il rename si segue; lo spostamento puro non conta', () => {
  const r = date();
  const e = by(r, 'docs/e.md');
  assert(e.created === '2026-10-03' && e.last_updated === '2026-10-03' && !e.saltati.length, JSON.stringify(e));
  const d = by(r, 'docs/d.md');
  assert(d.created === '2026-01-01' && d.last_updated === '2026-05-01', JSON.stringify(d));
  // spostato senza cambiare il testo: lo spostamento non è un aggiornamento
  const g = by(r, 'docs/archivio/g.md');
  assert(g.created === '2026-01-01' && g.ultimo === '2026-05-01' && g.last_updated === '2026-01-01' && g.saltati[0].motivo === 'testo invariato', JSON.stringify(g));
});

test('senza mr.redazioni: la redazione conta, il frontmatter no; --redazioni da un altro file; --rev', () => {
  const vuoto = join(root, '..', `vuoto-${Date.now()}.txt`);
  writeFileSync(vuoto, '# nessuna\n');
  const a = by(date(['--redazioni', vuoto]), 'docs/a.md');
  rmSync(vuoto);
  assert(a.last_updated === '2026-10-03' && a.saltati.map((c) => c.motivo).join(',') === 'testo invariato', JSON.stringify(a));
  const prima = by(date(['--rev', 'HEAD~1']), 'docs/a.md');
  assert(prima.ultimo === '2026-10-03' && prima.last_updated === '2026-02-01' && prima.fm_last_updated === null, JSON.stringify(prima));
});

test('rifiuta: riga non valida in mr.redazioni, --write, --redazioni fuori da date, file assente; non scrive', () => {
  const prima = readFileSync(join(root, 'docs/a.md'), 'utf-8');
  assert(run(root, 'date', 'docs', '--write').code === 2, '--write → 2');
  assert(run(root, 'scan', 'docs', '--redazioni', 'mr.redazioni').code === 2, '--redazioni con scan → 2');
  assert(run(root, 'date', 'docs', '--redazioni', 'non-esiste.txt').code === 2, 'file assente → 2');
  write(root, 'mr.redazioni', 'abc\n');
  const r = run(root, 'date', 'docs');
  assert(r.code === 2 && /riga 1: né uno sha/.test(r.err), r.err);
  assert(readFileSync(join(root, 'docs/a.md'), 'utf-8') === prima, 'date ha scritto un doc');
});

// repo nato da un import (0.6-z2), come portale-b: tutti i doc entrano il 03/09 con un solo commit
const imp = realpathSync(mkdtempSync(join(tmpdir(), 'mr-date-import-')));
execFileSync('git', ['init', '-q', imp]);
const commitIn = (date, msg) => {
  execFileSync('git', ['-C', imp, 'add', '-A']);
  execFileSync('git', ['-C', imp, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg], { env: { ...process.env, GIT_AUTHOR_DATE: `${date}T12:00:00`, GIT_COMMITTER_DATE: `${date}T12:00:00` } });
  return execFileSync('git', ['-C', imp, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
};
write(imp, 'docs/a.md', '# A\n\n**Data:** 2026-05-12\n\nTesto.\n');
write(imp, 'docs/b.md', '# B\n\nData: 2026-04-01 ore ~10:00\nLast updated: 12/06/2026 (post-audit)\n\nTesto.\n');
write(imp, 'docs/c.md', '# C\n\nNessuna data.\n');
write(imp, 'docs/d.md', '# D\n\n> Data: 2026-03-01\n\nUno.\n');
write(imp, 'docs/e.md', "---\nmr_version: '0.6'\nid: o/e\ntitle: E\ntype: guide\nowner: o\nstatus: active\ncreated: '2026-09-03'\nlast_updated: '2026-09-03'\n---\n\n# E\n\nSenza data.\n");
write(imp, 'docs/f.md', '# F\n\nData: 2026-02-30\n');
write(imp, 'docs/h.md', '# H\n\nSenza data.\n');
const impSha = commitIn('2026-09-03', 'chore: il repo diventa autonomo');
write(imp, 'docs/d.md', '# D\n\n> Data: 2026-03-01\n\nUno. Due.\n');
write(imp, 'docs/g.md', '# G\n\nData: 2026-01-01\n');
write(imp, 'docs/h.md', '# H\n\nSenza data. Aggiornato.\n');
commitIn('2026-09-11', 'docs: d aggiornato, g nuovo');
write(imp, 'mr.redazioni', `# repo nato da un import\nimport: ${impSha.slice(0, 7)}  # 03/09\n`);
const dateImp = () => JSON.parse(run(imp, 'date', 'docs', '--format', 'json').out);

test('import (0.6-z2): per i doc nati nell\'import le date vengono dal testo; Data → created, Last updated → last_updated', () => {
  const r = dateImp();
  const a = by(r, 'docs/a.md');
  assert(a.created === '2026-05-12' && a.last_updated === '2026-05-12' && a.fonte === 'testo' && a.import === impSha.slice(0, 7), JSON.stringify(a));
  const b = by(r, 'docs/b.md');
  assert(b.created === '2026-04-01' && b.last_updated === '2026-06-12', JSON.stringify(b));
  const d = by(r, 'docs/d.md');
  assert(d.created === '2026-03-01' && d.last_updated === '2026-09-11' && d.fonte === 'testo + git', `un commit dopo l'import conta: ${JSON.stringify(d)}`);
  const g = by(r, 'docs/g.md');
  assert(g.created === '2026-09-11' && g.fonte === 'git' && !g.import, `un doc nato dopo l'import usa git: ${JSON.stringify(g)}`);
  const h = by(r, 'docs/h.md');
  assert(h.created === null && h.last_updated === '2026-09-11' && h.fonte === 'git, creazione sconosciuta', `aggiornato dopo l'import, senza data nel testo: ${JSON.stringify(h)}`);
});

test('import senza data nel testo (o data non valida): sconosciuta, e il frontmatter non è «diverso»', () => {
  const r = dateImp();
  for (const doc of ['docs/c.md', 'docs/e.md', 'docs/f.md']) {
    const x = by(r, doc);
    assert(x.created === null && x.last_updated === null && x.fonte === 'import, nessuna data nel testo', JSON.stringify(x));
  }
  const md = run(imp, 'date', 'docs').out;
  assert(/\| docs\/e\.md \| o\/e \| \? \(sconosciuta\) \| 2026-09-03 \| \? \(sconosciuta\) \| import, nessuna data nel testo \(import [0-9a-f]{7}\) \| 2026-09-03 \|/.test(md), md);
  assert(/frontmatter con last_updated diverso: 0 · nati in un import: 7 \(date dal testo: 3, sconosciute: 4\)\./.test(md), md);
});

test('senza la riga import: le date dell\'import restano quelle di git; «import:» con uno sha non valido → 2', () => {
  write(imp, 'mr.redazioni', '# vuoto\n');
  const a = by(dateImp(), 'docs/a.md');
  assert(a.created === '2026-09-03' && a.fonte === 'git', JSON.stringify(a));
  write(imp, 'mr.redazioni', 'import: xyz\n');
  const r = run(imp, 'date', 'docs');
  assert(r.code === 2 && /«import:» vuole uno sha/.test(r.err), r.err);
  rmSync(imp, { recursive: true, force: true });
});

test('funzioni pure: parseRedazioni, corpo, dateDaCommit', () => {
  const p = parseRedazioni('# c\nABCDEF12 # x\nmessaggio: Privacy #2\n\n');
  assert(p.sha[0] === 'abcdef12' && p.messaggi[0] === 'privacy #2' && !p.errori.length, JSON.stringify(p));
  assert(corpo('---\na: 1\n---\n\n# T\n') === '# T\n' && corpo('# T\n') === '# T\n', 'corpo');
  assert(dateDaCommit([], p).last_updated === null, 'nessun commit');
  assert(parseRedazioni('import: 0c40919 # 03/09\n').import[0] === '0c40919', 'import');
  const t = dataNelTesto('---\na: 1\n---\n# T\n\n- **Date**: 01/02/2026\n- Ultimo aggiornamento: 2026-03-04\n');
  assert(t.creata === '2026-02-01' && t.aggiornata === '2026-03-04', JSON.stringify(t));
  assert(dataNelTesto('# T\n\nLe date cliente: 2026-01-01\n').creata === null, 'etichetta che non è una data del doc');
  assert(dataNelTesto('# T\n\n> Scritto: 2026-05-20, dopo la call 2.\n').creata === '2026-05-20' && dataNelTesto('# T\n\nGenerato: 2026-06-01\n').creata === '2026-06-01', 'Scritto e Generato (portale-b)');
});

rmSync(root, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
