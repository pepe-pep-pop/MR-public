#!/usr/bin/env node
/**
 * test-remote.mjs — link verso repo non in locale, letti con gh api (PRD v0.6 R10), senza rete:
 * `gh` è sostituito da uno script finto (MR_GH_BIN) con risposte preparate.
 * Invocazione: node tools/mr/test-remote.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const write = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c, 'utf-8'); };

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ✅ ${name}`); } catch (err) { results.push(false); console.log(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\ntest-remote.mjs\n');
const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-remote-test-')));
const docs = join(base, 'docs');
mkdirSync(docs);
execFileSync('git', ['init', '-q', docs]);

// gh finto: repos/acme/remoto → main; contents per (path, ref); compare → un commit; il resto 404
const FILES = {
  'src/a.ts|main': 'export function f() {\n  return 2;\n}\nexport function g() {\n  return 9;\n}\n',
  'src/a.ts|1111111': 'export function f() {\n  return 1;\n}\nexport function g() {\n  return 9;\n}\n',
  'conf.yml|main': 'porta: 2\n',
  'conf.yml|1111111': 'porta: 2\n',
};
const LOG = join(base, 'gh.log');
const fake = join(base, 'gh-finto.cjs');
writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, args.join(' ') + '\\n');
const FILES = ${JSON.stringify(FILES)};
const ep = args.find((a) => a.startsWith('repos/'));
if (args.some((a) => a.startsWith('-X') || a === '--method' || a === '-f' || a === '-F')) { process.stderr.write('scrittura vietata'); process.exit(3); }
if (ep === 'repos/acme/remoto') { console.log('main'); process.exit(0); }
let m = ep && ep.match(/^repos\\/acme\\/remoto\\/contents\\/(.+)\\?ref=(.+)$/);
if (m) { const k = decodeURIComponent(m[1]) + '|' + decodeURIComponent(m[2]); if (k in FILES) { process.stdout.write(FILES[k]); process.exit(0); } }
if (ep && ep.startsWith('repos/acme/remoto/compare/')) { console.log(JSON.stringify([{ hash: 'abcd1234', date: '2026-10-03' }])); process.exit(0); }
process.stderr.write('gh: Not Found (HTTP 404)'); process.exit(1);
`);
chmodSync(fake, 0o755);



write(docs, 'nota.md', `---
code_refs:
  - { path: src/a.ts, symbol: f, repo: acme/remoto, verified: { commit: '1111111', date: '2026-10-01' } }
  - { path: src/a.ts, symbol: g, repo: acme/remoto, verified: { commit: '1111111', date: '2026-10-01' } }
  - { path: conf.yml, repo: acme/remoto, verified: { commit: '1111111', date: '2026-10-01' } }
  - { path: src/sparito.ts, repo: acme/remoto, verified: { commit: '1111111' } }
  - { path: src/a.ts, symbol: f, repo: acme/remoto, verified: { commit: '9999999' } }
  - { path: src/a.ts, symbol: f, repo: acme/remoto }
  - { path: src/a.ts, symbol: f, repo: altri/privato, verified: { commit: '1111111' } }
---
# Nota
`);
execFileSync('git', ['-C', docs, 'add', '-A']);
const env = { ...process.env, MR_GH_BIN: fake };
const run = (...a) => { const r = spawnSync(process.execPath, [MR, ...a], { cwd: docs, encoding: 'utf-8', env }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };

test('senza --remote: i link a repo non locali restano unresolvable, nessuna chiamata a gh', () => {
  const j = JSON.parse(run('scan', 'nota.md', '--format', 'json').out);
  assert(j.refs.every((r) => r.status === 'unresolvable'), JSON.stringify(j.refs.map((r) => r.status)));
  assert(!existsSync(LOG), 'gh chiamato senza --remote');
});

test('--remote: ok, drift ridotto al simbolo, missing, unresolvable, unverified', () => {
  const j = JSON.parse(run('scan', 'nota.md', '--format', 'json', '--remote').out);
  const st = j.refs.map((r) => `${r.path}#${r.symbol || ''}@${r.verified || '-'}:${r.status}/${r.level}`);
  const want = [
    'src/a.ts#f@1111111:drift/remote-regex',
    'src/a.ts#g@1111111:ok/remote-regex',
    'conf.yml#@1111111:ok/remote-file',
    'src/sparito.ts#@1111111:missing/remote-file',
    'src/a.ts#f@9999999:unresolvable/remote-regex',
    'src/a.ts#f@-:unverified/remote-regex',
    'src/a.ts#f@1111111:unresolvable/n/a',
  ];
  assert(JSON.stringify(st) === JSON.stringify(want), `\n     ${st.join('\n     ')}`);
  const f = j.refs[0];
  assert(f.diff.includes('-  return 1;') && f.diff.includes('+  return 2;') && !f.diff.join('\n').includes('return 9'), `diff: ${f.diff}`);
  assert(f.commits.length === 1 && f.commits[0].hash === 'abcd1234' && f.code_repo === 'acme/remoto (remoto)', JSON.stringify(f));
});

test('solo letture: nessuna chiamata con metodo o campi di scrittura', () => {
  const log = readFileSync(LOG, 'utf-8');
  assert(!/(^|\s)(-X|--method|-f|-F|--field|--raw-field)(\s|$)/m.test(log), log);
  assert(log.split('\n').filter(Boolean).every((l) => /^api /.test(l)), log);
});

rmSync(base, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
