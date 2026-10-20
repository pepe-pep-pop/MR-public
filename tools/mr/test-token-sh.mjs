#!/usr/bin/env node
/**
 * test-token-sh.mjs — tools/mr/token-gh.sh con `security` e `gh` finti (0.6-z15).
 * Gira con la bash di sistema (su macOS la 3.2, dove «$owner» seguito da un carattere non ASCII
 * rompeva `carica`). Solo su macOS: altrove lo script esce subito per scelta, e il test si salta.
 * Invocazione: node tools/mr/test-token-sh.mjs   (exit 0 = tutti pass)
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(here, 'token-gh.sh');

if (process.platform !== 'darwin') {
  console.log('\ntest-token-sh.mjs: saltato (serve macOS)\n\nRisultato: 0/0 PASS\n');
  process.exit(0);
}

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ✅ ${name}`); } catch (err) { results.push(false); console.log(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }

console.log('\ntest-token-sh.mjs\n');

const bin = mkdtempSync(join(tmpdir(), 'mr-token-sh-'));
const LOG = join(bin, 'log');
const finto = (nome, corpo) => { const f = join(bin, nome); writeFileSync(f, `#!/bin/sh\n${corpo}\n`); chmodSync(f, 0o755); };
// security finto: registra il sottocomando e l'account; find-generic-password con -w dà un valore finto
finto('security', `echo "security $1 $(echo "$@" | sed -n 's/.*-a \\([^ ]*\\).*/\\1/p')" >> "${LOG}"
case "$1" in
  find-generic-password) case "$*" in *-a\\ assente*) exit 44 ;; esac; echo valore-finto-di-prova ;;
esac
exit 0`);
// gh finto: lettura ok; per la scrittura risponde come un token in sola lettura
finto('gh', `echo "gh $* token:$([ "$GH_TOKEN" = valore-finto-di-prova ] && echo mr || echo altro)" >> "${LOG}"
case "$*" in *-X\\ POST*) echo 'gh: Resource not accessible by personal access token (HTTP 403)' >&2; exit 1 ;; esac
echo org/repo`);
const run = (...a) => { const r = spawnSync('/bin/bash', [SCRIPT, ...a], { encoding: 'utf-8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };

test('carica con la bash di sistema: nessun errore di variabile, security con -w in fondo e account in minuscolo', () => {
  const r = run('carica', 'Mia-Org');
  assert(r.code === 0 && /per «Mia-Org»/.test(r.out) && /salvato nel portachiavi/.test(r.out), r.out);
  const log = readFileSync(LOG, 'utf-8');
  assert(/security add-generic-password mia-org/.test(log), log);
});

test('verifica: lettura con il token di MR, scrittura rifiutata, valore mai stampato; owner senza token → ❌', () => {
  rmSync(LOG, { force: true });
  const r = run('verifica', 'mia-org/repo');
  assert(r.code === 0 && /lettura riuscita/.test(r.out) && /scrittura rifiutata/.test(r.out) && !r.out.includes('valore-finto'), r.out);
  const log = readFileSync(LOG, 'utf-8');
  assert(log.split('\n').filter((l) => l.startsWith('gh ')).every((l) => l.endsWith('token:mr')), log);
  const n = run('verifica', 'assente/repo');
  assert(n.code === 1 && /nessun token per assente/.test(n.out), n.out);
});

test('argomenti non validi: exit 2', () => {
  assert(run('carica', 'a b').code === 2 && run('verifica', 'senza-barra').code === 2, 'validazione');
});

rmSync(bin, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} PASS\n`);
process.exit(ok === results.length ? 0 : 1);
