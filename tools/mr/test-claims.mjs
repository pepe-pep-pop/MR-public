#!/usr/bin/env node
/**
 * test-claims.mjs — test di `mr claims` (MR v0.6-a, PRD R5 + R11)
 *
 * Costruisce un repo git di prova in una cartella temporanea, con codice, migration,
 * package.json, Makefile, workflow CI, .env.example e un .env con un valore segreto,
 * più un doc che contiene claim di ogni tipo. Controlla:
 *   - estrazione e classificazione (unit);
 *   - un caso found e uno not_found per ogni tipo (N8);
 *   - ambiguous, allow-list, marcatore inline;
 *   - --rev legge un commit vecchio senza checkout (HEAD e working tree invariati);
 *   - il .env non viene letto e il valore segreto non compare mai nell'output;
 *   - exit code 0 / 1 / 2, formato json, nessuna scrittura su disco.
 *
 * Invocazione: node tools/mr/test-claims.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { classifySpan, extractClaims } from './lib/extract.mjs';
import { Lookup } from './lib/lookup.mjs';
import { checkClaim } from './lib/check.mjs';
import { verifiedCause } from './lib/cause.mjs';
import { isSecretPath } from './lib/repo.mjs';
import { RepoView } from './lib/repo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const SECRET_VALUE = 'valore-segreto-da-non-stampare';

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf-8' });
}

const DOC = `---
mr_version: '0.5'
id: test/readme
title: Readme di prova
type: reference
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
---

# Readme di prova

## Codice

La quota si calcola in \`src/lib/fees.ts\` con \`calcolaQuota()\`. Il vecchio \`src/lib/old-fees.ts\` e \`calcolaVecchio()\` non ci sono più.
La funzione \`calcolaSconto()\` arriva da una libreria esterna.
Edge function: \`supabase/functions/sync-gcal/\` · da doc: \`../src/lib/fees.ts\` · suffisso: \`functions/sync-gcal/index.ts\`.
Configurazione: \`fees.ts\` e \`mancante.json\`. Repo: \`acme/app-web\`.

## Ambiente

Servono \`APP_RESEND_API_KEY\`, \`PROJECT_URL\` (in .env.example), \`GH_DEPLOY_KEY\` (workflow) e \`RESEND_API_KEY\` (non esiste).
Il segreto \`SECRET_TOKEN_X\` sta solo nel .env, che non si legge. \`LEGACY_FLAG\` è in allow-list.
\`NON_ESISTE_MA_IGNORATA\` <!-- mr:ignore-claim -->

## Dati

Tabella \`portali.spedizioni\`, colonna \`spedizioni.stato\`; non esiste \`portali.ordini\`. Campo \`guida.prezzo\` usato nel codice.
Output del custom code: \`dedup_should_block\`; colonna \`data_consegna\` (migration); \`campo_rimosso\` non c'è più.

## API

\`POST /api/ordini\` esiste, \`GET /api/ordini/:id\` anche (prefisso), \`DELETE /api/clienti\` no.
\`POST /functions/v1/sync-gcal\` sì, \`POST /functions/v1/sync-old\` no.

## Comandi

\`pnpm run deploy:moduli\`, \`npm test\`, \`npm run sparito\`, \`make build-docs\`, \`make pulisci\`, \`pnpm install\` (builtin, non è un claim).

\`\`\`bash
pnpm run deploy:moduli && make build-docs
npm run script-tolto
\`\`\`

\`\`\`ts
// nei blocchi non shell non si estrae nulla: \`src/inesistente.ts\`
\`\`\`
`;

function buildRepo() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'mr-claims-test-')));
  execFileSync('git', ['init', '-q', root]);
  write(root, 'src/lib/fees.ts', [
    'export function calcolaQuota(importo: number) {',
    '  const key = Deno.env.get("APP_RESEND_API_KEY");',
    '  return calcolaSconto(importo);',
    '}',
    'export const prezzo = (g: any) => g.guida.prezzo ?? guida.prezzo;',
    '',
  ].join('\n'));
  write(root, 'src/server.ts', "app.post('/api/ordini', handler);\napp.get('/api/ordini/:id', h2);\n");
  write(root, 'supabase/functions/sync-gcal/index.ts', 'Deno.serve(() => new Response("ok"));\n');
  write(root, 'supabase/migrations/001_init.sql', 'create table portali.spedizioni (id int, stato text, data_consegna date);\n');
  write(root, 'hubspot/dedup.js', 'exports.main = async (event, callback) => {\n  callback({ outputFields: {\n    dedup_should_block: false,\n  } });\n};\n');
  write(root, 'package.json', JSON.stringify({ name: 'x', scripts: { 'deploy:moduli': 'echo', test: 'echo' } }, null, 2));
  write(root, 'Makefile', 'build-docs:\n\techo ok\n');
  write(root, '.github/workflows/ci.yml', 'env:\n  GH_DEPLOY_KEY: ${{ secrets.GH_DEPLOY_KEY }}\n');
  write(root, '.env.example', 'PROJECT_URL=\n');
  write(root, '.env', `SECRET_TOKEN_X=${SECRET_VALUE}\n`);
  write(root, '.gitignore', '.env\n');
  write(root, 'mr.claims.ignore', '# allow-list di prova\nenv:LEGACY_*\n');
  write(root, 'docs/README.md', DOC);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'primo');
  return root;
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[relative(dir, p)] = createHash('sha256').update(readFileSync(p)).digest('hex');
    }
  };
  walk(dir);
  return JSON.stringify(out);
}

function run(cwd, ...args) {
  const r = spawnSync(process.execPath, [MR, ...args], { cwd, encoding: 'utf-8' });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

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
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log('\ntest-claims.mjs\n');

// ── unit: classificazione ──
test('classifySpan: un esempio per tipo, e i non-claim', () => {
  const k = (s) => classifySpan(s)?.kind ?? null;
  const cases = {
    'src/lib/fees.ts': 'path', 'fees.ts': 'path', 'supabase/functions/x/': 'path',
    APP_RESEND_API_KEY: 'env', '$PROJECT_URL': 'env', 'process.env.API_ROOT_URL': 'env',
    'portali.spedizioni': 'table', 'POST /api/ordini': 'endpoint',
    'pnpm run deploy:moduli': 'command', 'npm test': 'command', 'make build-docs': 'command',
    'calcolaQuota()': 'symbol', 'utils.formatDate(x)': 'symbol', 'node scripts/run.mjs': 'path',
    dedup_should_block: 'identifier', codice_posizione: 'identifier', link_2: 'identifier',
    // non identificatori: camelCase, maiuscolo (env), trattino, troppo corto, underscore iniziale
    codicePosizione: null, 'sync-gcal': null, pg_cron: null,
    // 0.6-g: virgolette incollate, intervalli, scope OAuth, output di build
    "npm run build'\"": 'command', 'hof-pb-1..6.md': null, 'calendar.events.readonly': null,
    'crm.objects.contacts': null, 'gmail.send': null, 'apps/spedizioni/.output': null, 'dist/index.js': null, 'npm run': null,
    'GET /api/v2/space/90040200809/list': null,
    // 0.6-n: un file con estensione «ignore» non è una tabella; node_modules non è un identificatore
    'mr.claims.ignore': 'path', node_modules: null, a_b: null, _privato: null, Codice_posizione: null,
    // non-claim
    'https://example.com/a.ts': null, 'npm install': null, 'pnpm add x': null, 'console.log()': null,
    'fetch()': null, '<id>/index.ts': null, '*.ttl': null, '.env.local': null, 'example.com': null,
    'hello world': null, 'API': null, '/srv/app/config.json': null, 'send.example.com': null,
    'moduli.example.dev/api/x': null, 'WhatsApp/2.23': null, 'YYYY-MM-DD_slug.md': null, 'segnalazioni/YYYY-MM-DD.md': null,
  };
  for (const [span, kind] of Object.entries(cases)) {
    assert(k(span) === kind, `${span}: atteso ${kind}, ottenuto ${k(span)}`);
  }
});

test('extractClaims: frontmatter saltato, sezione e riga, blocchi shell sì e ts no, marcatore inline', () => {
  const claims = extractClaims(DOC);
  assert(!claims.some((c) => c.key === 'test/readme'), 'il frontmatter non va analizzato');
  const fees = claims.find((c) => c.key === 'src/lib/fees.ts');
  assert(fees && fees.section === '## Codice' && fees.line === 16, `riga/sezione errate: ${JSON.stringify(fees)}`);
  assert(claims.some((c) => c.key === 'script-tolto' && c.kind === 'command'), 'comando nel blocco bash non estratto');
  assert(!claims.some((c) => c.key === 'src/inesistente.ts'), 'estratto un claim da un blocco ts');
  assert(!claims.some((c) => c.key === 'NON_ESISTE_MA_IGNORATA'), 'il marcatore mr:ignore-claim non ha effetto');
  assert(!claims.some((c) => c.text === 'pnpm install'), 'pnpm install non è un claim');
});

// ── integrazione ──
const root = buildRepo();
const head = git(root, 'rev-parse', 'HEAD').trim();

let report;
test('json: esiti attesi per ogni tipo', () => {
  const r = run(root, 'claims', 'docs/README.md', '--format', 'json', '--fail');
  assert(r.code === 1, `exit atteso 1 con --fail (ci sono not_found), ottenuto ${r.code}\n${r.err}`);
  // 0.6-z10 (M2): senza --fail, 0 anche con not_found (MR segnala, non blocca)
  const senza = run(root, 'claims', 'docs/README.md', '--format', 'json');
  assert(senza.code === 0, `senza --fail exit atteso 0, ottenuto ${senza.code}`);
  report = JSON.parse(r.out);
  const st = (claim) => report.claims.find((c) => c.claim === claim)?.status;
  const expect = {
    'src/lib/fees.ts': 'found', 'src/lib/old-fees.ts': 'not_found',
    'calcolaQuota()': 'found', 'calcolaVecchio()': 'not_found', 'calcolaSconto()': 'ambiguous',
    'supabase/functions/sync-gcal/': 'found', '../src/lib/fees.ts': 'found',
    'functions/sync-gcal/index.ts': 'found', 'fees.ts': 'found', 'mancante.json': 'not_found',
    'acme/app-web': 'ambiguous',
    APP_RESEND_API_KEY: 'found', PROJECT_URL: 'found', GH_DEPLOY_KEY: 'found', RESEND_API_KEY: 'not_found',
    SECRET_TOKEN_X: 'not_found', LEGACY_FLAG: 'ignored',
    'portali.spedizioni': 'found', 'spedizioni.stato': 'found', 'portali.ordini': 'not_found',
    'guida.prezzo': 'found',
    dedup_should_block: 'found', data_consegna: 'found', campo_rimosso: 'not_found',
    'POST /api/ordini': 'found', 'GET /api/ordini/:id': 'found', 'DELETE /api/clienti': 'not_found',
    'POST /functions/v1/sync-gcal': 'found', 'POST /functions/v1/sync-old': 'not_found',
    'pnpm run deploy:moduli': 'found', 'npm test': 'found', 'npm run sparito': 'not_found',
    'make build-docs': 'found', 'make pulisci': 'not_found', 'npm run script-tolto': 'not_found',
  };
  const wrong = Object.entries(expect).filter(([c, s]) => st(c) !== s).map(([c, s]) => `${c}: atteso ${s}, ottenuto ${st(c)}`);
  assert(!wrong.length, wrong.join('\n     '));
  assert(report.summary.total === report.claims.length, 'summary incoerente');
  const m = (claim) => report.claims.find((c) => c.claim === claim)?.method;
  assert(m('dedup_should_block') === 'code-word' && m('data_consegna') === 'schema', `metodi identificatore: ${m('dedup_should_block')}, ${m('data_consegna')}`);
});

test('nessuna lettura del .env: il valore segreto non compare in nessun output', () => {
  for (const fmt of ['json', 'md']) {
    const r = run(root, 'claims', 'docs', '--format', fmt, '--all');
    assert(!(r.out + r.err).includes(SECRET_VALUE), `valore segreto nell'output ${fmt}`);
  }
  // l'evidenza è solo path:riga
  for (const c of report.claims) {
    for (const e of c.evidence) assert(Object.keys(e).every((k) => k === 'path' || k === 'line'), `evidenza con contenuto: ${JSON.stringify(e)}`);
  }
});

test('nomi con SECRET/SEGRETI (0.6-z5): i doc .md si leggono, gli altri file no', () => {
  write(root, 'docs/note-secret.md', '# Note sui segreti\n\nIl token sta in `src/lib/fees.ts`.\n');
  const r = run(root, 'claims', 'docs', '--format', 'json');
  const rep = JSON.parse(r.out);
  assert(!(rep.skipped_docs || []).includes('docs/note-secret.md') && (rep.docs_checked || rep.docs || []).toString() !== '', 'il doc .md con «secret» nel nome va letto');
  assert(JSON.stringify(rep).includes('docs/note-secret.md'), `il doc non risulta nel report: ${r.out.slice(0, 400)}`);
  for (const [p, atteso] of [['SEGRETI_PRODUZIONE.txt', true], ['config/app.secret.json', true], ['docs/D22-secret-in-chiaro.md', false], ['docs/SEGRETI.mdx', false], ['.env', true], ['.env.example', false], ['certs/server.key', true]]) {
    assert(isSecretPath(p) === atteso, `isSecretPath(${p}) = ${!atteso}`);
  }
  rmSync(join(root, 'docs/note-secret.md'));
});

test('md: doc in testa, solo not_found e ambiguous di default, tutto con --all', () => {
  const r = run(root, 'claims', 'docs');
  assert(r.code === 0, `exit ${r.code} (0.6-z10: 0 anche con not_found)`);
  assert(r.out.includes('MR segnala, non blocca'), 'riga «non blocca» in testa al report md');
  assert(r.out.includes('## docs/README.md') && r.out.includes('❌ not_found'), 'report md incompleto');
  assert(!r.out.includes('✅ found |'), 'i found non vanno mostrati di default');
  assert(run(root, 'claims', 'docs', '--all').out.includes('✅ found |'), '--all deve mostrare i found');
});

test('--rev: legge il commit vecchio senza checkout', () => {
  // secondo commit: calcolaQuota rinominata
  const src = readFileSync(join(root, 'src/lib/fees.ts'), 'utf-8').replace('calcolaQuota', 'calcolaRata');
  write(root, 'src/lib/fees.ts', src);
  git(root, 'commit', '-q', '-am', 'rinomina');
  const statusBefore = git(root, 'status', '--porcelain');
  const headBefore = git(root, 'rev-parse', 'HEAD').trim();
  const now = JSON.parse(run(root, 'claims', 'docs/README.md', '--format', 'json').out);
  const old = JSON.parse(run(root, 'claims', 'docs/README.md', '--format', 'json', '--rev', head).out);
  const st = (rep) => rep.claims.find((c) => c.claim === 'calcolaQuota()').status;
  assert(st(now) === 'not_found', `HEAD: atteso not_found, ottenuto ${st(now)}`);
  assert(st(old) === 'found', `commit vecchio: atteso found, ottenuto ${st(old)}`);
  assert(old.rev === head.slice(0, old.rev.length), 'rev nel report errato');
  assert(git(root, 'rev-parse', 'HEAD').trim() === headBefore, 'HEAD cambiato');
  assert(git(root, 'status', '--porcelain') === statusBefore, 'working tree cambiato');
});

test('exit code: 0 senza not_found, 2 su errori d\'uso', () => {
  write(root, 'docs/ok.md', '# Ok\n\nVedi `src/lib/fees.ts` e `npm test`.\n');
  assert(run(root, 'claims', 'docs/ok.md').code === 0, 'doc senza not_found deve dare 0');
  assert(run(root, 'claims', 'docs/ok.md', '--format', 'xml').code === 2, 'formato sconosciuto → 2');
  assert(run(root, 'claims', 'docs/ok.md', '--forza').code === 2, 'flag sconosciuto → 2');
  assert(run(root, 'boh', 'docs').code === 2, 'sottocomando sconosciuto → 2');
  assert(run(root, 'claims', 'docs/ok.md', '--rev', 'nonesiste').code === 2, 'rev inesistente → 2');
  assert(run(root, 'claims', 'non/esiste.md').code === 2, 'path inesistente → 2');
});

test('lookup: indice completo (>20 parole) uguale alla ricerca mirata; confine nelle definizioni SQL', () => {
  write(root, 'supabase/migrations/002_fn.sql', 'create or replace function public.set_updated_at_x() returns trigger as $$ begin end $$;\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'sql');
  const repo = new RepoView(root);
  const words = ['APP_RESEND_API_KEY', 'calcolaRata', 'calcolaSconto', 'stato', 'spedizioni', 'portali', 'set_updated_at_x'];
  const filler = Array.from({ length: 20 }, (_, i) => `PAROLA_ASSENTE_${i}`);
  const bulk = new Lookup(repo);
  bulk.prefetch({ words: [...words, ...filler] });
  const single = new Lookup(repo);
  for (const w of words) {
    const a = JSON.stringify(bulk.word(w));
    const b = JSON.stringify(single.word(w));
    assert(a === b, `${w}: indice ${a} ≠ mirata ${b}`);
    assert(bulk.word(w).length > 0, `${w} non trovato`);
  }
  assert(bulk.word('PAROLA_ASSENTE_3').length === 0, 'parola assente trovata');
  assert(single.sqlDefinition('set_updated_at_x').length === 1, 'definizione SQL non trovata');
  assert(single.sqlDefinition('set_updated_at').length === 0, 'set_updated_at non deve corrispondere a set_updated_at_x');
});

test('path con il nome del repo davanti; allow-list doc: e --ignore-file', () => {
  const name = root.split('/').pop();
  write(root, 'docs/altro-repo.md', `# Spec per un altro repo\n\nVedi \`routes/inesistente.ts\` e \`${name}/src/lib/fees.ts\`.\n`);
  const plain = JSON.parse(run(root, 'claims', 'docs/altro-repo.md', '--format', 'json').out);
  const st = (rep, c) => rep.claims.find((x) => x.claim === c)?.status;
  assert(st(plain, `${name}/src/lib/fees.ts`) === 'found', 'prefisso col nome del repo non riconosciuto');
  assert(st(plain, 'routes/inesistente.ts') === 'not_found', 'atteso not_found senza allow-list');
  const ext = join(dirname(root), `${name}.claims.ignore`);
  writeFileSync(ext, 'doc:docs/altro-repo.md\n');
  const r = run(root, 'claims', 'docs/altro-repo.md', '--format', 'json', '--ignore-file', ext);
  assert(r.code === 0, `con l'allow-list esterna atteso exit 0, ottenuto ${r.code}`);
  assert(JSON.parse(r.out).claims.every((c) => c.status === 'ignored'), 'regola doc: non applicata');
  assert(run(root, 'claims', 'docs/altro-repo.md', '--ignore-file', ext + '.manca').code === 2, 'allow-list mancante → 2');
  rmSync(ext);
  rmSync(join(root, 'docs/altro-repo.md'));
});

test('--code-repo: doc in un repo, codice in un altro (R10 minimo)', () => {
  const docs = realpathSync(mkdtempSync(join(tmpdir(), 'mr-claims-docs-')));
  execFileSync('git', ['init', '-q', docs]);
  const name = root.split('/').pop();
  write(docs, 'note.md', `# Note sul codice\n\n\`src/lib/fees.ts\`, \`monorepo/apps/${name}/src/server.ts\`, \`src/sparito.ts\`, \`calcolaRata()\`.\n`);
  const alone = JSON.parse(run(docs, 'claims', 'note.md', '--format', 'json').out);
  assert(alone.claims.every((c) => c.status !== 'found'), 'senza --code-repo nulla deve risultare trovato');
  const r = run(docs, 'claims', 'note.md', '--format', 'json', '--code-repo', root);
  const rep = JSON.parse(r.out);
  const st = (c) => rep.claims.find((x) => x.claim === c)?.status;
  assert(st('src/lib/fees.ts') === 'found', 'path nel repo di codice non trovato');
  assert(st(`monorepo/apps/${name}/src/server.ts`) === 'found', 'path con il nome del repo nel mezzo non trovato');
  assert(st('src/sparito.ts') === 'not_found', 'path assente: atteso not_found');
  assert(st('calcolaRata()') === 'found', 'simbolo nel repo di codice non trovato');
  assert(rep.claims.find((x) => x.claim === 'src/lib/fees.ts').code_repo === name, 'code_repo mancante nel record');
  assert(run(docs, 'claims', 'note.md', '--code-repo', join(docs, 'manca')).code === 2, 'cartella inesistente → 2');
  rmSync(docs, { recursive: true, force: true });
});

test('doc storici (nota A7): nessun segnale, exit 0, una riga informativa', () => {
  const nf = '# Vecchio\n\nCitava `src/lib/rimosso.ts`.\n';
  write(root, 'vari/docs/_archive/vecchio.md', nf);
  write(root, 'vari/docs/superpowers/plans/piano.md', nf);
  write(root, 'vari/superato.md', `---\nstatus: superseded\n---\n${nf}`);
  write(root, 'vari/regola.md', nf);
  const ext = join(dirname(root), 'storico.claims.ignore');
  writeFileSync(ext, 'storico:vari/regola.md\n');
  const r = run(root, 'claims', 'vari', '--ignore-file', ext);
  assert(r.code === 0, `atteso exit 0 (solo doc storici), ottenuto ${r.code}\n${r.out}`);
  for (const [doc, why] of [['vari/docs/_archive/vecchio.md', 'cartella _archive/'], ['vari/docs/superpowers/plans/piano.md', 'piani chiusi'], ['vari/superato.md', 'status: superseded'], ['vari/regola.md', 'regola storico']]) {
    assert(r.out.includes(doc) && r.out.includes(why), `riga informativa mancante per ${doc}\n${r.out}`);
  }
  assert(!r.out.includes('❌ not_found |'), 'i doc storici non devono avere righe di dettaglio');
  const j = JSON.parse(run(root, 'claims', 'vari', '--format', 'json', '--ignore-file', ext).out);
  assert(j.summary.not_found === 0 && j.summary.historical_not_found === 4, `summary errato: ${JSON.stringify(j.summary)}`);
  rmSync(ext);
  rmSync(join(root, 'vari'), { recursive: true, force: true });
});

test('identificatore in un repo di soli doc: ambiguous (no-code), non not_found', () => {
  const only = realpathSync(mkdtempSync(join(tmpdir(), 'mr-claims-nocode-')));
  execFileSync('git', ['init', '-q', only]);
  write(only, 'docs/a.md', '# A\n\n`codice_posizione`\n');
  git(only, 'add', '-A');
  git(only, 'commit', '-q', '-m', 'doc');
  const res = checkClaim(new RepoView(only), { kind: 'identifier', text: 'codice_posizione', key: 'codice_posizione' }, 'docs/a.md');
  rmSync(only, { recursive: true, force: true });
  assert(res.status === 'ambiguous' && res.method === 'no-code', JSON.stringify(res));
});

test('esito external (0.6-f): file-stem, classe esterno:, --external-repo, esterni in mr.repos.yaml', () => {
  const app = realpathSync(mkdtempSync(join(tmpdir(), 'mr-claims-app-')));
  const backend = realpathSync(mkdtempSync(join(tmpdir(), 'mr-claims-backend-')));
  for (const r of [app, backend]) execFileSync('git', ['init', '-q', r]);
  write(backend, 'supabase/migrations/001.sql', 'create function check_answer() returns int as $$ select 1 $$ language sql;\n');
  git(backend, 'add', '-A');
  git(backend, 'commit', '-q', '-m', 'b');
  write(app, 'Sources/App.swift', 'let x = 1\n');
  write(app, 'templates/conferma_docente.html', '<p>ok</p>\n');
  write(app, 'mr.claims.ignore', 'esterno:hs_*   # proprietà native HubSpot\nidentifier:tolto_apposta\n');
  write(app, 'docs/a.md', '# A\n\n`check_answer`, `conferma_docente`, `hs_lead_status`, `tolto_apposta`, `davvero_assente`\n');
  git(app, 'add', '-A');
  git(app, 'commit', '-q', '-m', 'a');
  const st = (out) => Object.fromEntries(JSON.parse(out).claims.map((c) => [c.claim, `${c.status}/${c.method}`]));
  try {
    const plain = run(app, 'claims', 'docs/a.md', '--format', 'json');
    const a = st(plain.out);
    assert(a.check_answer === 'not_found/word', `senza repo esterno: ${a.check_answer}`);
    assert(a.conferma_docente === 'found/file-stem', `file-stem: ${a.conferma_docente}`);
    assert(a.hs_lead_status === 'external/dichiarato', `classe esterno: ${a.hs_lead_status}`);
    assert(a.tolto_apposta === 'ignored/allow-list', `identifier: nell'allow-list: ${a.tolto_apposta}`);
    const withExt = run(app, 'claims', 'docs/a.md', '--format', 'json', '--external-repo', backend, '--fail');
    const b = st(withExt.out);
    assert(b.check_answer === 'external/repo-esterno' && b.davvero_assente === 'not_found/word', JSON.stringify(b));
    assert(withExt.code === 1, 'davvero_assente resta un segnale: exit 1 con --fail');
    // stesso effetto con esterni: in mr.repos.yaml (path relativo alla root del repo dei doc)
    write(app, 'mr.repos.yaml', `repos:\n  backend: ${relative(app, backend)}\nesterni: [backend]\n`);
    const c = st(run(app, 'claims', 'docs/a.md', '--format', 'json').out);
    assert(c.check_answer === 'external/repo-esterno', `esterni in mr.repos.yaml: ${c.check_answer}`);
    // md di default: external non compare tra i segnali
    const md = run(app, 'claims', 'docs/a.md').out;
    assert(!md.includes('`check_answer`') && md.includes('external 2'), md);
  } finally {
    rmSync(app, { recursive: true, force: true });
    rmSync(backend, { recursive: true, force: true });
  }
});

test('causa verificata (0.6-g): un commit che AGGIUNGE il nome non è la causa; quello che lo toglie sì', () => {
  const r = realpathSync(mkdtempSync(join(tmpdir(), 'mr-claims-cause-')));
  execFileSync('git', ['init', '-q', r]);
  const commit = (m) => { git(r, 'add', '-A'); git(r, 'commit', '-q', '-m', m); return git(r, 'rev-parse', '--short', 'HEAD').trim(); };
  write(r, 'src/a.ts', 'export const quota_mensile = 1;\n');
  write(r, 'src/vecchio.ts', 'x\n');
  commit('primo');
  write(r, 'src/a.ts', 'export const altro = 1;\n');
  const tolto = commit('toglie quota_mensile');
  write(r, 'db/m.sql', '-- il prerender di positions.json non esiste più\n');
  commit('aggiunge solo un commento con positions.json');
  rmSync(join(r, 'src/vecchio.ts'));
  const cancellato = commit('cancella vecchio.ts');
  const v = new RepoView(r);
  const c1 = verifiedCause(v, { kind: 'identifier', key: 'quota_mensile', claim: 'quota_mensile' });
  const c2 = verifiedCause(v, { kind: 'path', key: 'positions.json', claim: 'positions.json' });
  const c3 = verifiedCause(v, { kind: 'path', key: 'src/vecchio.ts', claim: 'src/vecchio.ts' });
  const c4 = verifiedCause(v, { kind: 'path', key: 'vecchio.ts', claim: 'vecchio.ts' });
  rmSync(r, { recursive: true, force: true });
  assert(c1?.hash === tolto, `identifier: atteso ${tolto}, ottenuto ${JSON.stringify(c1)}`);
  assert(c2 === null, `positions.json mai esistito come file: atteso null, ottenuto ${JSON.stringify(c2)}`);
  assert(c3?.hash === cancellato && c4?.hash === cancellato, `path cancellato: ${JSON.stringify([c3, c4])}`);
});

test('sola lettura: nessun file creato o modificato', () => {
  const before = snapshot(root);
  run(root, 'claims', 'docs', '--format', 'json');
  run(root, 'claims', 'docs', '--all');
  run(root, 'claims', 'docs', '--rev', head);
  assert(snapshot(root) === before, 'il filesystem è cambiato');
});

rmSync(root, { recursive: true, force: true });

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
