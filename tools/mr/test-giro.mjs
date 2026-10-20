#!/usr/bin/env node
/**
 * test-giro.mjs — test del giro settimanale (report/0.6-f/regole.md §4).
 *
 * Indice di prova con un workspace attivo (due repo: app + backend), uno in archivio,
 * uno app-web e uno senza git. Controlla: parsing dell'indice, esclusioni, repo fratelli
 * come esterni, id e colonna esito, nessuna scrittura senza --write, --write solo nella
 * cartella indicata, precisione in uso.
 *
 * Invocazione: node tools/mr/test-giro.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseIndice, precisione, workspaceRepos } from './giro.mjs';
import { toSegnalazioni } from './lib/segnalazione.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GIRO = join(here, 'giro.mjs');

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}
function gitInit(root) {
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '-A']);
  execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'x']);
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
function assert(c, m) {
  if (!c) throw new Error(m);
}

console.log('\ntest-giro.mjs\n');
// il giro con --write riscrive anche l'indice dei doc (0.6-z17): nei test mai quello vero in ~/.mr/indice
process.env.MR_INDICE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mr-indice-'));
const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-giro-')));
const ws = join(base, 'ws');
// app: primo commit con src/tolto.ts e nome_tolto, secondo commit li toglie (prova di deriva)
write(ws, 'app/src/main.ts', 'export const presente_qui = 1;\nexport const nome_tolto = 2;\nexport const nome_ref = 3;\n');
write(ws, 'app/src/tolto.ts', 'export const x = 1;\n');
// copia di riferimento di un altro progetto: nome_ref resta qui anche dopo che il codice vero l'ha tolto
write(ws, 'app/ref/copia.ts', 'export const nome_ref = 3;\n');
gitInit(join(ws, 'app'));
write(ws, 'app/src/main.ts', 'export const presente_qui = 1;\n');
rmSync(join(ws, 'app/src/tolto.ts'));
write(ws, 'app/docs/e.md', '# E\n\nIl valore sta in `nome_ref`.\n');
write(ws, 'app/docs/g.md', '# G\n\n> Aggiornamento 03/10: `src/tolto.ts` e altro\n> sono stati tolti il 20/08, i passi che li toccano non servono più.\n');
write(ws, 'app/docs/a.md', '# A\n\n`src/main.ts`, `src/tolto.ts`, `nome_tolto`, `presente_qui`, `check_answer` (backend), `supabase/migrations/1.sql` (backend), `davvero_assente`, `mai_esistito()`.\n');
write(ws, 'app/docs/piano-vecchio.md', '# Piano\n\n`src/tolto.ts`\n');
write(ws, 'app/docs/note/2026-09-10/x.md', '# Nota del giorno\n\n`src/tolto.ts`\n');
write(ws, 'app/docs/b.md', '# B\n\nNella 0.2 abbiamo rimosso il vecchio modulo:\n`src/tolto.ts`, a capo nello stesso paragrafo.\n');
write(ws, 'app/docs/c.md', '# C\n\nFino al 30/06 era tutto in `src/tolto.ts`.\n\nEsempio — `nome_tolto` si scrive così.\n\n## Convenzioni di naming\n\n| file | `src/tolto.ts` |\n');
write(ws, 'app/docs/rework-0.7.0.md', '# Release\n\n`src/tolto.ts`\n');
// 0.6-j: pacchetti di modifica, runbook di applicazione, delta, note datate senza anno, design, recon
for (const d of ['code/136_griglia/README.md', 'code/doc/runbook_apply_x.md', 'code/doc/schema_delta_a.md', 'doc/24-07-pm.md', 'doc/design/refactor.md', 'doc/recon-backend-1.md']) write(ws, `app/${d}`, '# X\n\n`src/tolto.ts`\n');
write(ws, 'app/docs/d.md', [
  '# D', '', 'Nota: il legacy aveva `nome_tolto`.', '', 'Viene da `src/tolto.ts`, che è nel template di Lovable.', '',
  'Con la v3 ce l\'avevano in `nome_tolto`.', '', 'Edge function `nome_tolto` (futuro).', '', 'Si usa `presente_qui` (non `nome_tolto`).', '',
  '| campo | stato |', '|---|---|', '| altro | il legacy aveva altro |', '| `src/tolto.ts` | serve ancora |', '',
].join('\n'));
write(ws, 'app/docs/audit-api.md', '# Audit\n\n`src/tolto.ts`\n');
execFileSync('git', ['-C', join(ws, 'app'), 'add', '-A']);
execFileSync('git', ['-C', join(ws, 'app'), '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'togli']);
write(ws, 'backend/supabase/migrations/1.sql', 'create function check_answer() returns int as $$ select 1 $$ language sql;\n');
gitInit(join(ws, 'backend'));
mkdirSync(join(base, 'senza-git'), { recursive: true });
const indice = join(base, 'indice.md');
writeFileSync(indice, [
  '# Indice', '', '**Archivio:** `vecchio`.', '',
  '| Slug | Gruppo | Path | Nota |', '|---|---|---|---|',
  `| \`ws\` | software | \`${ws}\` | — |`,
  `| \`vecchio\` | software | \`${ws}\` | — |`,
  `| \`crawl\` | archivio | \`${ws}\` | — |`,
  `| \`nogit\` | software | \`${join(base, 'senza-git')}\` | — |`, '',
].join('\n'));
const run = (...a) => spawnSync(process.execPath, [GIRO, ...a], { encoding: 'utf-8', cwd: base });

test('motivi in appendice (0.6-j): storico, planned, negato, esempio — prima di cercare la causa', () => {
  const lines = {
    1: 'Nota: il legacy aveva `nome_x`.', 2: 'Edge function `nome_x` (futuro).', 3: 'Si usa `altro_y` (non `nome_x`).',
    4: 'Esempio — `nome_x`.', 5: 'Rebrand del portale da `nome_x` a `altro_y`.', 6: 'Viene da `nome_x`, che è nel template TanStack.',
    7: '| Registro presenze. `nome_x` → `altro_y` | AP `b4cb07a` |', 8: '| Reset password (lista `nome_x`) | AP `d003015` | pagina 200 |',
    9: 'Se è un problema, si torna a una password propria (`nome_x`). Decisione organizzativa, non tecnica.',
    10: '| `nome_x` | serve ancora | `d003015` |',
    11: 'Nessun Cloudflare Access né scorciatoia `nome_x`. In locale si usa altro.',
    12: 'Non solo `nome_x`: serve anche altro.',
    13: '- Non modificare `nome_x` o il client generato.',
    14: '`nome_x` è stata rinominata `altro_y` con b4cb07a.',
    15: '### C.5 `altro_y` (ex `nome_x`) e `SUPPORT_CONTACT` — fatto',
    16: '| Visibilità | chiave in `allowed_tabs` (dal 03/10; prima la whitelist `nome_x` in `env.ts`) | ok |',
    17: '**Fonte:** `PRD_V1.5_IT.md` §8.1 (oggi `altro.md`; la V1.5 è diventata V1.6 con la revisione)',
    // 0.6-r: il verbo vale per il nome a cui si riferisce, non per tutti i nomi della riga (app-web)
    18: '- `nome_x` (pagina), `DiagnosticaAuditLog.tsx` (sostituita da `/admin/log`)',
    19: '| `nome_x` | attivo | `vecchio.ts` rimosso |',
    20: 'La tabella `nome_x` contiene le prenotazioni cancellate.',
    21: 'Il bottone è stato tolto da `nome_x`.',
    22: '`nome_x` resta — `b.ts` rimosso — e `c.ts` invariato.',
    23: 'Nella 0.2 abbiamo rimosso il vecchio modulo: `nome_x`, a capo nello stesso paragrafo.',
    24: '| `altro.ts` | Back-compat alias. Rebrand B.0 2026-04-24 da `nome_x` (ARCH-4). |',
    // stessa riga, altro nome: il rebrand vale solo per il nome dopo «da» (giro 3, vera)
    25: '| `altro.ts` | preset `nome_x` (50/10). Rebrand B.0 2026-04-24 da `vecchio.ts` (ARCH-4). |',
    // 0.6-s: «superati» = test passati, nel paragrafo; «Superato dall'…» legato al nome della riga
    26: 'Verifica a 320/1440 px del layout descritto in `nome_x`. Typecheck e build superati.',
    27: "| Wrapper iOS | stessa storia, cartella `nome_x` | Superato dall'app nativa |",
    28: 'Piani chiusi (`nome_x`), `status` superseded / deprecated / done, cartelle `_archive/`.',
  };
  const claimOf = (n) => (n === 17 ? 'PRD_V1.5_IT.md' : 'nome_x');
  const recs = Object.keys(lines).map((n) => ({ doc: 'a.md', line: Number(n), section: '# A', kind: 'identifier', claim: claimOf(Number(n)), key: claimOf(Number(n)), status: 'not_found' }));
  // la riga 10 sta in una tabella senza colonne da registro: deve arrivare alla ricerca della causa
  const headers = { 7: '| Punto | Chi | Prova |', 8: '| Punto | Chi | Prova |', 10: '| nome | stato | ref |' };
  let causeAsked = [];
  const fakeRepo = { rev: 'HEAD', git: () => { throw new Error('no'); }, grepMatches: () => [], listFiles: () => [], hasDir: () => false, root: '/nonexistent' };
  const out = toSegnalazioni({ repo: 'r', tool: 'mr' }, recs, [], () => fakeRepo, {
    onlyCaused: true, lineText: (d, n) => lines[n], rawLine: (d, n) => lines[n], tableHeader: (d, n) => headers[n] || '',
    reposForDoc: () => { causeAsked.push(1); return []; },
  });
  const why = Object.fromEntries(out.appendix.map((a) => [a.line, a.reason.split(':')[0]]));
  assert(why[1] === 'storico' && why[2] === 'planned' && why[3] === 'negato' && why[4] === 'esempio' && why[5] === 'storico' && why[6] === 'storico', JSON.stringify(why));
  assert(why[7] === 'storico' && why[8] === 'storico' && why[9] === 'opzione', `registro, rename, opzione (0.6-k): ${JSON.stringify(why)}`);
  assert(why[11] === 'negato', `«né scorciatoia \`x\`» (0.6-o): ${why[11]}`);
  assert(why[12] === 'nessuna prova che sia esistito', `«non solo \`x\`» afferma x: si cerca la causa (${why[12]})`);
  assert(why[13] === 'nessuna prova che sia esistito', `«non modificare \`x\`» presuppone x (vera nel giro 3): ${why[13]}`);
  for (const k of [14, 15, 16, 17]) assert(why[k] === 'storico', `riga ${k} (0.6-q, rinominata / ex / prima la whitelist / diventata): ${why[k]}`);
  for (const k of [18, 19, 20, 21, 22, 25, 26, 28]) assert(why[k] === 'nessuna prova che sia esistito', `riga ${k} (0.6-r): il verbo riguarda un altro nome o un dato, si cerca la causa (${why[k]})`);
  assert(why[23] === 'storico', `riga 23 (0.6-r): «rimosso il vecchio modulo: \`x\`» (${why[23]})`);
  assert(why[27] === 'storico', `riga 27 (0.6-s): «Superato dall'app» legato al nome della riga (${why[27]})`);
  assert(why[24] === 'storico', `riga 24 (0.6-r): «Rebrand B.0 … da \`x\`», il punto di B.0 non chiude la frase (${why[24]})`);
  assert(why[10] === 'nessuna prova che sia esistito' && causeAsked.length === 11, `tabella normale: si cerca la causa (${JSON.stringify(why)}, ${causeAsked.length})`);
});

test('«superato» nel titolo di sezione (0.6-z5): vale solo come «superato da …», non come «passato»', () => {
  const fakeRepo = { rev: 'HEAD', git: () => { throw new Error('no'); }, grepMatches: () => [], listFiles: () => [], hasDir: () => false, root: '/nonexistent' };
  const rec = (line, section) => ({ doc: 'a.md', line, section, kind: 'identifier', claim: 'nome_x', key: 'nome_x', status: 'not_found' });
  const recs = [rec(1, '## Gate superati'), rec(2, '## Test superato il 12/10'), rec(3, '## Modulo superato dal nuovo flusso'), rec(4, '## Codice rimosso')];
  const out = toSegnalazioni({ repo: 'r', tool: 'mr' }, recs, [], () => fakeRepo, { onlyCaused: true, lineText: () => 'Usa `nome_x`.', rawLine: () => 'Usa `nome_x`.', reposForDoc: () => [] });
  const why = Object.fromEntries(out.appendix.map((a) => [a.line, a.reason]));
  assert(why[1] === 'nessuna prova che sia esistito' && why[2] === 'nessuna prova che sia esistito', `«superati» = passati: si cerca la causa (${JSON.stringify(why)})`);
  assert(/^storico: il titolo della sezione/.test(why[3]) && /^storico: il titolo della sezione/.test(why[4]), `«superato dal …» e «rimosso» restano storici (${JSON.stringify(why)})`);
});

test('parseIndice: attivi, archivio dalla riga **Archivio:** e dal gruppo', () => {
  const w = parseIndice(readFileSync(indice, 'utf-8'));
  const st = Object.fromEntries(w.map((x) => [x.slug, x.attivo ? 'attivo' : x.motivo]));
  assert(st.ws === 'attivo' && st.vecchio === 'archivio' && st.crawl === 'gruppo archivio', JSON.stringify(st));
});

test('workspaceRepos: i repo dentro la cartella', () => {
  const r = workspaceRepos(ws).map((x) => x.root.split('/').pop()).sort();
  assert(r.join(',') === 'app,backend', r.join(','));
});

let out;
test('giro: esclusioni, fonti = tutti i repo, solo affermazioni con prova, appendice, storici fuori', () => {
  const r = run('--indice', indice);
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  out = r.stdout;
  assert(/Esclusi:.*`vecchio` \(archivio\).*`crawl` \(gruppo archivio\)/.test(out) && !out.includes('app-web'), out.split('\n').slice(0, 8).join('\n'));
  assert(out.includes('## Versioni lette') && /\| ws \| app \| HEAD \(senza remote\) \|/.test(out), 'tabella delle versioni lette');
  assert(out.includes('`nogit`: nessun repo git, saltato'), 'workspace senza git non dichiarato');
  assert(out.includes('| ws/app/docs/a.md | ws | app | docs/a.md | 2 |'), 'riga attesa per a.md: 2 affermazioni con prova (src/tolto.ts, nome_tolto)');
  const seg = out.slice(out.indexOf('## Segnalazioni'), out.indexOf('## Appendice'));
  assert(/`src\/tolto.ts` non trovato.*causato da [0-9a-f]{7}/.test(seg) && /`nome_tolto` non trovato.*causato da/.test(seg), seg);
  assert(!seg.includes('check_answer') && !seg.includes('1.sql'), 'nomi del repo fratello: trovati, non segnalati');
  const app = out.slice(out.indexOf('## Appendice'));
  assert(app.includes('`davvero_assente`') && app.includes('`mai_esistito()` (tipo)'), app);
  assert(!out.includes('piano-vecchio') && !out.includes('2026-09-10/x.md'), 'doc storici (piano, cartella datata) non devono comparire');
  assert(!seg.includes('docs/b.md') && app.includes('ws/app/docs/b.md'), 'riga che dice già «rimosso»: appendice, non segnalazione');
  assert(!seg.includes('docs/c.md') && app.includes('ws/app/docs/c.md'), 'passato («fino al … era»), esempio e convenzioni di nomi: appendice');
  assert(!seg.includes('docs/g.md') && app.includes('ws/app/docs/g.md'), '«sono stati tolti» nella riga dopo, stesso paragrafo (0.6-q): appendice');
  assert(!out.includes('rework-0.7.0') && !out.includes('audit-api'), 'release con versione nel nome e audit: storici, fuori dal giro');
  for (const d of ['136_griglia', 'runbook_apply_x', 'schema_delta_a', '24-07-pm', 'design/refactor', 'recon-backend-1']) assert(!out.includes(d), `${d}: doc storico (0.6-j), non deve comparire`);
  const dSeg = seg.slice(seg.indexOf('ws/app/docs/d.md'));
  assert(seg.includes('ws/app/docs/d.md') && /riga 16 .*`src\/tolto.ts`/.test(dSeg) && !/riga (3|5|7|9|11) /.test(dSeg.split('### ')[0]), `d.md: solo la riga di tabella 16 resta (legacy in un'altra riga della tabella non conta)\n${dSeg.slice(0, 900)}`);
  assert(out.includes('**Workspace:** ws'), 'slug del workspace nella segnalazione');
});

test('senza --write non scrive nulla; con --write solo nella cartella del giro', () => {
  assert(!existsSync(join(base, 'giro')), 'cartella creata senza --write');
  const dir = join(base, 'giro');
  const r = run('--indice', indice, '--write', '--giro-dir', dir);
  assert(r.status === 0, r.stderr);
  const files = readdirSync(dir);
  assert(files.length === 1 && /^\d{4}-\d{2}-\d{2}\.md$/.test(files[0]), files.join(','));
  // secondo giro nello stesso giorno: file nuovo, il primo resta
  run('--indice', indice, '--write', '--giro-dir', dir);
  const two = readdirSync(dir).sort();
  assert(two.length === 2 && two.some((f) => /-2\.md$/.test(f)), two.join(","));
});

test('--ignore-dir (0.6-k): allow-list centrale <dir>/<workspace>.ignore, dichiarata nel report', () => {
  const dir = join(base, 'mr-ignore');
  write(dir, 'ws.ignore', '# allow-list centrale di prova\nesterno:nome_tolto   # property esterna\n');
  const r = run('--indice', indice, '--ignore-dir', dir);
  assert(r.status === 0, r.stderr);
  const seg = r.stdout.slice(r.stdout.indexOf('## Segnalazioni'), r.stdout.indexOf('## Appendice'));
  assert(!seg.includes('`nome_tolto`') && /`src\/tolto.ts` non trovato/.test(seg), 'nome_tolto dichiarato esterno: non deve essere segnalato; src/tolto.ts sì');
  assert(r.stdout.includes(`${dir}/<workspace>.ignore`) && r.stdout.includes(join(dir, 'ws.ignore')), 'il report dice quale file d\'eccezione ha letto');
  const senza = run('--indice', indice);
  assert(/`nome_tolto` non trovato/.test(senza.stdout) && senza.stdout.includes('--ignore-dir non dato'), 'senza --ignore-dir il nome resta segnalato');
});

test('--ignore-dir con codice:<glob> (0.6-m): la copia di riferimento non conta come codice', () => {
  const dir = join(base, 'mr-ignore-codice');
  write(dir, 'ws.ignore', 'codice:ref/*   # copia di riferimento del progetto d\'origine\n');
  const senza = run('--indice', indice);
  const segSenza = senza.stdout.slice(senza.stdout.indexOf('## Segnalazioni'), senza.stdout.indexOf('## Appendice'));
  assert(!segSenza.includes('`nome_ref`'), 'senza la regola nome_ref è trovato nella copia: niente segnalazione');
  const con = run('--indice', indice, '--ignore-dir', dir);
  const segCon = con.stdout.slice(con.stdout.indexOf('## Segnalazioni'), con.stdout.indexOf('## Appendice'));
  assert(/`nome_ref` non trovato.*causato da [0-9a-f]{7}/.test(segCon), `con codice:ref/* nome_ref è sparito dal codice vero:\n${segCon.slice(0, 1200)}`);
});

test('PR aperte (0.6-q): una segnalazione su un doc toccato da una PR aperta va in «Già in correzione» e non conta', () => {
  const b4 = realpathSync(mkdtempSync(join(tmpdir(), 'mr-giro-pr-')));
  const repo = join(b4, 'ws', 'svc');
  write(repo, 'src/x.ts', 'export const nome_vecchio = 1;\n');
  gitInit(repo);
  write(repo, 'src/x.ts', 'export const altro = 1;\n');
  write(repo, 'docs/in-pr.md', '# A\n\nUsa `nome_vecchio`.\n');
  write(repo, 'docs/fuori.md', '# B\n\nUsa `nome_vecchio`.\n');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'togli']);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://github.com/esempio/svc.git']);
  const gh = join(b4, 'gh-finto');
  writeFileSync(gh, '#!/bin/sh\necho \'[{"number":7,"files":[{"path":"docs/in-pr.md"}]}]\'\n', { mode: 0o755 });
  const ind = join(b4, 'indice.md');
  writeFileSync(ind, `| Slug | Gruppo | Path | Nota |\n|---|---|---|---|\n| \`svc\` | software | \`${join(b4, 'ws')}\` | — |\n`);
  const r = spawnSync(process.execPath, [GIRO, '--indice', ind], { encoding: 'utf-8', cwd: b4, env: { ...process.env, MR_GH_BIN: gh } });
  const senza = spawnSync(process.execPath, [GIRO, '--indice', ind, '--senza-pr'], { encoding: 'utf-8', cwd: b4, env: { ...process.env, MR_GH_BIN: gh } });
  const nogh = spawnSync(process.execPath, [GIRO, '--indice', ind], { encoding: 'utf-8', cwd: b4, env: { ...process.env, MR_GH_BIN: join(b4, 'non-esiste') } });
  rmSync(b4, { recursive: true, force: true });
  const riep = (o) => o.slice(o.indexOf('## Riepilogo'), o.indexOf('\n## ', o.indexOf('## Riepilogo') + 1));
  assert(r.status === 0 && r.stdout.includes('## Già in correzione') && r.stdout.includes('| svc/svc/docs/in-pr.md | 1 | esempio/svc#7 |'), r.stdout.slice(0, 1500));
  assert(!riep(r.stdout).includes('in-pr.md') && riep(r.stdout).includes('docs/fuori.md'), 'il doc in PR non deve stare nel riepilogo (non contato)');
  assert(precisione([r.stdout]).prodotte === 1, `prodotte attese 1, ${precisione([r.stdout]).prodotte}`);
  assert(riep(senza.stdout).includes('in-pr.md') && senza.stdout.includes('--senza-pr'), 'con --senza-pr tutto come prima');
  assert(riep(nogh.stdout).includes('in-pr.md') && /PR non lette per 1 repo .*gh non disponibile/.test(nogh.stdout), 'senza gh: come prima, e il report lo dice');
});

test('--out: scrive nel file indicato, mai sopra un file esistente', () => {
  const f = join(base, 'fuori', 'giro.md');
  const a = run('--indice', indice, '--out', f);
  assert(a.status === 0 && existsSync(f), a.stderr);
  const b = run('--indice', indice, '--out', f);
  assert(b.status === 2 && b.stderr.includes('non sovrascrive'), `atteso exit 2, ottenuto ${b.status}`);
});

test('report (0.6-z10): riga «MR segnala, non blocca» in testa, colonna peso, «Quando» nelle segnalazioni', () => {
  assert(out.split('\n').slice(0, 4).some((l) => l.includes('MR segnala, non blocca')), 'riga in testa');
  assert(out.includes('| affermazioni | peso | esito |') && out.includes('**Quando:** dopo la task in corso'), 'peso o quando');
});

test('precisione: confermate / prodotte, colonna esito', () => {
  const t = out.replace('| ws/app/docs/a.md | ws | app | docs/a.md | 2 | medio |  |', '| ws/app/docs/a.md | ws | app | docs/a.md | 2 | medio | confermata |')
    + '\n';
  const extra = '## Riepilogo\n\n| id | workspace | repo | doc | affermazioni | severità | esito |\n|---|---|---|---|---|---|---|\n| x/y/b.md | x | y | b.md | 1 | bassa | scartata |\n| x/y/c.md | x | y | c.md | 1 | bassa |  |\n';
  const p = precisione([t, extra]);
  assert(p.prodotte === 4 && p.confermata === 1 && p.scartata === 1 && p.valutate === 2, JSON.stringify(p));
  const dir = join(base, 'giro-p');
  write(dir, '2026-10-03.md', t);
  write(dir, '2026-10-10.md', extra);
  const r = run('--precisione', '--giro-dir', dir);
  assert(r.status === 0 && r.stdout.includes('= 1/4 (25%)'), r.stdout);
  const r2 = run('--precisione', '--file', join(dir, '2026-10-03.md'));
  assert(r2.status === 0 && r2.stdout.includes('= 1/2 (50%)'), r2.stdout);
});

test('precisione (0.6-w): le «già in correzione» contano come confermate, in una riga separata', () => {
  const rep = (titolo) => ['# Giro', '', '## Riepilogo', '', '| id | workspace | repo | doc | affermazioni | severità | esito |', '|---|---|---|---|---|---|---|',
    '| a/b/x.md | a | b | x.md | 1 | bassa | confermata |', '| a/b/y.md | a | b | y.md | 1 | bassa | scartata |', '',
    `## Già in correzione ${titolo}`, '', '| id | affermazioni | PR aperte |', '|---|---|---|',
    '| a/b/z.md | 3 | org/b#5 |', '| a/b/w.md | 1 | org/b#5 |', '', '## Segnalazioni', '', '| non | è | una | tabella | del | riepilogo | confermata |', ''].join('\n');
  for (const titolo of ['(non contate)', '(contate come confermate)']) {
    const p = precisione([rep(titolo)]);
    assert(p.prodotte === 2 && p.confermata === 1 && p.inCorrezione === 2, `${titolo}: ${JSON.stringify(p)}`);
  }
  const dir = join(base, 'giro-c');
  write(dir, '2026-10-13.md', rep('(contate come confermate)'));
  const r = run('--precisione', '--giro-dir', dir);
  assert(r.status === 0 && r.stdout.includes('(prodotte + già in correzione) = 3/4 (75%)') && r.stdout.includes('di cui già in correzione: 2') && r.stdout.includes('confermate / prodotte = 1/2 (50%)'), r.stdout);
  const out = run('--indice', indice).stdout;
  assert(/Segnalazioni prodotte: \d+ · già in correzione: \d+ \(contate come confermate\)\./.test(out), 'il report del giro dice entrambi i numeri');
});

test('origin/<default> (0.6-i): senza --fetch il ref remoto noto, con --fetch quello nuovo; working tree intatto', () => {
  const b2 = realpathSync(mkdtempSync(join(tmpdir(), 'mr-giro-origin-')));
  const g = (dir, ...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf-8' });
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', join(b2, 'remote.git')]);
  const seed = join(b2, 'seed');
  write(seed, 'src/x.ts', 'export const a = 1;\n');
  write(seed, 'docs/a.md', '# A\n\nIl modulo sta in `src/x.ts`.\n');
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'primo'); g(seed, 'remote', 'add', 'origin', join(b2, 'remote.git')); g(seed, 'push', '-q', 'origin', 'main');
  const wsO = join(b2, 'ws');
  mkdirSync(wsO);
  execFileSync('git', ['clone', '-q', join(b2, 'remote.git'), join(wsO, 'svc')]);
  // un altro collega toglie src/x.ts e spinge: la copia del workspace resta indietro
  rmSync(join(seed, 'src/x.ts')); write(seed, 'src/y.ts', 'export const b = 1;\n');
  g(seed, 'add', '-A'); g(seed, 'commit', '-q', '-m', 'togli x'); g(seed, 'push', '-q', 'origin', 'main');
  const ind = join(b2, 'indice.md');
  writeFileSync(ind, `| Slug | Gruppo | Path | Nota |\n|---|---|---|---|\n| \`svc\` | software | \`${wsO}\` | — |\n`);
  const svc = join(wsO, 'svc');
  const headBefore = g(svc, 'rev-parse', 'HEAD').trim();
  const a = run('--indice', ind);
  assert(a.status === 0 && a.stdout.includes('segnalazioni: 0') && a.stdout.includes('| svc | svc | origin/main |'), a.stdout.slice(0, 900));
  const b = run('--indice', ind, '--fetch');
  assert(b.status === 0 && b.stdout.includes('segnalazioni: 1') && /`src\/x.ts` non trovato.*causato da/.test(b.stdout), b.stdout.slice(0, 1500));
  assert(/\| svc \| svc \| origin\/main \| [0-9a-f]+ \| 1 \|/.test(b.stdout), 'copia locale indietro di 1');
  assert(g(svc, 'rev-parse', 'HEAD').trim() === headBefore && g(svc, 'status', '--porcelain') === '' && existsSync(join(svc, 'src/x.ts')), 'working tree o HEAD toccati');
  rmSync(b2, { recursive: true, force: true });
});

test('doc del contenitore che descrive un sotto-repo (0.6-i): si cerca nel sotto-repo, non nel repo del doc', () => {
  const b3 = realpathSync(mkdtempSync(join(tmpdir(), 'mr-giro-outer-')));
  const outer = join(b3, 'GL');
  // il contenitore ha ancora RESET_X in un suo file: cercando lì sembrerebbe tutto a posto
  write(outer, 'altro/config.ts', 'export const RESET_X = 1;\n');
  write(outer, 'ws2/go_live.md', '# Go live\n\nImpostare `RESET_X` sul server.\n');
  write(outer, '.gitignore', 'ws2/inner/\n');
  gitInit(outer);
  const innerRepo = join(outer, 'ws2/inner');
  write(innerRepo, 'src/env.ts', 'const v = process.env.RESET_X;\n');
  gitInit(innerRepo);
  write(innerRepo, 'src/env.ts', 'const v = 1;\n');
  execFileSync('git', ['-C', innerRepo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-am', 'togli RESET_X']);
  const ind = join(b3, 'indice.md');
  writeFileSync(ind, `| Slug | Gruppo | Path | Nota |\n|---|---|---|---|\n| \`ws2\` | software | \`${join(outer, 'ws2')}\` | — |\n`);
  const r = run('--indice', ind);
  assert(r.status === 0 && /`RESET_X` non trovato.*causato da/.test(r.stdout) && r.stdout.includes('ws2/GL/ws2/go_live.md'), r.stdout.slice(0, 1500));
  rmSync(b3, { recursive: true, force: true });
});

rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
