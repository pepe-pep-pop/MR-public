#!/usr/bin/env node
/**
 * test-vivi.mjs — `mr vivi [<repo|dir>]` (MR 0.6-z4): i doc vivi di un repo, gli stessi del giro, e
 * quali hanno il frontmatter MR. Controlla: storici per path, regole codice:/doc:/storico: del repo e
 * dell'allow-list centrale (--ignore-dir + --workspace), file di segreti, frontmatter non leggibile,
 * --senza-frontmatter, --json, --rev, rifiuti.
 *
 * Invocazione: node tools/mr/test-vivi.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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

console.log('\ntest-vivi.mjs\n');
const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-vivi-')));
const root = join(base, 'app');
const FM = (id) => `---\nmr_version: '0.6'\nid: ${id}\ntitle: "T"\ntype: guide\nowner: app\nstatus: active\ncreated: '2026-01-01'\nlast_updated: '2026-01-01'\n---\n\n# T\n`;
write(root, 'README.md', FM('app/readme'));
write(root, 'docs/guida.md', '# Guida\n');
write(root, 'docs/rotto.md', FM('app/rotto').replace('title: "T"', 'title: Runbook: opzione A'));
write(root, 'docs/hof-app-3.md', '# Handoff\n');
write(root, 'docs/2026-10-01-note.md', '# Note\n');
write(root, 'docs/piani/piano-q4.md', '# Piano\n');
write(root, 'input-reference/altro.md', '# Copia di un altro progetto\n');
write(root, 'docs/foundation.md', '# Descrive un altro repo\n');
write(root, 'docs/vecchio-dominio.md', '# Storico per regola centrale\n');
write(root, 'docs/SEGRETI.md', '# Doc sui segreti: è un .md, si legge (0.6-z5)\n');
write(root, 'config/SEGRETI.txt', 'non è un doc\n');
// cartella nascosta (es. .lovable/ di un altro strumento): il validatore non la legge, quindi nemmeno vivi
write(root, '.lovable/memory/index.md', '# Memoria di uno strumento\n');
write(root, 'mr.claims.ignore', 'codice:input-reference/*\ndoc:docs/foundation.md\n');
const central = join(base, 'mr-ignore');
write(central, 'app.ignore', 'storico:docs/vecchio-dominio.md\n');
execFileSync('git', ['init', '-q', root]);
execFileSync('git', ['-C', root, 'add', '-A']);
execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'doc']);
write(root, 'docs/nuovo.md', '# Non ancora committato\n');

const json = (...a) => JSON.parse(run(root, 'vivi', '.', '--json', ...a).out);

test('i vivi sono quelli del giro: fuori storici per path, codice:, doc:; dentro i file non committati e i .md con SEGRETI nel nome (0.6-z5)', () => {
  const r = json();
  const vivi = r.items.map((v) => v.doc).sort();
  assert(JSON.stringify(vivi) === JSON.stringify(['README.md', 'docs/SEGRETI.md', 'docs/guida.md', 'docs/nuovo.md', 'docs/rotto.md', 'docs/vecchio-dominio.md']), vivi.join(', '));
  const mot = Object.fromEntries(r.non_vivi.map((n) => [n.doc, n.motivo]));
  assert(mot['docs/hof-app-3.md'] === 'hof-*' && mot['docs/2026-10-01-note.md'] === 'datato' && /piani/.test(mot['docs/piani/piano-q4.md']), JSON.stringify(mot));
  assert(!vivi.includes('.lovable/memory/index.md') && !(r.non_vivi.some((n) => n.doc.startsWith('.lovable/'))), 'cartella nascosta: fuori come nel validatore');
  assert(mot['input-reference/altro.md'] === 'regola codice:' && mot['docs/foundation.md'] === 'regola doc:', JSON.stringify(mot));
});

test('frontmatter: sì, no, non leggibile; i conteggi nel riepilogo', () => {
  const r = json();
  const f = Object.fromEntries(r.items.map((v) => [v.doc, v.frontmatter]));
  assert(f['README.md'] === 'sì' && f['docs/guida.md'] === 'no' && f['docs/rotto.md'] === 'non leggibile', JSON.stringify(f));
  assert(r.meta.vivi === 6 && r.meta.con_frontmatter === 1 && r.meta.senza === 4 && r.meta.non_leggibile === 1, JSON.stringify(r.meta));
  const md = run(root, 'vivi').out;
  assert(/\*\*vivi: 6\*\* · con frontmatter MR: 1 · senza: 4 · frontmatter non leggibile: 1/.test(md) && /## Frontmatter non leggibile \(1\)\n\n- docs\/rotto\.md/.test(md), md);
});

test('allow-list centrale: --ignore-dir con --workspace aggiunge la regola storico:, come nel giro', () => {
  const r = json('--ignore-dir', central, '--workspace', 'app');
  assert(!r.items.some((v) => v.doc === 'docs/vecchio-dominio.md') && r.non_vivi.find((n) => n.doc === 'docs/vecchio-dominio.md').motivo === 'regola storico:', JSON.stringify(r.non_vivi));
  assert(r.meta.regole.length === 2 && r.meta.regole[1].endsWith('app.ignore'), JSON.stringify(r.meta.regole));
});

test('--senza-frontmatter: solo i doc da taggare (e quelli rotti); --rev legge un commit', () => {
  const md = run(root, 'vivi', '--senza-frontmatter').out;
  assert(md.includes('## Senza frontmatter (4)') && !md.includes('## Con frontmatter'), md);
  const j = json('--senza-frontmatter');
  assert(j.items.every((v) => v.frontmatter !== 'sì') && j.items.length === 5, JSON.stringify(j.vivi));
  const rev = json('--rev', 'HEAD');
  assert(!rev.items.some((v) => v.doc === 'docs/nuovo.md') && rev.meta.rev === 'HEAD', 'al commit il file non committato non c\'è');
});

test('una sottocartella; rifiuti: --ignore-dir senza --workspace, --senza-frontmatter fuori da vivi, cartella inesistente', () => {
  const sub = JSON.parse(run(root, 'vivi', 'docs', '--json').out);
  assert(sub.meta.cartella === 'docs' && !sub.items.some((v) => v.doc === 'README.md'), JSON.stringify(sub.meta));
  assert(run(root, 'vivi', '--ignore-dir', central).code === 2, '--ignore-dir senza --workspace → 2');
  assert(run(root, 'scan', 'docs', '--senza-frontmatter').code === 2, '--senza-frontmatter con scan → 2');
  assert(run(root, 'vivi', 'non-esiste').code === 2, 'cartella inesistente → 2');
});

test('JSON (0.6-z6, rilievo 4): stessa forma di `mr date --json`: meta + items con doc e id; vivi alias deprecato', () => {
  const v = json();
  const d = JSON.parse(run(root, 'date', 'docs', '--format', 'json').out);
  for (const r of [v, d]) assert(r.meta && Array.isArray(r.items) && r.items.every((x) => 'doc' in x && 'id' in x), JSON.stringify(Object.keys(r)));
  assert(v.items.find((x) => x.doc === 'docs/guida.md').id === null && v.items.find((x) => x.doc === 'README.md').id === 'app/readme', 'id null quando manca');
  assert(JSON.stringify(v.vivi) === JSON.stringify(v.items) && /usa items/.test(v.deprecato.vivi), 'alias vivi uguale a items, dichiarato deprecato');
});

rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
