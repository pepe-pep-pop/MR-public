#!/usr/bin/env node
/**
 * test-giro-ancore.mjs — sezione «Ancore in deriva» del giro e --precisione-ancore (MR 0.6-s).
 *
 * Workspace di prova con un repo: un doc con 4 ancore verificate al primo commit, poi un commit
 * che cambia il corpo di una sola funzione. Altri doc: un'ancora a un file che non c'è (missing),
 * una con verified inesistente (unresolvable), una senza verified, una dentro test-files/ (fixture,
 * esclusa). Controlla: una riga per ancora da rileggere e nessun'altra, l'ordine (missing, moved,
 * drift, non risolvibili), il conteggio a parte, --precisione identico, --precisione-ancore.
 *
 * Invocazione: node tools/mr/test-giro-ancore.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { precisione, precisioneAncore, sezioneAncore } from './giro.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GIRO = join(here, 'giro.mjs');

function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
}
const git = (root, ...a) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...a], { encoding: 'utf-8' }).trim();
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

console.log('\ntest-giro-ancore.mjs\n');
// il giro con --write riscrive anche l'indice dei doc (0.6-z17): nei test mai quello vero in ~/.mr/indice
process.env.MR_INDICE_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(), 'mr-indice-'));

const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-giro-ancore-')));
const app = join(base, 'ws', 'app');
const corpo = (v) => [
  'export async function verifica(token: string): Promise<{ email: string }> {',
  '  const dati = leggi(token);',
  `  if (dati.ok === ${v}) throw new Error('no');`,
  '  return { email: dati.email };',
  '}',
  'export function altra() {',
  '  return 1;',
  '}',
  '',
].join('\n');
write(app, 'src/auth.ts', corpo('false'));
write(app, 'deploy/compose.yml', 'services:\n  app: {}\n');
execFileSync('git', ['init', '-q', app]);
git(app, 'add', '-A');
git(app, 'commit', '-q', '-m', 'codice');
const c1 = git(app, 'rev-parse', '--short', 'HEAD');
write(app, 'docs/login.md', [
  '# Login', '', '## Verifica', '',
  `<!-- mr:code path=src/auth.ts symbol=verifica verified=${c1} date=2026-10-01 -->`,
  `<!-- mr:code path=src/auth.ts symbol=altra verified=${c1} date=2026-10-01 -->`,
  'La verifica rifiuta i token non validi.', '',
  '## Deploy', '',
  `<!-- mr:code path=deploy/compose.yml livello=file verified=${c1} date=2026-10-01 -->`,
  'Il servizio parte con il compose.', '',
].join('\n'));
write(app, 'docs/vecchi.md', [
  '# Vecchi', '', '## Mancante', '',
  `<!-- mr:code path=src/sparito.ts livello=file verified=${c1} date=2026-10-01 -->`,
  'Un file che non esiste.', '', '## Commit perso', '',
  '<!-- mr:code path=src/auth.ts symbol=altra verified=deadbee date=2026-10-01 -->',
  'Verificata su un commit che non c\'è.', '', '## Mai verificata', '',
  '<!-- mr:code path=src/auth.ts symbol=altra -->',
  'Nessun verified.', '',
].join('\n'));
// HOF (storico per path, fuori dai claim): la sua ancora si legge; doc superato nel frontmatter: no
write(app, 'docs/hof-app-1.md', `# HOF\n\n## Trappole\n\n<!-- mr:code path=src/auth.ts symbol=altra verified=${c1} date=2026-10-01 -->\nNon toccare altra.\n`);
write(app, 'docs/vecchia-guida.md', `---\nid: app/vecchia-guida\nstatus: superseded\nsuperseded_by: app/login\n---\n\n# Vecchia\n\n<!-- mr:code path=src/auth.ts symbol=verifica verified=${c1} date=2026-10-01 -->\nSuperata.\n`);
// fixture sbagliata apposta (come tools/mr-validate/test-files/ di MR): fuori dal giro
write(app, 'tools/test-files/ko.md', `# Ko\n\n<!-- mr:code path=src/nessuno.ts livello=file verified=${c1} date=2026-10-01 -->\nSbagliata apposta.\n`);
git(app, 'add', '-A');
git(app, 'commit', '-q', '-m', 'doc con ancore');
// il commit che fa derivare solo verifica
write(app, 'src/auth.ts', corpo('undefined'));
git(app, 'commit', '-q', '-am', 'verifica: ok deve essere definito');
const c3 = git(app, 'rev-parse', '--short', 'HEAD');

const indice = join(base, 'indice.md');
writeFileSync(indice, ['# Indice', '', '| Slug | Gruppo | Path | Nota |', '|---|---|---|---|', `| \`ws\` | software | \`${join(base, 'ws')}\` | — |`, ''].join('\n'));
const run = (...a) => spawnSync(process.execPath, [GIRO, ...a], { encoding: 'utf-8', cwd: base });

const r = run('--indice', indice, '--senza-pr');
const out = r.stdout;
const iSez = out.indexOf('## Ancore in deriva');
const sez = out.slice(iSez, out.indexOf('\n## ', iSez + 5));
const righe = sez.split('\n').filter((l) => /^\| ws\//.test(l));

test('il giro gira e la sezione sta dopo le segnalazioni, prima dell\'appendice', () => {
  assert(r.status === 0, r.stderr);
  const iS = out.indexOf('## Segnalazioni');
  const iA = out.indexOf('## Ancore in deriva');
  const iP = out.indexOf('## Appendice');
  assert(iS > 0 && iA > iS && iP > iA, `ordine delle sezioni: ${iS} ${iA} ${iP}`);
});

test('una riga per ancora da rileggere: verifica (drift), sparito (missing), commit perso (unresolvable); niente altra, compose, senza verified, fixture', () => {
  assert(righe.length === 3, `attese 3 righe:\n${righe.join('\n')}`);
  assert(righe.some((l) => l.includes('src/auth.ts#verifica') && l.includes('| drift |') && l.includes(c1) && l.includes(c3)), `verifica in drift, con verified e commit dopo:\n${righe.join('\n')}`);
  assert(!righe.some((l) => l.includes('#altra') && l.includes('docs/login.md')), 'altra non è cambiata');
  assert(!sez.includes('compose.yml') && !sez.includes('nessuno.ts'), 'compose non è cambiato; la fixture di test-files è esclusa');
  assert(!sez.includes('vecchia-guida.md'), 'il doc superato nel frontmatter non conta, anche se la sua ancora è in deriva');
});

test('ordine: missing e moved prima, poi drift, poi non risolvibili', () => {
  const stati = righe.map((l) => l.split('|')[5].trim());
  assert(JSON.stringify(stati) === JSON.stringify(['missing', 'drift', 'unresolvable']), JSON.stringify(stati));
});

test('conteggio a parte: 7 ancore lette (HOF sì, fixture e doc superato no), le segnalazioni non cambiano', () => {
  assert(/Ancore e code_refs letti: 7 in 3 doc \(1 repo\) · ok 3 · senza verified 1 · mancanti 1 · spostate 0 · in deriva 1 · non risolvibili 1\./.test(sez), sez.split('\n').slice(0, 4).join('\n'));
  assert(/segnalazioni: 0 · affermazioni con prova di deriva: 0\./.test(out), 'nessuna segnalazione di claim');
  assert(/Ancore \(conteggio a parte, sezione «Ancore in deriva»\): 7 lette in 3 doc · da rileggere: 3\./.test(out), 'riga di intestazione');
});

test('--precisione resta identico (legge solo il riepilogo); --precisione-ancore legge solo la sezione', () => {
  const valutato = out
    .replace(/(\| ws\/app\/docs\/login\.md \| 5 \|.*\| drift \|.*\|) {2}\|/, '$1 doc da correggere |')
    .replace(/(\| ws\/app\/docs\/vecchi\.md \| 5 \|.*\| missing \|.*\|) {2}\|/, '$1 doc ancora vero |');
  const p = precisione([valutato]);
  assert(p.prodotte === 0 && p.valutate === 0, `precisione delle segnalazioni toccata dalle ancore: ${JSON.stringify(p)}`);
  const a = precisioneAncore([valutato]);
  assert(a.righe === 3 && a['doc da correggere'] === 1 && a['doc ancora vero'] === 1 && a.valutate === 2, JSON.stringify(a));
  const dir = join(base, 'giro-a');
  write(dir, '2026-10-12.md', valutato);
  const cli = run('--precisione-ancore', '--giro-dir', dir);
  assert(cli.status === 0 && cli.stdout.includes('= 1/2 (50%)'), cli.stdout);
  const cli2 = run('--precisione', '--giro-dir', dir);
  assert(cli2.status === 0 && cli2.stdout.includes('= 0/0'), cli2.stdout);
});

test('ancore su un doc toccato da una PR aperta: fuori dalla tabella, elencate sotto con la PR', () => {
  const a = { id: 'ws/app/docs/x.md', doc: 'docs/x.md', line: 7, section: '## S', path: 'src/a.ts', symbol: 'f', status: 'drift', verified: 'abc1234', commits: [{ hash: 'def5678', date: '2026-10-10' }] };
  const L = sezioneAncore([], [{ ...a, prs: [4], slug: 'org/app' }], { lette: 1, ok: 0, senzaVerified: 0, docs: new Set(['x']), repos: new Set(['r']) }).join('\n');
  assert(L.includes('nessuna ancora da rileggere') && /- ws\/app\/docs\/x\.md:7 `src\/a\.ts#f` drift — org\/app#4/.test(L), L);
  assert(precisioneAncore([L]).righe === 0, 'le ancore in PR non contano');
});

rmSync(base, { recursive: true, force: true });
const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === results.length ? 0 : 1;
