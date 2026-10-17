#!/usr/bin/env node
/**
 * test-suggest.mjs — `mr suggest-links` (MR 0.6-z5, difetti 2, 3, 5 e 6 del pilota B):
 *   - variabile d'ambiente letta dentro una sola funzione → proposta la funzione; in più funzioni o
 *     fuori → livello «occorrenze», non «funzione»;
 *   - `valore(d) = …` (nome con argomenti) e file citato sulla stessa riga → ancorato a valore;
 *   - path dentro un blocco di codice → file intero, solo se il file esiste;
 *   - `bun ops/recon.ts` in un blocco shell → claim path trovato, non uno script di package.json.
 *
 * Invocazione: node tools/mr/test-suggest.mjs   (exit 0 = tutti pass)
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

console.log('\ntest-suggest.mjs\n');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-suggest-')));
write(root, 'code/src/lib/auth.server.ts', [
  "import { x } from './x';",
  'export function getAuthConfig() {',
  '  const domini = process.env.AUTH_ALLOWED_DOMAINS;',
  '  const url = process.env.APP_URL;',
  '  return { domini, url };',
  '}',
  'export function isSecure() {',
  '  return process.env.APP_URL?.startsWith("https");',
  '}',
  '',
].join('\n'));
write(root, 'code/src/lib/hubspot.server.ts', [
  'export function fetchContactByDeal(id: string) {',
  '  return id;',
  '}',
  'export function valore(d: { importoTotale?: number; amount?: number }) {',
  '  return d.importoTotale || d.amount;',
  '}',
  '',
].join('\n'));
write(root, 'code/ops/recon.ts', 'console.log(1);\n');
write(root, 'docker-compose.tunnel.yml', 'services: {}\n');
write(root, 'deploy/app.env.example', 'APP_URL=\n');
write(root, 'docs/guida.md', [
  '# Guida',
  '',
  '## Accesso',
  '',
  'Senza `AUTH_ALLOWED_DOMAINS` l\'app non parte. `APP_URL` decide il cookie sicuro.',
  '',
  '## Trappole',
  '',
  '- In `hubspot.server.ts` il totale è `valore(d) = importoTotale || amount`.',
  '- Il contatto si cerca con `fetchContactByDeal()`.',
  '',
  '## Il comando',
  '',
  '```bash',
  'docker compose -f docker-compose.tunnel.yml up -d   # avvia il tunnel',
  'cp deploy/app.env.example deploy/app.env',
  'cat config/non-esiste.yml',
  '```',
  '',
  '## Ricognizione',
  '',
  '```bash',
  'cd code',
  'bun ops/recon.ts                      # ricognizione',
  '```',
  '',
].join('\n'));
execFileSync('git', ['init', '-q', root]);
execFileSync('git', ['-C', root, 'add', '-A']);
execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'A']);

const res = JSON.parse(run(root, 'suggest-links', 'docs/guida.md', '--format', 'json').out);
const props = res.docs.flatMap((d) => d.proposals);
const key = (p) => `${p.section}|${p.path}|${p.symbol || ''}|${p.level}`;
const keys = props.map(key);

test('variabile letta dentro una sola funzione → la funzione; in più funzioni → occorrenze', () => {
  assert(keys.includes('## Accesso|code/src/lib/auth.server.ts|getAuthConfig|funzione'), keys.join('\n'));
  assert(keys.includes('## Accesso|code/src/lib/auth.server.ts|APP_URL|occorrenze'), `APP_URL sta in due funzioni:\n${keys.join('\n')}`);
  assert(!keys.some((k) => /AUTH_ALLOWED_DOMAINS\|funzione/.test(k)), 'etichetta «funzione» su delle righe');
});

test('`valore(d) = …` sulla stessa riga del file → il file si ancora a valore, non a fetchContactByDeal', () => {
  const p = props.find((x) => x.section === '## Trappole' && x.path === 'code/src/lib/hubspot.server.ts' && /^path/.test(x.from));
  assert(p && p.symbol === 'valore', JSON.stringify(props.filter((x) => x.section === '## Trappole')));
});

test('path in un blocco di codice → file intero se esiste; un file che non esiste no', () => {
  assert(keys.includes('## Il comando|docker-compose.tunnel.yml||file') && keys.includes('## Il comando|deploy/app.env.example||file'), keys.join('\n'));
  assert(!keys.some((k) => k.includes('non-esiste')), 'proposto un file inesistente');
});

test('`bun ops/recon.ts` in un blocco → non è uno script di package.json (niente not_found); il file si propone dal blocco', () => {
  const c = JSON.parse(run(root, 'claims', 'docs/guida.md', '--format', 'json', '--all').out);
  // nei blocchi shell si estraggono solo i comandi (come `node ops/a.js`): niente più il falso
  // «script ops/recon.ts non trovato in package.json»; il file lo propone suggest-links dal blocco
  const rec = c.claims.find((r) => /recon\.ts/.test(r.claim));
  assert(!rec, `claim inatteso: ${JSON.stringify(rec)}`);
  assert(keys.includes('## Ricognizione|code/ops/recon.ts||file'), keys.join('\n'));
});

rmSync(root, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
