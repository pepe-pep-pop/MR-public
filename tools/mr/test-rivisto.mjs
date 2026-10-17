#!/usr/bin/env node
/**
 * test-rivisto.mjs — `mr rivisto <doc> [--write] [--data]` (MR 0.6-y): doc riletto e ancora vero,
 * si aggiorna solo `last_updated`. Controlla: anteprima senza scrittura, scrittura della sola riga
 * (virgolette conservate), riga aggiunta se manca, rifiuto di un doc senza frontmatter MR, --data;
 * review_needed (0.6-z) tolto con --write (anche su più righe), lasciato con --tieni-review.
 *
 * Invocazione: node tools/mr/test-rivisto.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
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

console.log('\ntest-rivisto.mjs\n');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-rivisto-')));
const DOC = "---\nmr_version: '0.6'\nid: app/guida\ntitle: Guida\ntype: guide\nowner: app\nstatus: active\ncreated: '2026-01-01'\nlast_updated: '2026-02-01'\n---\n\n# Guida\n\nTesto.\n";
write(root, 'docs/guida.md', DOC);
write(root, 'docs/doppie.md', DOC.replace("last_updated: '2026-02-01'", 'last_updated: "2026-02-01"').replace('app/guida', 'app/doppie'));
write(root, 'docs/senza-data.md', DOC.replace("last_updated: '2026-02-01'\n", '').replace('app/guida', 'app/senza-data'));
write(root, 'docs/senza.md', '# Senza frontmatter\n');
const REV = DOC.replace('app/guida', 'app/rev').replace("status: active\n", 'status: active\nreview_needed: "elenco fermo a 52 funzioni"\n');
write(root, 'docs/rev.md', REV);
write(root, 'docs/rev-lungo.md', DOC.replace('app/guida', 'app/rev-lungo').replace("status: active\n", 'status: active\nreview_needed: >-\n  elenco fermo\n  a 52 funzioni\n'));
write(root, 'docs/rev-tieni.md', REV.replace('app/rev', 'app/rev-tieni'));
execFileSync('git', ['init', '-q', root]);

test('anteprima: dice il cambio e non scrive', () => {
  const r = run(root, 'rivisto', 'docs/guida.md', '--data', '2026-10-13');
  assert(r.code === 0 && r.out.includes("2026-02-01 → 2026-10-13") && r.out.includes('anteprima'), r.out + r.err);
  assert(readFileSync(join(root, 'docs/guida.md'), 'utf-8') === DOC, 'scritto senza --write');
});

test('--write: cambia solo la riga di last_updated, con le stesse virgolette', () => {
  const r = run(root, 'rivisto', 'docs/guida.md', '--data', '2026-10-13', '--write');
  assert(r.code === 0 && r.out.includes('scritto'), r.out + r.err);
  assert(readFileSync(join(root, 'docs/guida.md'), 'utf-8') === DOC.replace("last_updated: '2026-02-01'", "last_updated: '2026-10-13'"), 'diff diverso da una riga');
  run(root, 'rivisto', 'docs/doppie.md', '--data', '2026-10-13', '--write');
  assert(readFileSync(join(root, 'docs/doppie.md'), 'utf-8').includes('last_updated: "2026-10-13"'), 'virgolette doppie perse');
  const again = run(root, 'rivisto', 'docs/guida.md', '--data', '2026-10-13', '--write');
  assert(again.code === 0 && again.out.includes('già aggiornato'), again.out);
});

test('last_updated mancante: si aggiunge in fondo al frontmatter', () => {
  run(root, 'rivisto', 'docs/senza-data.md', '--data', '2026-10-13', '--write');
  const t = readFileSync(join(root, 'docs/senza-data.md'), 'utf-8');
  assert(t.includes("status: active\ncreated: '2026-01-01'\nlast_updated: '2026-10-13'\n---"), t);
});

test('rifiuta: doc senza frontmatter MR, data non valida, più doc, --data fuori da rivisto', () => {
  const a = run(root, 'rivisto', 'docs/senza.md', '--write');
  assert(a.code === 2 && /non ha il frontmatter MR/.test(a.err), a.err);
  assert(readFileSync(join(root, 'docs/senza.md'), 'utf-8') === '# Senza frontmatter\n', 'scritto un doc senza frontmatter');
  assert(run(root, 'rivisto', 'docs/guida.md', '--data', '13/10/2026').code === 2, 'data non valida → 2');
  assert(run(root, 'rivisto', 'docs/guida.md', 'docs/doppie.md').code === 2, 'due doc → 2');
  assert(run(root, 'scan', 'docs', '--data', '2026-10-13').code === 2, '--data con scan → 2');
  // 0.6-z3: frontmatter rotto (titolo con i due punti senza virgolette) → lo dice, con la riga
  write(root, 'docs/rotto.md', DOC.replace('title: Guida', 'title: Runbook: opzione A').replace('app/guida', 'app/rotto'));
  const b = run(root, 'rivisto', 'docs/rotto.md', '--write');
  assert(b.code === 2 && /frontmatter non leggibile \(riga 4: /.test(b.err), b.err);
  // 0.6-z5: un doc .md con «secret» nel nome si legge (prima «doc non leggibile»)
  write(root, 'docs/D22-secret-in-chiaro.md', DOC.replace('app/guida', 'app/d22'));
  const c = run(root, 'rivisto', 'docs/D22-secret-in-chiaro.md', '--data', '2026-10-13');
  assert(c.code === 0 && c.out.includes('2026-02-01 → 2026-10-13'), c.out + c.err);
});

test('review_needed (0.6-z): l\'anteprima lo mostra, --write lo toglie con la data; anche su più righe', () => {
  const p = run(root, 'rivisto', 'docs/rev.md', '--data', '2026-10-13');
  assert(p.code === 0 && p.out.includes('review_needed tolto: «elenco fermo a 52 funzioni»') && p.out.includes('anteprima'), p.out + p.err);
  assert(readFileSync(join(root, 'docs/rev.md'), 'utf-8') === REV, 'scritto senza --write');
  run(root, 'rivisto', 'docs/rev.md', '--data', '2026-10-13', '--write');
  assert(readFileSync(join(root, 'docs/rev.md'), 'utf-8') === DOC.replace('app/guida', 'app/rev').replace("last_updated: '2026-02-01'", "last_updated: '2026-10-13'"), 'atteso: solo la data cambiata e la riga di review_needed tolta');
  run(root, 'rivisto', 'docs/rev-lungo.md', '--data', '2026-10-13', '--write');
  const t = readFileSync(join(root, 'docs/rev-lungo.md'), 'utf-8');
  assert(!/review_needed|elenco fermo|52 funzioni/.test(t) && t.includes("status: active\ncreated:"), t);
});

test('review_needed con --tieni-review: resta, cambia solo la data; --tieni-review fuori da rivisto → 2', () => {
  const r = run(root, 'rivisto', 'docs/rev-tieni.md', '--data', '2026-10-13', '--write', '--tieni-review');
  assert(r.code === 0 && r.out.includes('review_needed lasciato'), r.out + r.err);
  const t = readFileSync(join(root, 'docs/rev-tieni.md'), 'utf-8');
  assert(t === REV.replace('app/rev', 'app/rev-tieni').replace("last_updated: '2026-02-01'", "last_updated: '2026-10-13'"), t);
  assert(run(root, 'scan', 'docs', '--tieni-review').code === 2, '--tieni-review con scan → 2');
});

rmSync(root, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
