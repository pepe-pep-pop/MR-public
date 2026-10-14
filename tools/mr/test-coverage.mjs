#!/usr/bin/env node
/**
 * test-coverage.mjs — `mr coverage` (PRD v0.6 R9): punti d'ingresso che nessun doc cita.
 * Invocazione: node tools/mr/test-coverage.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const write = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c, 'utf-8'); };
const run = (cwd, ...a) => { const r = spawnSync(process.execPath, [MR, ...a], { cwd, encoding: 'utf-8' }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ✅ ${name}`); } catch (err) { results.push(false); console.log(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\ntest-coverage.mjs\n');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-coverage-test-')));
execFileSync('git', ['init', '-q', root]);
write(root, 'supabase/functions/sync-gcal/index.ts', 'Deno.serve(() => new Response("ok"));\n');
write(root, 'supabase/functions/invia-mail/index.ts', 'Deno.serve(() => new Response("ok"));\n');
write(root, 'supabase/functions/_shared/util.ts', 'export const x = 1;\n');
write(root, 'supabase/migrations/001_init.sql', 'create table a (id int);\n');
write(root, 'supabase/migrations/002_extra.sql', 'create table b (id int);\n');
write(root, 'server/app.ts', "app.get('/api/salute', h);\napp.post('/api/ordini', h);\n");
write(root, 'server/app.test.ts', "app.get('/api/solo-nei-test', h);\n");
write(root, '.github/workflows/ci.yml', 'name: ci\n');
write(root, 'deploy/aggiorna.sh', 'echo ok\n');
write(root, 'Dockerfile', 'FROM node\n');
write(root, '.env.example', 'DB_URL=\nAPI_TOKEN=\n');
write(root, 'README.md', '# Progetto\n\nLa funzione `sync-gcal` sincronizza; la rotta `GET /api/salute` risponde; vedi `001_init.sql`, `ci.yml`, `Dockerfile` e `DB_URL`.\n');
write(root, 'docs/_archive/vecchio.md', '# Vecchio\n\nCita `invia-mail` e `API_TOKEN`.\n');
write(root, 'docs/hof-1.md', '# Diario\n\nCita `002_extra.sql`.\n');
execFileSync('git', ['-C', root, 'add', '-A']);

test('punti d\'ingresso e citazioni (storici e diari non contano)', () => {
  const j = JSON.parse(run(root, 'coverage', '--format', 'json').out);
  const st = (kind, name) => j.entries.find((e) => e.kind === kind && e.name === name);
  const exp = [['function', 'sync-gcal', true], ['function', 'invia-mail', false], ['migration', '001_init', true], ['migration', '002_extra', false],
    ['route', 'GET /api/salute', true], ['route', 'POST /api/ordini', false], ['ci', 'ci.yml', true], ['deploy', 'Dockerfile', true], ['deploy', 'aggiorna.sh', false],
    ['env', 'DB_URL', true], ['env', 'API_TOKEN', false]];
  const wrong = exp.filter(([k, n, c]) => !st(k, n) || !!st(k, n).covered !== c).map(([k, n, c]) => `${k} ${n}: atteso ${c ? 'citato' : 'non citato'}, ottenuto ${st(k, n) ? st(k, n).covered : 'assente'}`);
  assert(!wrong.length, wrong.join('\n     '));
  assert(!j.entries.some((e) => e.name === '_shared'), '_shared non è una funzione');
  assert(!j.entries.some((e) => e.name.includes('solo-nei-test')), 'route nei file di test');
  assert(j.journals_excluded === 1, `diari esclusi: ${j.journals_excluded}`);
});

test('mr.coverage.yaml exclude; md; mai exit 1; sola lettura', () => {
  write(root, 'mr.coverage.yaml', 'exclude:\n  - "deploy/**"\n');
  execFileSync('git', ['-C', root, 'add', '-A']);
  const r = run(root, 'coverage');
  assert(r.code === 0, `exit ${r.code}`);
  assert(r.out.includes('## Funzioni / handler non citati') && r.out.includes('`invia-mail`') && !r.out.includes('aggiorna.sh'), r.out);
  assert(execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf-8' }).split('\n').filter((l) => l && !l.startsWith('A ')).length === 0, 'file modificati');
  assert(run(root, 'coverage', '--write').code === 2, 'coverage --write → 2');
});

rmSync(root, { recursive: true, force: true });
const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
