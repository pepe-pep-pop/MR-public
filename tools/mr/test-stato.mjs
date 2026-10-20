#!/usr/bin/env node
/**
 * test-stato.mjs — `mr stato` (0.6-z11, M3): livello del repo con MR e prossimo passo.
 * Invocazione: node tools/mr/test-stato.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { livello, haRegola, nelGiro } from './lib/stato.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const write = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c, 'utf-8'); };
const run = (cwd, ...a) => { const r = spawnSync(process.execPath, [MR, ...a], { cwd, encoding: 'utf-8' }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ✅ ${name}`); } catch (err) { results.push(false); console.log(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\ntest-stato.mjs\n');

const base = { vivi: 10, conFrontmatter: 0, principali: [{ doc: 'README.md', frontmatter: false }], erroriValidate: 0, regola: null, giro: false };

test('livelli in ordine: 0, poi 1, 2, 3; si ferma al primo criterio non soddisfatto', () => {
  const l0 = livello(base);
  assert(l0.livello === 0 && l0.verso === 1 && /mr-tag/.test(l0.prossimo), JSON.stringify(l0));
  // frontmatter sul README ma validatore a 3 errori e nessuna regola: ancora 0, con due cose che mancano
  const l0b = livello({ ...base, conFrontmatter: 2, principali: [{ doc: 'README.md', frontmatter: true }], erroriValidate: 3 });
  assert(l0b.livello === 0 && l0b.mancano.length === 2 && /0 errori \(ora 3\)/.test(l0b.prossimo), JSON.stringify(l0b));
  const ok = { ...base, conFrontmatter: 3, principali: [{ doc: 'README.md', frontmatter: true }], regola: 'CLAUDE.md' };
  const l1 = livello(ok);
  assert(l1.livello === 1 && l1.verso === 2 && /altri 7 doc vivi/.test(l1.prossimo) && /30%/.test(l1.mancano[0]), JSON.stringify(l1));
  const l2 = livello({ ...ok, conFrontmatter: 8 });
  assert(l2.livello === 2 && l2.verso === 3 && /arch/.test(l2.prossimo), JSON.stringify(l2));
  const l3 = livello({ ...ok, conFrontmatter: 10, giro: true });
  assert(l3.livello === 3 && l3.verso === null && !l3.mancano.length, JSON.stringify(l3));
});

test('«nel giro» non alza il livello da solo (0.6-z12): senza frontmatter resta 0, con il 30% resta 1', () => {
  // il caso del rilievo: nel giro, nessun doc con frontmatter
  const senza = livello({ ...base, giro: true });
  assert(senza.livello === 0 && senza.verso === 1 && senza.nelGiro === true && /README e su 2-4 doc/.test(senza.prossimo), JSON.stringify(senza));
  const ok = { ...base, conFrontmatter: 3, principali: [{ doc: 'README.md', frontmatter: true }], regola: 'CLAUDE.md', giro: true };
  const l1 = livello(ok);
  assert(l1.livello === 1 && l1.verso === 2, `nel giro con il 30% dei doc vivi: ${JSON.stringify(l1)}`);
  // ogni combinazione di copertura: il livello non supera mai quello che la copertura permette
  for (const [vivi, con, atteso] of [[10, 0, 0], [10, 1, 1], [10, 7, 1], [10, 8, 3], [10, 10, 3], [0, 0, 0]]) {
    const r = livello({ ...base, vivi, conFrontmatter: con, principali: [{ doc: 'README.md', frontmatter: con > 0 }], regola: 'CLAUDE.md', giro: true });
    assert(r.livello === atteso, `${con}/${vivi} vivi, nel giro: livello ${r.livello}, atteso ${atteso}`);
  }
  const n = livello({ ...base, conFrontmatter: 9, principali: [{ doc: 'README.md', frontmatter: true }], regola: 'x', giro: null });
  assert(n.livello === 2 && /indice di arch non trovato/.test(n.mancano[0]), JSON.stringify(n));
});

test('regola e giro: riconoscimento', () => {
  assert(haRegola('## MR segnala, non blocca\n') && haRegola('mr segnala non blocca') && !haRegola('MR blocca'), 'haRegola');
  const ws = [{ path: '/a/ws', attivo: true }, { path: '/a/vecchio', attivo: false }];
  assert(nelGiro('/a/ws', ws) && nelGiro('/a/ws/sub/repo', ws) && !nelGiro('/a/wsx', ws) && !nelGiro('/a/vecchio/r', ws), 'nelGiro');
});

// repo vero: README taggato, un doc no, regola nel CLAUDE.md, indice finto
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-stato-test-')));
execFileSync('git', ['init', '-q', root]);
const fm = (id) => `---\nmr_version: '0.6'\nid: prova/${id}\ntitle: "${id}"\ntype: reference\nowner: "prova"\nstatus: active\ncreated: '2026-10-01'\nlast_updated: '2026-10-18'\n---\n\n# ${id}\n`;
write(root, 'README.md', fm('readme'));
write(root, 'docs/uso.md', '# Uso\n\nSenza frontmatter.\n');
write(root, 'src/app.ts', 'const t = process.env.API_TOKEN;\n');
write(root, 'CLAUDE.md', fm('claude') + '\n## MR segnala, non blocca\n\nLa task viene prima.\n');
execFileSync('git', ['-C', root, 'add', '-A']);
const indice = join(root, '..', `indice-${process.pid}.md`);
writeFileSync(indice, `| \`altro\` | software | \`/non/esiste\` | x |\n`);

test('CLI: livello, tabella, riga «non blocca», exit 0, sola lettura', () => {
  const r = run(root, 'stato', '--indice', indice);
  assert(r.code === 0, `exit ${r.code} ${r.err}`);
  assert(r.out.includes('MR segnala, non blocca') && /\*\*Livello 1 — doc principali\*\*, verso il livello 2/.test(r.out), r.out.slice(0, 600));
  assert(/2 su 3 \(67%/.test(r.out) && /`README\.md` ✅/.test(r.out) && /0 errori/.test(r.out) && /CLAUDE\.md`/.test(r.out), 'tabella');
  const j = JSON.parse(run(root, 'stato', '--indice', indice, '--format', 'json').out);
  assert(j.livello === 1 && j.verso === 2 && j.giro === false && j.env.letti === 1 && j.env.non_elencati === 1, JSON.stringify(j));
  assert(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf-8' }).split('\n').filter(Boolean).every((l) => l.startsWith('A ')), 'nessun file cambiato');
  assert(run(root, 'stato', '--write').code === 2, '--write rifiutato');
  assert(run(root, 'claims', '.', '--indice', indice).code === 2, '--indice solo per stato');
});

test('CLI: nel giro con l\'indice; --rev senza validatore', () => {
  writeFileSync(indice, `| \`prova\` | software | \`${root}\` | x |\n`);
  const j = JSON.parse(run(root, 'stato', '--indice', indice, '--format', 'json').out);
  // nel giro con 2 doc vivi su 3 (67%): livello 1, non 3 (0.6-z12)
  assert(j.livello === 1 && j.verso === 2 && j.giro === true && j.workspace === 'prova', JSON.stringify(j));
  const md = run(root, 'stato', '--indice', indice).out;
  assert(/già nel giro di arch, ma il livello 3 chiede prima i livelli 1 e 2/.test(md), 'il markdown dice che è nel giro ma non al livello 3');
  execFileSync('git', ['-C', root, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'uno']);
  const r = JSON.parse(run(root, 'stato', '--rev', 'HEAD', '--indice', indice, '--format', 'json').out);
  assert(r.validate === null && r.rev === 'HEAD', JSON.stringify(r));
});

test('CLI: repo senza nessun frontmatter, anche se è nel giro: livello 0 (0.6-z12)', () => {
  const nu = realpathSync(mkdtempSync(join(tmpdir(), 'mr-stato-test-')));
  execFileSync('git', ['init', '-q', nu]);
  write(nu, 'README.md', '# Progetto\n\nSenza frontmatter.\n');
  write(nu, 'docs/a.md', '# A\n');
  execFileSync('git', ['-C', nu, 'add', '-A']);
  const ind = join(nu, '..', `indice-nu-${process.pid}.md`);
  writeFileSync(ind, `| \`nu\` | software | \`${nu}\` | x |\n`);
  const j = JSON.parse(run(nu, 'stato', '--indice', ind, '--format', 'json').out);
  assert(j.giro === true && j.con_frontmatter === 0 && j.livello === 0 && j.verso === 1, JSON.stringify(j));
  const md = run(nu, 'stato', '--indice', ind).out;
  assert(/\*\*Livello 0 — fotografia\*\*, verso il livello 1/.test(md) && !/Livello 3/.test(md), md.slice(0, 500));
  rmSync(nu, { recursive: true, force: true });
  rmSync(ind, { force: true });
});

rmSync(root, { recursive: true, force: true });
rmSync(indice, { force: true });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} pass\n`);
process.exit(ok === results.length ? 0 : 1);
