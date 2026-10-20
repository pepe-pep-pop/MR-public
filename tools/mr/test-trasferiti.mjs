#!/usr/bin/env node
/**
 * test-trasferiti.mjs — repo spostati su GitHub con origin ancora sul nome vecchio (0.6-z16).
 * GitHub reindirizza il nome vecchio, ma il token in sola lettura del vecchio owner non vede il repo
 * nel nuovo: il giro risolve il nome attuale e rilegge le PR con il token del nuovo owner.
 * Invocazione: node tools/mr/test-trasferiti.mjs   (exit 0 = tutti pass)
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ✅ ${name}`); } catch (err) { results.push(false); console.log(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\ntest-trasferiti.mjs\n');
// il giro con --write riscrive anche l'indice dei doc (0.6-z17): nei test mai quello vero in ~/.mr/indice
process.env.MR_INDICE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mr-indice-'));

const base = mkdtempSync(join(tmpdir(), 'mr-trasferiti-'));
const LOG = join(base, 'log');
const fake = join(base, 'gh-finto.cjs');
// gh finto: «vecchio/repo» si risolve in «nuovo/repo» solo con l'autenticazione di gh (nessun GH_TOKEN);
// pr list sul nome vecchio fallisce come con un token fine-grained; sul nome nuovo risponde
writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const tok = { 'finto-vecchio': 'vecchio', 'finto-nuovo': 'nuovo' }[process.env.GH_TOKEN] || (process.env.GH_TOKEN ? 'altro' : 'utente');
fs.appendFileSync(${JSON.stringify(LOG)}, a.join(' ') + ' | ' + tok + '\\n');
const repo = a[a.indexOf('--repo') + 1];
if (a[0] === 'pr' && repo === 'vecchio/repo') { process.stderr.write("GraphQL: Could not resolve to a Repository with the name 'vecchio/repo'. (repository)"); process.exit(1); }
if (a[0] === 'pr' && repo === 'nuovo/repo') { console.log(JSON.stringify([{ number: 7, headRefOid: 'abc', files: [{ path: 'docs/a.md' }] }])); process.exit(0); }
if (a[0] === 'api' && a[1] === 'repos/vecchio/repo' && !process.env.GH_TOKEN) { console.log('nuovo/repo'); process.exit(0); }
process.stderr.write('gh: Not Found (HTTP 404)'); process.exit(1);
`);
chmodSync(fake, 0o755);
const repo = join(base, 'repo');
execFileSync('git', ['init', '-q', repo]);
execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/vecchio/repo.git']);

process.env.MR_GH_BIN = fake;
process.env.MR_GH_PORTACHIAVI = 'no';
process.env.MR_GH_TOKEN_VECCHIO = 'finto-vecchio';
process.env.MR_GH_TOKEN_NUOVO = 'finto-nuovo';
for (const k of Object.keys(process.env)) if (k === 'MR_GH_TOKEN') delete process.env[k];
const { openPrFiles } = await import('./giro.mjs');

test('origin sul nome vecchio: nome attuale risolto, PR lette con il token del nuovo owner, redirect segnalato', () => {
  const r = openPrFiles(repo);
  assert(r.ok && r.slug === 'nuovo/repo' && r.files.get('docs/a.md')?.[0] === 7, JSON.stringify({ ...r, files: [...r.files] }));
  assert(r.rediretto?.da === 'vecchio/repo' && r.rediretto?.a === 'nuovo/repo', JSON.stringify(r.rediretto));
  const log = readFileSync(LOG, 'utf-8').trim().split('\n');
  assert(/^pr list --repo vecchio\/repo .*\| vecchio$/.test(log[0]), log[0]);
  assert(/^api repos\/vecchio\/repo --jq \.full_name \| utente$/.test(log[1]), `nome risolto con l'autenticazione di gh: ${log[1]}`);
  assert(/^pr list --repo nuovo\/repo .*\| nuovo$/.test(log[2]), log[2]);
  assert(!log.join('\n').includes('finto-'), 'valore del token nel log');
});

test('un errore che non è «repo non trovato» non cerca redirect: nota come prima', () => {
  rmSync(LOG, { force: true });
  execFileSync('git', ['-C', repo, 'remote', 'set-url', 'origin', 'https://github.com/altro/repo.git']);
  const r = openPrFiles(repo);
  assert(!r.ok && !r.rediretto && /gh non disponibile o errore/.test(r.note), JSON.stringify(r));
  assert(!readFileSync(LOG, 'utf-8').includes('api repos/'), 'nessuna risoluzione del nome');
});

rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} PASS\n`);
process.exit(ok === results.length ? 0 : 1);
