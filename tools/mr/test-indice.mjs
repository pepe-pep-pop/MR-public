#!/usr/bin/env node
/**
 * test-indice.mjs — `mr indice` e `mr trova` (MR 0.6-z17): indice dei doc dei workspace attivi e
 * ricerca per parole. Controlla: colonne, vivi e storici, esclusioni (segreti, cartelle con dati
 * personali e regole personali:, regole doc: e codice:, fixture, workspace in archivio, CSV), prima
 * riga con dati personali scartata, caratteri di controllo tolti, nessuna scrittura senza --write,
 * permessi del file, ordine dei risultati, filtri, --json, indice mancante, giro completo e parziale.
 *
 * Invocazione: node tools/mr/test-indice.mjs   (exit 0 = tutti pass)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, statSync, realpathSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conta, misura, esitoTrova, invocazioni, gruppo, settimana } from './uso.mjs';
import { defaultIndice, INDICE_GL } from './lib/indice.mjs';
import { parole as pp, titoloERiassunto, datiSensibili, trova, fromTsv, toTsv, cartellaPersonale } from './lib/indicedoc.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR = join(here, 'mr.mjs');
const GIRO = join(here, 'giro.mjs');
function write(root, rel, content) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content, 'utf-8');
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

console.log('\ntest-indice.mjs\n');
const base = realpathSync(mkdtempSync(join(tmpdir(), 'mr-indice-test-')));
const dirIndice = join(base, 'indice-doc');
const env = { ...process.env, MR_INDICE_DIR: dirIndice };
const run = (cmd, ...a) => { const r = spawnSync(process.execPath, [cmd, ...a], { cwd: base, encoding: 'utf-8', env }); return { code: r.status, out: r.stdout || '', err: r.stderr || '' }; };

const FM = (id, title, extra = '') => `---\nmr_version: '0.6'\nid: ${id}\ntitle: "${title}"\ntype: runbook\nowner: app\nstatus: active\ncreated: '2026-01-01'\nlast_updated: '2026-10-01'\n${extra}---\n\n# ${title}\n\n`;
const app = join(base, 'ws', 'app');
write(app, 'docs/deploy.md', `${FM('app/deploy', 'Deploy sul VPS')}Come si pubblica l'app sul VPS, passo per passo.\n`);
write(app, 'docs/vecchio.md', `${FM('app/vecchio', 'Deploy vecchio', '').replace('status: active', 'status: superseded')}Il deploy di prima, sul VPS dismesso.\n`);
write(app, 'docs/hof-app-2.md', '# Handoff deploy VPS\n\nStato del deploy al 10/10.\n');
write(app, 'docs/contatti.md', `# Referenti\n\nScrivere a mario.rossi@example.com per il deploy.\n`);
write(app, 'docs/escape.md', '# Titolo \x1b[31mrosso\x1b[0m\n\nRiga\tcon tab e \x07 campanello.\n');
write(app, 'docs/procedura.md', '# Procedura interna\n\nIntroduzione generica.\n\n## Scadenze\n\nIl dato resta verificabile fino al giorno dopo, scrive Mario Rossi.\nLa property codice_speciale_xyz va letta qui.\n');
write(app, 'candidati/nota.md', '# Nota\n\nverificabile fino al venerdì\n');
write(app, 'docs/SEGRETI.txt', 'non è un doc\n');
write(app, 'candidati/elenco.md', '# Elenco candidati deploy\n');
write(app, 'riservato/note.md', '# Note riservate deploy\n');
write(app, 'docs/altro-repo.md', '# Descrive un altro repo, deploy\n');
write(app, 'vendor-copia/x.md', '# Copia di un altro progetto, deploy\n');
write(app, 'test-files/rotto.md', '# Fixture deploy\n');
write(app, 'docs/lead.csv', 'nome,email\n');
write(app, 'mr.claims.ignore', 'doc:docs/altro-repo.md\ncodice:vendor-copia/*\npersonali:riservato/*\n');
const ops = join(base, 'ws', 'ops');
write(ops, 'README.md', `${FM('ops/readme', 'Ops').replace('owner: app', 'owner: ops').replace('type: runbook', 'type: guide')}Monitor e deploy delle macchine.\n`);
const arch = join(base, 'ws', 'archiviato');
write(arch, 'README.md', '# Archiviato deploy\n');
for (const r of [app, ops, arch]) {
  execFileSync('git', ['init', '-q', r]);
  execFileSync('git', ['-C', r, 'add', '-A']);
  execFileSync('git', ['-C', r, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'doc']);
}
const indiceWs = join(base, 'segnalazioni', 'indice.md');
write(base, 'segnalazioni/indice.md', [
  '| slug | gruppo | path | note |', '|---|---|---|---|',
  `| \`app\` | software | \`${app}\` | — |`,
  `| \`ops\` | software | \`${ops}\` | — |`,
  `| \`archiviato\` | archivio | \`${arch}\` | — |`, '',
].join('\n'));
const fileTsv = join(dirIndice, 'INDICE_DOC.tsv');

test('senza --write: anteprima con i conteggi, nessun file scritto', () => {
  const r = run(MR, 'indice', '--indice', indiceWs);
  assert(r.code === 0, `exit ${r.code}: ${r.err}`);
  assert(/# Indice dei doc — 7 doc in 2 workspace/.test(r.out), r.out);
  assert(/Anteprima: nulla è stato scritto/.test(r.out), 'anteprima');
  assert(!existsSync(dirIndice), 'cartella creata senza --write');
});

let voci;
test('--write: TSV con le colonne, permessi solo dell\'utente', () => {
  const r = run(MR, 'indice', '--indice', indiceWs, '--write');
  assert(r.code === 0, `exit ${r.code}: ${r.err}`);
  assert(existsSync(fileTsv), 'file non scritto');
  assert((statSync(fileTsv).mode & 0o077) === 0, `permessi ${(statSync(fileTsv).mode & 0o777).toString(8)}`);
  const t = readFileSync(fileTsv, 'utf-8');
  assert(t.split('\n')[0] === 'id\ttitolo\ttype\towner\tstatus\tlast_updated\tpercorso\triassunto\tstato\tworkspace\trepo', t.split('\n')[0]);
  voci = fromTsv(t);
  assert(voci.length === 7, `voci: ${voci.length}`);
  assert(voci.every((v) => Object.keys(v).length === 11), 'colonne');
});

const by = (suffix) => voci.find((v) => v.percorso.endsWith(suffix));
test('vivi e storici: status di fine vita e hof sono storici, gli altri vivi', () => {
  assert(by('docs/deploy.md').stato === 'vivo', 'deploy');
  assert(by('docs/vecchio.md').stato === 'storico', 'superseded');
  assert(by('docs/hof-app-2.md').stato === 'storico', 'hof');
  assert(by('ops/README.md').stato === 'vivo', 'ops');
  const d = by('docs/deploy.md');
  assert(d.id === 'app/deploy' && d.titolo === 'Deploy sul VPS' && d.type === 'runbook' && d.owner === 'app' && d.last_updated === '2026-10-01', JSON.stringify(d));
  assert(d.riassunto === 'Come si pubblica l\'app sul VPS, passo per passo.', d.riassunto);
  assert(d.percorso === join(app, 'docs/deploy.md') && d.workspace === 'app' && d.repo === 'app', d.percorso);
});

test('fuori: segreti, cartelle con dati personali e personali:, doc:, codice:, fixture, archivio, CSV', () => {
  const t = readFileSync(fileTsv, 'utf-8');
  for (const x of ['SEGRETI', 'candidati/', 'riservato/', 'altro-repo', 'vendor-copia', 'test-files', 'archiviato', 'lead.csv']) assert(!t.includes(x), `presente: ${x}`);
});

test('prima riga con un\'email: riassunto vuoto; caratteri di controllo tolti', () => {
  assert(by('docs/contatti.md').riassunto === '', by('docs/contatti.md').riassunto);
  const t = readFileSync(fileTsv, 'utf-8');
  assert(!t.includes('example.com'), 'email nell\'indice');
  // eslint-disable-next-line no-control-regex
  assert(!/[\x00-\x08\x0b-\x1f\x7f]/.test(t.replace(/\t/g, '').replace(/\n/g, '')), 'caratteri di controllo nel TSV');
  const e = by('docs/escape.md');
  assert(e.titolo === 'Titolo rosso' && e.riassunto === 'Riga con tab e campanello.', `${e.titolo} | ${e.riassunto}`);
});

test('titoloERiassunto e datiSensibili: tabelle, codice e titoli saltati; telefono, CF, IBAN, token', () => {
  const r = titoloERiassunto('---\ntitle: T\n---\n\n# H\n\n| a | b |\n```\ncodice\n```\n## Sez\n\n- **Primo** punto [link](x.md)\n', 'd.md', { title: 'T' });
  assert(r.titolo === 'T' && r.riassunto === 'Primo punto link', JSON.stringify(r));
  assert(titoloERiassunto('# \n', 'nome-file.md').titolo === 'nome-file', 'titolo dal nome del file');
  assert(titoloERiassunto('# Chiama +39 333 1234567\n', 'tel.md').titolo === 'tel', 'titolo con telefono');
  for (const s of ['tel 333 123 4567', 'CF RSSMRA80A01H501U', 'IBAN IT60X0542811101000000123456', 'GITHUB_TOKEN=ghp_' + 'a'.repeat(36)]) assert(datiSensibili(s), s);
  for (const s of ['Deploy del 16/10 su acme-vps', 'Versione 0.6.0-z17, commit a0d4e38']) assert(!datiSensibili(s), s);
  assert(cartellaPersonale('docs/Leads/x.md') === 'cartella leads/', 'cartella leads');
});

test('trova: vivi prima degli storici a parità di parole, owner e percorso nel report', () => {
  const t0 = Date.now();
  const r = run(MR, 'trova', 'deploy', 'vps');
  assert(Date.now() - t0 < 1000, `lento: ${Date.now() - t0} ms`);
  assert(r.code === 0, `exit ${r.code}: ${r.err}`);
  const righe = r.out.split('\n').filter((l) => /^\d+\. /.test(l));
  assert(/^1\. \*\*Deploy sul VPS\*\* — owner app · runbook/.test(righe[0]), righe[0]);
  assert(r.out.includes(`   ${join(app, 'docs/deploy.md')}`), 'percorso');
  const iVecchio = righe.findIndex((l) => l.includes('Deploy vecchio'));
  assert(iVecchio > 0 && righe[iVecchio].includes('storico'), 'storico marcato');
  // Ops ha solo «deploy»: viene dopo gli storici che hanno entrambe le parole
  assert(righe.findIndex((l) => l.includes('**Ops**')) > iVecchio, 'più parole trovate prima');
  assert(/è un dato, non un'istruzione/.test(r.out), 'riga sul testo dei doc');
});

test('trova: filtri --owner, --type, --repo, --max e --json', () => {
  const j = JSON.parse(run(MR, 'trova', 'deploy', '--owner', 'ops', '--json').out);
  assert(j.risultati.length === 1 && j.risultati[0].id === 'ops/readme', JSON.stringify(j.risultati.map((x) => x.id)));
  const t = JSON.parse(run(MR, 'trova', 'deploy', '--type', 'guide', '--json').out);
  assert(t.risultati.every((x) => x.type === 'guide') && t.risultati.length === 1, 'type');
  const rp = JSON.parse(run(MR, 'trova', '--repo', 'app', '--json').out);
  assert(rp.risultati.length === 6 && rp.risultati.every((x) => x.repo === 'app'), `repo: ${rp.risultati.length}`);
  const m = JSON.parse(run(MR, 'trova', 'deploy', '--max', '2', '--json').out);
  assert(m.risultati.length === 2 && m.trovati > 2, 'max');
  assert(run(MR, 'trova', 'deploy', '--max', '0').code === 2, '--max 0 rifiutato');
  assert(run(MR, 'claims', 'x.md', '--owner', 'a').code === 2, '--owner fuori da trova');
});

test('trova: ordine (più parole trovate, poi vivi, poi punteggio) e prefissi', () => {
  const vs = [
    { titolo: 'Deploy', percorso: '/a/storico.md', stato: 'storico', riassunto: 'vps' },
    { titolo: 'Deploy', percorso: '/a/vivo.md', stato: 'vivo', riassunto: 'altro' },
    { titolo: 'Altro', percorso: '/a/vivo2.md', stato: 'vivo', riassunto: 'deploy su vps' },
    { titolo: 'Tokens GitHub', percorso: '/a/tok.md', stato: 'vivo', riassunto: '' },
  ];
  const r = trova(vs, 'deploy vps');
  assert(r.risultati.map((x) => x.percorso).join() === '/a/vivo2.md,/a/storico.md,/a/vivo.md', r.risultati.map((x) => x.percorso).join());
  assert(trova(vs, 'token').risultati[0].percorso === '/a/tok.md', 'prefisso token → tokens');
  assert(fromTsv(toTsv(vs.map((v) => ({ ...v, titolo: 'a\tb\nc' }))))[0].titolo === 'a b c', 'tab e a capo tolti');
});

test('trova (0.6-z21): più parole senza un doc che le contenga tutte → avviso di risultati parziali', () => {
  const r = run(MR, 'trova', 'deploy', 'inesistentissimo');
  assert(r.code === 0 && /Nessun doc contiene tutte le 2 parole/.test(r.out), r.out);
  assert(!/Nessun doc contiene tutte/.test(run(MR, 'trova', 'deploy', 'vps').out), 'avviso con risultati completi');
  assert(JSON.parse(run(MR, 'trova', 'deploy', 'inesistentissimo', '--json').out).completi === 0, 'completi');
});

test('parole (0.6-z22): underscore intero, preposizioni ignorate, sigle di 2 lettere tenute', () => {
  assert(JSON.stringify(pp('pagamento_con_garanzia')) === '["pagamento_con_garanzia"]', JSON.stringify(pp('pagamento_con_garanzia')));
  assert(JSON.stringify(pp('verificabile fino al')) === '["verificabile"]', JSON.stringify(pp('verificabile fino al')));
  assert(JSON.stringify(pp('token LW')) === '["token","lw"]' && JSON.stringify(pp('DB di MR, la KB')) === '["db","mr","kb"]', JSON.stringify(pp('DB di MR, la KB')));
  const vs = [{ titolo: 'Property pagamento_con_garanzia', percorso: '/a/p.md', stato: 'vivo' }, { titolo: 'Pagamenti', percorso: '/a/q.md', stato: 'vivo' }];
  const r = trova(vs, 'pagamento_con_garanzia');
  assert(r.risultati.length === 1 && r.risultati[0].percorso === '/a/p.md', JSON.stringify(r.risultati));
});

test('trova nel testo (0.6-z23): frase esatta, nome con underscore, --testo; riga e sezione, mai il testo della riga', () => {
  const f = run(MR, 'trova', 'verificabile fino al');
  assert(f.code === 0 && /## Nel testo dei doc — 1 di 1 \(frase esatta: «verificabile fino al»\)/.test(f.out), f.out);
  assert(f.out.includes(`${join(app, 'docs/procedura.md')}:7`) && /riga 7, sezione «Scadenze», 1 volta/.test(f.out), f.out);
  assert(!f.out.includes('Mario') && !f.out.includes('candidati'), 'testo della riga o cartella esclusa nell\'output');
  assert(f.out.indexOf('## Nel testo dei doc') < f.out.indexOf('## Per titolo'), 'con una frase il testo viene prima');
  const u = JSON.parse(run(MR, 'trova', 'codice_speciale_xyz', '--json').out);
  assert(u.completi === 0 && u.testo && u.testo.motivo.startsWith('nessun doc') && u.testo.risultati[0].riga === 8, JSON.stringify(u.testo));
  const t = JSON.parse(run(MR, 'trova', 'deploy', '--testo', '--json').out);
  assert(t.testo && t.testo.motivo === '--testo' && t.testo.totale >= 1, JSON.stringify(t.testo));
  const n = JSON.parse(run(MR, 'trova', 'deploy', 'vps', '--json').out);
  assert(n.testo === null, 'testo cercato anche con risultati completi');
  assert(/né nel titolo né nel testo/.test(run(MR, 'trova', 'parolachenonesiste').out), 'nessun risultato');
  assert(run(MR, 'claims', 'x.md', '--testo').code === 2, '--testo fuori da trova');
});

test('trova: indice mancante → errore chiaro, exit 2', () => {
  const r = spawnSync(process.execPath, [MR, 'trova', 'deploy'], { cwd: base, encoding: 'utf-8', env: { ...process.env, MR_INDICE_DIR: join(base, 'vuota'), MR_INDICE_ARCH: join(base, 'nessuno.md') } });
  assert(r.status === 2 && /mr indice --write/.test(r.stderr), `${r.status} ${r.stderr}`);
  assert(!existsSync(join(base, 'vuota', 'INDICE_DOC.tsv')), 'scritto senza indice di arch');
});

test('trova (0.6-z24): indice assente o di più di un giorno → rigenerato; fresco o --senza-rinnovo → no', () => {
  const d = join(base, 'indice-rinnovo');
  const tsv = join(d, 'INDICE_DOC.tsv');
  const t = (...a) => spawnSync(process.execPath, [MR, 'trova', 'deploy', ...a], { cwd: base, encoding: 'utf-8', env: { ...process.env, MR_INDICE_DIR: d, MR_INDICE_ARCH: indiceWs } });
  const r1 = t();
  assert(r1.status === 0 && /Indice rigenerato/.test(r1.stdout) && existsSync(tsv), `${r1.status} ${r1.stdout} ${r1.stderr}`);
  assert(!/Indice rigenerato/.test(t().stdout), 'rigenerato anche se fresco');
  const ieri = new Date(Date.now() - 2 * 86400000);
  utimesSync(tsv, ieri, ieri);
  assert(!/Indice rigenerato/.test(t('--senza-rinnovo').stdout) && statSync(tsv).mtime.getTime() < Date.now() - 86400000, '--senza-rinnovo');
  const j = JSON.parse(t('--json').stdout);
  assert(j.rinnovo && j.rinnovo.doc > 0 && statSync(tsv).mtime.getTime() > Date.now() - 60000, JSON.stringify(j.rinnovo));
  assert(run(MR, 'claims', 'x.md', '--senza-rinnovo').code === 2, '--senza-rinnovo fuori da trova');
});

test('giro: completo con --write riscrive l\'indice; parziale (--only) no', () => {
  const d1 = join(base, 'indice-giro');
  const g = (...a) => spawnSync(process.execPath, [GIRO, '--indice', indiceWs, '--senza-pr', '--locale', ...a], { cwd: base, encoding: 'utf-8', env: { ...process.env, MR_INDICE_DIR: d1 } });
  g('--only', 'app', '--write', '--giro-dir', join(base, 'giro1'));
  assert(!existsSync(join(d1, 'INDICE_DOC.tsv')), 'scritto da un giro parziale');
  const r = g('--write', '--giro-dir', join(base, 'giro2'));
  assert(r.status === 0, `exit ${r.status}: ${r.stderr}`);
  assert(existsSync(join(d1, 'INDICE_DOC.tsv')) && /indice dei doc: .*\(7 doc/.test(r.stdout), r.stdout);
  g('--write', '--giro-dir', join(base, 'giro3'), '--senza-indice');
});

test('uso.mjs: invocazioni per settimana e gruppo, chiamate ripetute contate una volta, solo conteggi', () => {
  const c = invocazioni('cd x && node ~/.mr/rilascio/tools/mr/mr.mjs impact a.ts; mr trova token github && node tools/mr-validate/mr-validate.mjs --profile light . && node tools/mr/giro.mjs');
  assert(c.impact === 1 && c.trova === 1 && c.validate === 1 && c.giro === 1 && c.altri_mr === 0, JSON.stringify(c));
  assert(invocazioni('echo trova; grep impact x; node altro/giro.mjs').impact === 0 && invocazioni('node altro/giro.mjs').giro === 0, 'falsi positivi');
  assert(gruppo('-Users-x-Documents-GL--code--soft-MR') === 'mr' && gruppo('-Users-x-Documents-GL--code--arch') === 'arch' && gruppo('-Users-x-Documents-GL--code--soft-app-web') === 'altri', 'gruppi');
  assert(settimana(new Date('2026-10-19T12:00:00Z')) === '2026-W43' && settimana(new Date('2026-01-01T12:00:00Z')) === '2026-W01', 'settimana ISO');
  const dir = join(base, 'projects');
  const riga = (id, cmd, ts) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command: cmd } }] } });
  const ts = new Date().toISOString();
  write(dir, '-Users-x-GL--code--soft-app-web/a.jsonl', [riga('t1', 'node mr.mjs impact x.ts', ts), riga('t2', 'node mr.mjs trova deploy', ts), 'non json'].join('\n'));
  write(dir, '-Users-x-GL--code--soft-app-web/b.jsonl', riga('t1', 'node mr.mjs impact x.ts', ts));
  write(dir, '-Users-x-GL--code--arch/c.jsonl', riga('t3', 'node mr.mjs vivi .', ts));
  const r = conta(dir, { settimane: 1 });
  const altri = r.find((x) => x.gruppo === 'altri');
  assert(altri.impact === 1 && altri.trova === 1 && altri.totale === 2, JSON.stringify(r));
  assert(r.find((x) => x.gruppo === 'arch').altri_mr === 1, 'arch');
  const out = spawnSync(process.execPath, [join(here, 'uso.mjs'), '--dir', dir, '--settimane', '1', '--tsv'], { encoding: 'utf-8' }).stdout;
  assert(out.split('\n')[0] === 'settimana\tgruppo\ttrova\timpact\taltri_mr\tvalidate\tgiro\ttotale\tchi_sa_cosa\ttrova_vuote\ttrova_doc_aperto' && !out.includes('x.ts') && !out.includes('deploy'), out);
});

test('defaultIndice (0.6-z18): MR_INDICE_ARCH, poi relativo, poi la posizione abituale in GL', () => {
  assert(defaultIndice(join(base, 'x', 'y'), { MR_INDICE_ARCH: indiceWs }) === indiceWs, 'variabile');
  // una copia di rilascio fuori da GL (come ~/.mr/rilascio): niente _arch relativo
  const fuori = join(base, 'rilascio');
  mkdirSync(fuori, { recursive: true });
  const d = defaultIndice(fuori, {});
  // sul Mac di il maintainer la posizione abituale; in CI non c'è, e resta il percorso relativo
  if (existsSync(INDICE_GL)) assert(d === INDICE_GL, `atteso ${INDICE_GL}, avuto ${d}`);
  else assert(d.endsWith('_arch/segnalazioni/indice.md'), d);
});

test('uso.mjs (0.6-z20): chi-sa-cosa, ricerche vuote, doc aperto dopo; per giorno e progetto', () => {
  const dir = join(base, 'projects-z20');
  const ora = new Date();
  const t = (min) => new Date(ora.getTime() - 120 * 60000 + min * 60000).toISOString();
  const uso = (id, ts, input, name = 'Bash') => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_use', id, name, input }] } });
  const ris = (id, ts, text) => JSON.stringify({ timestamp: ts, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text }] }] } });
  const pieno = '# Trova «deploy» — 2 di 5 (indice del 2026-10-22, 10 doc)\n\n1. **Deploy** — owner app\n   /x/app/docs/deploy.md\n2. **Altro** — owner app\n   /x/app/docs/altro.md';
  write(dir, '-Users-x-Documents-GL--code--soft-app-web/s.jsonl', [
    uso('a1', t(0), { skill: 'chi-sa-cosa' }, 'Skill'),
    uso('a2', t(1), { command: 'node ~/.mr/rilascio/tools/mr/mr.mjs trova deploy' }), ris('a2', t(1), pieno),
    uso('a3', t(5), { file_path: '/x/app/docs/deploy.md' }, 'Read'),
    uso('a4', t(10), { command: 'node mr.mjs trova niente' }), ris('a4', t(10), '# Trova «niente» — 0 di 0 (indice del 2026-10-22, 10 doc)\n\nNessun doc.'),
    uso('a5', t(11), { command: 'node mr.mjs trova tardi' }), ris('a5', t(11), pieno),
    uso('a6', t(80), { file_path: '/x/app/docs/altro.md' }, 'Read'),
  ].join('\n'));
  const m = misura(dir, { settimane: 1 });
  const w = m.settimane.find((x) => x.gruppo === 'altri');
  assert(w.trova === 3 && w.chi_sa_cosa === 1 && w.trova_vuote === 1 && w.trova_doc_aperto === 1, JSON.stringify(w));
  const g = m.giorni.find((x) => x.progetto === 'app-web');
  assert(g && g.trova === 3 && g.trova_doc_aperto === 1, JSON.stringify(m.giorni));
  assert(esitoTrova('# Trova «x» — 0 di 0 (…)\n\nNessun doc.').risultati === 0 && esitoTrova('').risultati === null, 'esitoTrova');
  const out = spawnSync(process.execPath, [join(here, 'uso.mjs'), '--dir', dir, '--settimane', '1', '--dettaglio', '--tsv'], { encoding: 'utf-8' }).stdout;
  assert(out.split('\n')[0] === 'giorno\tprogetto\ttrova\ttrova_vuote\ttrova_doc_aperto\tchi_sa_cosa\timpact\ttotale' && /\tapp-web\t3\t1\t1\t1\t0\t3/.test(out) && !out.includes('deploy'), out);
});

const ok = results.filter(Boolean).length;
console.log(`\nRisultato: ${ok}/${results.length} PASS\n`);
process.exitCode = ok === results.length ? 0 : 1;
