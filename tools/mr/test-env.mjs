#!/usr/bin/env node
/**
 * test-env.mjs — `mr env` (0.6-z9): variabili lette dal codice contro gli elenchi.
 * Casi dal censimento token del 18/10 (report/analisi-token), con nomi finti.
 * Invocazione: node tools/mr/test-env.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nomiDelMatch } from './lib/env.mjs';
import { isSecretPath } from './lib/repo.mjs';
import { sezioneEnv } from './giro.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const write = (root, rel, c) => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), c, 'utf-8'); };
const run = (cwd, ...a) => { const r = spawnSync(process.execPath, [MR, ...a], { cwd, encoding: 'utf-8' }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };
const git = (root, ...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf-8' });

const results = [];
function test(name, fn) {
  try { fn(); results.push(true); console.log(`  ✅ ${name}`); } catch (err) { results.push(false); console.log(`  ❌ ${name}\n     ${err.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }
const nomi = (xs) => xs.map((x) => x.nome).sort().join(',');

console.log('\ntest-env.mjs\n');

test('nomi da un match: ultimo token, destrutturazione, built-in di Vite', () => {
  const casi = [
    ['process.env.API_TOKEN', ['API_TOKEN']], ['process.env["DB_URL"', ['DB_URL']], ['Deno.env.get("ZONE_A_URL")', ['ZONE_A_URL']],
    ['os.environ.get("PY_KEY")', ['PY_KEY']], ['ENV.fetch("RB_KEY")', ['RB_KEY']], ['import.meta.env.DEV', []], ['import.meta.env.VITE_URL', ['VITE_URL']],
    ['{ A_ONE, B_TWO: b, C_TRE = \'x\', ...resto } = process.env', ['A_ONE', 'B_TWO', 'C_TRE']],
  ];
  const sbagliati = casi.filter(([m, att]) => nomiDelMatch(m).join(',') !== att.join(',')).map(([m, att]) => `${m}: ${nomiDelMatch(m)} invece di ${att}`);
  assert(!sbagliati.length, sbagliati.join('\n     '));
});

test('file d\'esempio con nome (.env.production.example) leggibili; .env.production no', () => {
  for (const [p, atteso] of [['.env.production.example', false], ['deploy/.env.staging.example', false], ['x.env.esempio', false], ['.env.esempio', false], ['.env.production', true], ['.env.local', true]]) {
    assert(isSecretPath(p) === atteso, `isSecretPath(${p}) = ${!atteso}`);
  }
});

// repo con file d'esempio (caso onboarding-c: helper in config.ts, compose, immagini)
const a = realpathSync(mkdtempSync(join(tmpdir(), 'mr-env-test-')));
execFileSync('git', ['init', '-q', a]);
write(a, 'src/config.ts', 'const opzionale = (n, d) => process.env[n] ?? d;\nexport const c = {\n  db: obbligatoria("DATABASE_URL"),\n  slack: opzionale("SLACK_BOT_TOKEN", ""),\n  canale: opzionale("SLACK_CANALE_ID", ""),\n};\n');
write(a, 'src/server.ts', 'const p = process.env.APP_PORT;\nconst n = process.env.NODE_ENV;\nconst { HUBSPOT_TOKEN } = process.env;\n');
write(a, 'src/server.test.ts', 'process.env.SOLO_NEI_TEST = "1";\n');
write(a, 'sanamenti/2026-10-13-fix/sana.ts', 'process.env.SCRIPT_DI_UNA_VOLTA;\n');
write(a, 'deploy/docker-compose.yml', 'services:\n  app:\n    image: app:${VERSIONE:-0.1}\n  db:\n    image: postgres@sha256:abc\n  tunnel:\n    image: cloudflare/cloudflared:latest\n  vault:\n    image: vaultwarden/server:latest\n    env_file: vault.env\n    ports: !override []\n');
write(a, 'deploy/vault.env.example', 'ADMIN_TOKEN=\nDOMAIN=\n');
write(a, 'deploy/app.env.example', '# DATABASE_URL=postgres://...\nDATABASE_URL=\nAPP_PORT=3000\nHUBSPOT_TOKEN=\nPOSTGRES_PASSWORD=\nTUNNEL_TOKEN=\nJWT_SECRET=\nVERSIONE=\n');
write(a, 'README.md', '# App\n\nServe `SLACK_BOT_TOKEN` per gli avvisi.\n');
write(a, 'docs/hof-1.md', '# Diario\n\n`SLACK_CANALE_ID`\n');
git(a, 'add', '-A');
git(a, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'uno');

test('esempio come elenco: letti e non elencati, elencati e non letti', () => {
  const r = run(a, 'env', '--format', 'json');
  assert(r.code === 0, `exit ${r.code} ${r.err}`);
  const j = JSON.parse(r.out);
  assert(j.elenco === 'file d\'esempio' && j.esempi.join() === 'deploy/app.env.example,deploy/vault.env.example', `elenco ${j.elenco} ${j.esempi}`);
  assert(nomi(j.non_elencati) === 'SLACK_BOT_TOKEN,SLACK_CANALE_ID', `non elencati: ${nomi(j.non_elencati)}`);
  assert(j.non_elencati.find((x) => x.nome === 'SLACK_BOT_TOKEN').nota === 'citato in un doc', 'nota sul doc vivo');
  assert(!j.non_elencati.find((x) => x.nome === 'SLACK_CANALE_ID').nota, 'un diario (hof) non è un doc vivo');
  assert(nomi(j.non_letti) === 'JWT_SECRET', `non letti: ${nomi(j.non_letti)} (vault.env lo legge l'immagine)`);
  assert(j.esempi_di_immagini.join() === 'deploy/vault.env.example', `esempi di immagini: ${j.esempi_di_immagini}`);
  assert(j.ignorati.some((x) => x.nome === 'NODE_ENV' && x.motivo === 'piattaforma'), 'NODE_ENV ignorato');
  const tutti = JSON.stringify(j);
  assert(!tutti.includes('SOLO_NEI_TEST') && !tutti.includes('SCRIPT_DI_UNA_VOLTA'), 'test e script datati non contano');
  assert(!tutti.includes('postgres://'), 'mai i valori del file d\'esempio');
});

test('mr.coverage.yaml env_ignore, regola env: di mr.claims.ignore, --fail', () => {
  assert(run(a, 'env', '--fail').code === 1, '--fail con nomi non elencati: exit 1');
  write(a, 'mr.coverage.yaml', 'env_ignore:\n  - "SLACK_CANALE_*"\n');
  write(a, 'mr.claims.ignore', 'env:SLACK_BOT_TOKEN\n');
  const j = JSON.parse(run(a, 'env', '--format', 'json').out);
  assert(!j.non_elencati.length, `non elencati: ${nomi(j.non_elencati)}`);
  assert(j.ignorati.some((x) => x.nome === 'SLACK_CANALE_ID' && x.motivo === 'mr.coverage.yaml'), 'env_ignore');
  assert(j.ignorati.some((x) => x.nome === 'SLACK_BOT_TOKEN' && x.motivo === 'regola env:'), 'regola env:');
  const r = run(a, 'env', '--fail');
  assert(r.code === 0 && /Elencati e non letti/.test(r.out) && /JWT_SECRET/.test(r.out), `md o exit: ${r.code}`);
  assert(r.out.includes('MR segnala, non blocca'), 'riga «non blocca» nel md (0.6-z10)');
});

test('--rev legge il commit, senza checkout', () => {
  const j = JSON.parse(run(a, 'env', '--rev', 'HEAD', '--format', 'json').out);
  assert(nomi(j.non_elencati) === 'SLACK_BOT_TOKEN,SLACK_CANALE_ID', `al commit le eccezioni non ci sono ancora: ${nomi(j.non_elencati)}`);
});

// repo senza file d'esempio (l'elenco sono i doc)
const b = realpathSync(mkdtempSync(join(tmpdir(), 'mr-env-test-')));
execFileSync('git', ['init', '-q', b]);
write(b, 'supabase/functions/x/index.ts', 'const u = Deno.env.get("ZONE_A_URL");\nconst k = Deno.env.get("GEMINI_KEY");\n');
write(b, 'backend/auth.ts', 'const s = process.env.APPLE_SERVICE_ID ?? "";\nconst m = process.env.AUTH_MODE;\n');
write(b, 'backend/env.ts', 'export const schema = z.object({\n  REDIS_URL: z.string(),\n});\n');
write(b, 'README.md', '# Backend\n\n| Env | Cosa |\n|---|---|\n| `ZONE_A_URL` | url |\n| `AUTH_MODE` | dev o prod |\n');
git(b, 'add', '-A');

test('senza file d\'esempio l\'elenco sono i doc vivi; schema zod in env.ts', () => {
  const j = JSON.parse(run(b, 'env', '--format', 'json').out);
  assert(j.elenco === 'doc' && j.elencati === null, `elenco ${j.elenco}`);
  assert(nomi(j.non_elencati) === 'APPLE_SERVICE_ID,GEMINI_KEY,REDIS_URL', `non elencati: ${nomi(j.non_elencati)}`);
  assert(!j.non_letti.length, 'senza esempio non c\'è il verso «elencati e non letti»');
});

test('sola lettura: nessun file cambiato', () => {
  const firma = (root) => readdirSync(root, { recursive: true }).filter((f) => !String(f).startsWith('.git')).map((f) => `${f}:${statSync(join(root, String(f))).mtimeMs}`).sort().join('\n');
  const prima = firma(b);
  run(b, 'env');
  assert(firma(b) === prima, 'un file è cambiato');
  assert(run(b, 'env', '--write').code === 2, '--write rifiutato');
});

test('giro: sezione «Elenchi env», ordinata per nomi da guardare, troncata', () => {
  const tanti = Array.from({ length: 20 }, (_, i) => ({ nome: `N_${i}`, refs: [] }));
  const L = sezioneEnv([
    { slug: 'ws', repo: 'pulito', elenco: 'doc', esempi: [], letti: 3, non_elencati: [], non_letti: [] },
    { slug: 'ws', repo: 'app', elenco: 'file d\'esempio', esempi: ['.env.example'], letti: 25, non_elencati: tanti, non_letti: [{ nome: 'JWT_SECRET', refs: [] }] },
  ]).join('\n');
  assert(/letti e non elencati: 20 · elencati e non letti: 1/.test(L), 'totali');
  assert(L.indexOf('| ws | app |') < L.indexOf('| ws | pulito |'), 'ordine');
  assert(/\(\+5\)/.test(L) && /non letti `JWT_SECRET`/.test(L) && !/ws\/pulito:/.test(L), 'elenco dei nomi');
});

rmSync(a, { recursive: true, force: true });
rmSync(b, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} pass\n`);
process.exit(ok === results.length ? 0 : 1);
