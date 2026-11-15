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

test('status active/draft prevale sul path (0.6-z37, D); doc datati con «Stato: da inviare» in testa (C); data compatta', () => {
  const r2 = join(base, 'app2');
  const fm = (st) => `---\nmr_version: '0.6'\nid: a/x\ntitle: "T"\ntype: guide\nowner: a\nstatus: ${st}\ncreated: '2026-01-01'\nlast_updated: '2026-01-01'\n---\n\n# T\n`;
  write(r2, 'docs/hof-solo-1.md', fm('active'));
  write(r2, 'docs/hof-app-2.md', fm('done'));
  write(r2, 'docs/piani/piano-a.md', fm('draft'));
  write(r2, 'docs/2026-10-01-richiesta.md', '# Richiesta\n\n**Stato:** da inviare\n');
  write(r2, 'docs/2026-10-02-nota.md', '# Nota\n\nStato: chiusa\n');
  write(r2, 'docs/hof-app-3.md', '# H\n\nStato: in corso\n');
  write(r2, 'docs/esito-20261012/riepilogo.md', '# Esito\n');
  write(r2, 'docs/esito-20261013/aperto.md', fm('active'));
  write(r2, 'test-files/nota.md', fm('active'));
  execFileSync('git', ['init', '-q', r2]);
  const v = JSON.parse(run(r2, 'vivi', '.', '--json').out);
  const vivi = v.items.map((x) => x.doc).sort();
  assert(JSON.stringify(vivi) === JSON.stringify(['docs/2026-10-01-richiesta.md', 'docs/esito-20261013/aperto.md', 'docs/hof-solo-1.md', 'docs/piani/piano-a.md']), vivi.join(', '));
  const mot = Object.fromEntries(v.non_vivi.map((n) => [n.doc, n.motivo]));
  assert(mot['docs/esito-20261012/riepilogo.md'] === 'datato' && mot['docs/hof-app-3.md'] === 'hof-*' && mot['test-files/nota.md'] === 'fixture di test', `«Stato:» vale solo per i datati, mai per le fixture: ${JSON.stringify(mot)}`);
});

test('solo l\'ultimo hof di ogni agente è vivo (0.6-z38); generato_da toglie un log dai vivi, status active compreso', () => {
  const r3 = join(base, 'app3');
  const fm = (st, extra = '') => `---\nmr_version: '0.6'\nid: a/x\ntitle: "T"\ntype: log\nowner: a\nstatus: ${st}\ncreated: '2026-01-01'\nlast_updated: '2026-01-01'\n${extra}---\n\n# T\n`;
  for (const n of ['hof-zeta-9', 'hof-zeta-10', 'hof_zeta_X8']) write(r3, `h/${n}.md`, fm('active'));
  write(r3, 'h/hof-zeta-mc-1.md', fm('active')); // altro agente: zeta-mc
  write(r3, 'h/hof-beta-6B.md', fm('active'));
  write(r3, 'h/hof-beta-7F.md', fm('active'));
  write(r3, 'altro/hof-zeta-2.md', fm('active')); // altra cartella: altro gruppo
  write(r3, 'h/hof-gamma.md', fm('active'));
  write(r3, 'h/hof-gamma-1.md', fm('active'));
  write(r3, 'log/cron-2026.md', fm('active', 'generato_da: cron\n'));
  write(r3, 'log/a-mano.md', fm('active'));
  write(r3, 'log/vuoto.md', fm('active', 'generato_da: ""\n'));
  execFileSync('git', ['init', '-q', r3]);
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  execFileSync('git', ['-C', r3, 'add', 'h/hof-gamma.md'], { env });
  execFileSync('git', ['-C', r3, 'commit', '-q', '-m', 'a', '--date', '2026-01-01T00:00:00'], { env: { ...env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00' } });
  execFileSync('git', ['-C', r3, 'add', 'h/hof-gamma-1.md'], { env });
  execFileSync('git', ['-C', r3, 'commit', '-q', '-m', 'b'], { env });
  const v = JSON.parse(run(r3, 'vivi', '.', '--json').out);
  const vivi = v.items.map((x) => x.doc).sort();
  assert(JSON.stringify(vivi) === JSON.stringify(['altro/hof-zeta-2.md', 'h/hof-beta-7F.md', 'h/hof-gamma-1.md', 'h/hof-zeta-10.md', 'h/hof-zeta-mc-1.md', 'log/a-mano.md', 'log/vuoto.md']), vivi.join(', '));
  const mot = Object.fromEntries(v.non_vivi.map((n) => [n.doc, n.motivo]));
  assert(mot['h/hof-zeta-9.md'] === 'hof superato da hof-zeta-10.md' && mot['h/hof_zeta_X8.md'] === 'hof superato da hof-zeta-10.md', JSON.stringify(mot));
  assert(mot['h/hof-beta-6B.md'] === 'hof superato da hof-beta-7F.md', 'lettere dietro il numero');
  assert(mot['h/hof-gamma.md'] === 'hof superato da hof-gamma-1.md', 'senza numero: vale la data di commit');
  assert(mot['log/cron-2026.md'] === 'generato_da: cron' && v.meta.non_vivi.generato === 1, JSON.stringify(v.meta.non_vivi));
});

test('regola storico: della allow-list centrale per cartelle di log automatici (equivale alla forma log: proposta)', () => {
  const r4 = join(base, 'app4');
  write(r4, 'docs/monitor/oggi.md', '# Log del monitor\n');
  write(r4, 'docs/guida.md', '# Guida\n');
  execFileSync('git', ['init', '-q', r4]);
  const cen = join(base, 'cen4');
  write(cen, 'app4.ignore', 'storico:docs/monitor/*\n');
  const v = JSON.parse(run(r4, 'vivi', '.', '--json', '--ignore-dir', cen, '--workspace', 'app4').out);
  assert(v.items.map((x) => x.doc).join() === 'docs/guida.md' && v.non_vivi[0].motivo === 'regola storico:', JSON.stringify(v.non_vivi));
});

rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
