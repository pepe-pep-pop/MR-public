#!/usr/bin/env node
/**
 * test-censura.mjs — censura delle trascrizioni (MR 0.6-z19). Valori finti costruiti nel test.
 * Controlla: valori sostituiti con il nome del campo che resta, JSON valido e stesse righe, righe senza
 * riscontri identiche, segnaposto e riferimenti lasciati, prova a vuoto senza scrittura e senza
 * valori nell'output, --write solo con --solo, file recenti saltati, copia nel cestino, data di
 * modifica conservata.
 *
 * Invocazione: node tools/mr/test-censura.mjs   (exit 0 = tutti pass)
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, utimesSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { censuraTesto, censuraJsonl, SEGNAPOSTO } from './lib/censura.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'censura.mjs');
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

console.log('\ntest-censura.mjs\n');
// valori finti, costruiti a pezzi così il sorgente del test non contiene forme di token intere
const PW = 'Pr0va' + 'Finta!42';
const GH = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const DB = 'dbPass' + '9876';

test('testo: assegnazioni, curl -u, URL, Bearer, token; il nome resta, il valore no', () => {
  const t = [
    `curl -u admin:${PW} https://x.invalid/api`,
    `DB_PASSWORD=${DB}`,
    `const cfg = { password: '${PW}' }`,
    'postgres' + '://app:' + DB + '@localhost:5432/db',
    `Authorization: Bearer ${GH}`,
    `-d '{"email":"a@example.invalid","password":"${PW}"}'`,
    `MR_GH_TOKEN: ${GH}`,
  ].join('\n');
  const r = censuraTesto(t);
  for (const v of [PW, GH, DB]) assert(!r.testo.includes(v), `resta ${v.slice(0, 3)}…`);
  assert(r.testo.includes('curl -u admin:[CENSURATO]') && r.testo.includes('DB_PASSWORD=[CENSURATO]') && r.testo.includes("password: '[CENSURATO]'"), r.testo);
  assert(r.testo.includes('postgres' + '://app:' + SEGNAPOSTO + '@localhost') && r.testo.includes('"password":"[CENSURATO]"'), r.testo);
  assert(Object.values(r.conta).reduce((a, n) => a + n, 0) >= 7, JSON.stringify(r.conta));
});

test('testo: segnaposto, riferimenti, tipi, frasi e contatori lasciati', () => {
  const t = [
    'password: process.env.DB_PASSWORD', 'DB_PASSWORD=${DB_PASSWORD}', "password: '<la tua password>'", 'token: string;',
    'const password = req.body.password', 'max_tokens: 1000', '"input_tokens": 523', "results ? 'PASS' : 'FAIL'",
    '"minipass": "^7.0.4"', 'read -s -p "Client secret: " SEGRETO', 'client_secret: presente', 'idToken: idToken,',
    `password: '${SEGNAPOSTO}'`, 'TOKEN=***', 'password: Option<String>,',
  ].join('\n');
  const r = censuraTesto(t);
  assert(r.testo === t, `cambiato: ${JSON.stringify(r.conta)}`);
});

test('jsonl: JSON valido, stesse righe, righe senza riscontri identiche byte per byte, campo con nome segreto', () => {
  const righe = [
    JSON.stringify({ type: 'user', message: { content: 'ciao' } }) + ' ',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: `curl -u admin:${PW} https://x.invalid` } }] } }),
    JSON.stringify({ toolUseResult: { password: PW, user: 'admin' } }),
    'riga non json',
    '',
  ];
  const r = censuraJsonl(righe.join('\n'));
  const out = r.testo.split('\n');
  assert(out.length === righe.length, 'righe');
  assert(out[0] === righe[0] && out[3] === righe[3], 'righe senza riscontri cambiate');
  assert(!r.testo.includes(PW), 'valore rimasto');
  assert(JSON.parse(out[2]).toolUseResult.password === SEGNAPOSTO && JSON.parse(out[2]).toolUseResult.user === 'admin', out[2]);
  assert(JSON.parse(out[1]).message.content[0].input.command.includes('admin:[CENSURATO]'), out[1]);
  assert(r.righeCambiate === 2 && r.nonJson === 1 && r.conta['campo JSON'] === 1, JSON.stringify(r));
});

test('chiave privata su più righe: corpo censurato, stesso numero di righe (anche nei .txt)', () => {
  const k = ['-----BEGIN ' + 'PRIVATE KEY-----', 'MIIEv' + 'QIBADANBgkqhkiG9w0B', 'AQEFAASC' + 'BKcwggSjAgEAAoIBAQ', '-----END ' + 'PRIVATE KEY-----'].join('\n');
  const r = censuraTesto(`prima\n${k}\ndopo`);
  assert(r.testo.split('\n').length === 6 && !r.testo.includes('MIIEv') && r.conta['chiave privata'] === 1, r.testo);
});

const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-censura-')));
const proj = join(base, 'projects', '-Users-x-Documents-GL--code--soft-app');
const vecchia = join(proj, 'aaaa1111-0000-0000-0000-000000000000.jsonl');
const subag = join(proj, 'aaaa1111-0000-0000-0000-000000000000', 'subagents', 'agent-x.jsonl');
const recente = join(proj, 'bbbb2222-0000-0000-0000-000000000000.jsonl');
const riga = (cmd) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: cmd } }] } });
mkdirSync(dirname(subag), { recursive: true });
writeFileSync(vecchia, [riga('ls'), riga(`curl -u admin:${PW} https://x.invalid`), ''].join('\n'));
writeFileSync(subag, riga(`export DB_PASSWORD=${DB}`) + '\n');
writeFileSync(recente, riga(`curl -u admin:${PW} https://x.invalid`) + '\n');
const ieri = new Date(Date.now() - 86400000);
utimesSync(vecchia, ieri, ieri);
utimesSync(subag, ieri, ieri);
const cestino = join(base, 'Cestino');
const run = (...a) => spawnSync(process.execPath, [CLI, '--dir', join(base, 'projects'), ...a], { encoding: 'utf-8' });

test('prova a vuoto: conteggi per file, nessun valore, nessuna scrittura; il recente è marcato', () => {
  const prima = readFileSync(vecchia, 'utf-8');
  const r = run();
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(!r.stdout.includes(PW) && !r.stdout.includes(DB), 'valore nell\'output');
  assert(/\| app \| aaaa1111 \| sessione \| 1 \| 1 \| curl -u 1/.test(r.stdout) && /\| app \| aaaa1111 \| subagente \|/.test(r.stdout), r.stdout);
  assert(/\| app \| bbbb2222 \| sessione .*sì \(si salta\)/.test(r.stdout), 'recente');
  assert(readFileSync(vecchia, 'utf-8') === prima, 'scritto senza --write');
});

test('--write senza --solo rifiutato; --solo con id non valido rifiutato', () => {
  assert(run('--write').status === 2, '--write senza --solo');
  assert(run('--solo', 'x;rm', '--write').status === 2, 'id non valido');
});

test('--write --solo: censura i file scelti (sessione e subagente), salta i recenti, copia nel cestino, mtime conservato', () => {
  const mtime = statSync(vecchia).mtimeMs;
  const r = run('--solo', 'aaaa1111,bbbb2222', '--write', '--cestino', cestino);
  assert(r.status === 0, `exit ${r.status}: ${r.stdout}${r.stderr}`);
  const t = readFileSync(vecchia, 'utf-8');
  assert(!t.includes(PW) && t.split('\n').length === 3 && t.split('\n').filter(Boolean).every((l) => JSON.parse(l)), 'vecchia');
  assert(!readFileSync(subag, 'utf-8').includes(DB), 'subagente');
  assert(readFileSync(recente, 'utf-8').includes(PW), 'recente toccato');
  assert(Math.abs(statSync(vecchia).mtimeMs - mtime) < 1000, 'mtime cambiato');
  const copie = readdirSync(cestino);
  assert(copie.length === 2 && copie.every((f) => readFileSync(join(cestino, f), 'utf-8').match(/admin:|DB_PASSWORD=/)), copie.join());
  assert(/saltato: modificato da meno di 60 minuti/.test(r.stdout) && /censurato/.test(r.stdout), r.stdout);
  assert(!r.stdout.includes(PW), 'valore nell\'output');
  const di_nuovo = run('--solo', 'aaaa1111');
  assert(/con riscontri: 0/.test(di_nuovo.stdout), di_nuovo.stdout);
  assert(existsSync(cestino), 'cestino');
});

const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} PASS\n`);
process.exitCode = ok === results.length ? 0 : 1;
