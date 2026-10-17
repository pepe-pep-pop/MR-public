#!/usr/bin/env node
/**
 * test-validate.mjs — test di mr-validate (MR v0.5.1)
 *
 * Lancia il validatore come processo e controlla exit code e messaggi.
 * Fixture:
 *   ../test-files/          errori voluti (ref rotta, superseded senza superseded_by, id duplicato)
 *   test-files/light-ok/    doc validi nel profilo light
 *   test-files/light-ko/    violazioni del profilo light
 *
 * Invocazione: node test-validate.mjs   (exit 0 = tutti pass)
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const VALIDATOR = join(here, 'mr-validate.mjs');

function run(...args) {
  const r = spawnSync(process.execPath, [VALIDATOR, ...args], { cwd: here, encoding: 'utf-8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
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

console.log('\ntest-validate.mjs\n');

test('fixture con errori voluti → exit 1 e i tre errori attesi', () => {
  const { code, out } = run('../test-files');
  assert(code === 1, `exit atteso 1, ottenuto ${code}`);
  assert(out.includes("must have required property 'superseded_by'"), 'manca errore superseded_by');
  assert(out.includes('Riferimento rotto (depends_on)'), 'manca errore riferimento rotto');
  assert(out.includes('File .md raccolti: 5'), 'attesi 5 file raccolti');
});

test('profilo full su light-ok → exit 0', () => {
  const { code, out } = run('test-files/light-ok');
  assert(code === 0, `exit atteso 0, ottenuto ${code}\n${out}`);
});

test('profilo light su light-ok (con staleness_threshold) → exit 0, nessun warning di simmetria né di tipo', () => {
  const { code, out } = run('--profile', 'light', 'test-files/light-ok');
  assert(code === 0, `exit atteso 0, ottenuto ${code}\n${out}`);
  assert(!out.includes('Asimmetria grafo'), 'nel profilo light la simmetria non si controlla');
  assert(!out.includes('dovrebbe avere almeno un required_by'), 'required_by calcolato non usato');
  assert(!out.includes('fuori profilo'), `nessun campo fuori profilo atteso\n${out}`);
});

test('profilo full su light-ok → warning di asimmetria (required_by non dichiarato)', () => {
  const { out } = run('test-files/light-ok');
  assert(out.includes('Asimmetria grafo'), 'atteso warning di asimmetria nel profilo full');
});

test('profilo light su light-ko → exit 1 con obbligatori mancanti, required_by vietato, campo fuori profilo', () => {
  const { code, out } = run('--profile=light', 'test-files/light-ko');
  assert(code === 1, `exit atteso 1, ottenuto ${code}`);
  assert(out.includes('campo obbligatorio mancante "status"'), 'manca errore status');
  assert(out.includes('campo obbligatorio mancante "last_updated"'), 'manca errore last_updated');
  assert(out.includes('"required_by" non va scritto nel file'), 'manca errore required_by');
  assert(out.includes('campo fuori profilo "ai_summary"'), 'manca warning ai_summary');
});

test('doc senza status: nessun errore superseded_by (status è opzionale nel profilo full)', () => {
  const { out } = run('test-files/light-ko');
  assert(!out.includes("must have required property 'superseded_by'"), `errore superseded_by spurio\n${out}`);
});

test('code_refs (v0.6): validi nel profilo light, errori di schema riconosciuti', () => {
  const ok = run('--profile', 'light', 'test-files/light-ok/codice.md');
  assert(ok.code === 0, `atteso exit 0\n${ok.out}`);
  assert(!ok.out.includes('fuori profilo'), 'code_refs deve essere ammesso nel profilo light');
  const noDate = ok.out.split('\n').filter((l) => l.includes('verified senza date'));
  assert(noDate.length === 1 && noDate[0].includes('code_refs[0]'), `atteso un warning (code_refs[0] senza date, nota A16)\n${ok.out}`);
  const ko = run('test-files/light-ko/code-refs-errati.md');
  assert(ko.code === 1, `atteso exit 1, ottenuto ${ko.code}`);
  for (const frag of ["code_refs/0 must have required property 'path'", 'code_refs/1/verified/commit must match pattern', 'code_refs/2/repo must match pattern', 'code_refs/2 must NOT have additional properties']) {
    assert(ko.out.includes(frag), `manca: ${frag}\n${ko.out}`);
  }
});

test('verified.commit senza apici nel frontmatter → errore; ancore esenti (nota A11)', () => {
  const { code, out } = run('test-files/light-ko/commit-senza-apici.md');
  assert(code === 1, `exit atteso 1, ottenuto ${code}`);
  const errs = out.split('\n').filter((l) => l.includes('deve essere una stringa tra apici'));
  assert(errs.length === 2, `attesi 2 errori (0164750, 3e45123), trovati ${errs.length}\n${out}`);
  assert(errs.some((l) => l.includes('0164750')) && errs.some((l) => l.includes('3e45123')), errs.join('\n'));
  assert(!errs.some((l) => l.includes('abc1234')), "l'hash tra apici non va segnalato");
  assert(run('test-files/light-ok/codice.md').code === 0, 'hash tra apici: nessun errore');
});

test('profilo sconosciuto → exit 2', () => {
  const { code } = run('--profile', 'pesante', 'test-files/light-ok');
  assert(code === 2, `exit atteso 2, ottenuto ${code}`);
});

test('directory dello strumento: node_modules e test-files esclusi; test-files passata da sola sì (0.6-l)', () => {
  const count = (o) => (o.match(/File \.md raccolti: (\d+)/) || [])[1];
  // dalla cartella dello strumento: le fixture con errori voluti non entrano, i README di node_modules nemmeno
  const all = run('.');
  assert(count(all.out) === '0' || /Nessun file con header MR/.test(all.out), `attesi 0 file dalla cartella dello strumento, ${count(all.out)}`);
  const fx = run('test-files');
  assert(count(fx.out) === '6', `attesi 6 file passando test-files, raccolti ${count(fx.out)}`);
});

function tmpDocs(files) {
  const d = mkdtempSync(join(tmpdir(), 'mr-validate-'));
  for (const [name, fm] of Object.entries(files)) {
    writeFileSync(join(d, name), `---\nmr_version: '0.6'\n${fm}\ncreated: '2026-01-01'\nlast_updated: '2026-01-01'\n---\n\n# ${name}\n`);
  }
  return d;
}

test('superseded_by (0.6-l): id inesistente o non valido → errore; senza status superseded → warning', () => {
  const d = tmpDocs({
    'a.md': 'id: t/a\ntitle: A\ntype: handoff\nowner: t\nstatus: superseded\nsuperseded_by: t/inesistente',
    'b.md': 'id: t/b\ntitle: B\ntype: handoff\nowner: t\nstatus: superseded\nsuperseded_by: "t/c|motivo"',
    'c.md': 'id: t/c\ntitle: C\ntype: handoff\nowner: t\nstatus: active\nsuperseded_by: t/a',
  });
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(r.code === 1, `exit atteso 1, ottenuto ${r.code}`);
  assert(/Riferimento rotto \(superseded_by\): "t\/inesistente"/.test(r.out), 'riferimento rotto non segnalato');
  assert(/superseded_by: "t\/c\|motivo" non è un id valido/.test(r.out), 'id non valido non segnalato');
  assert(/c\.md: superseded_by presente ma status è "active"/.test(r.out), 'status incoerente non segnalato');
});

test('doc superseded o deprecated (0.6-l): nessun warning stale, freshness «retired»', () => {
  const d = tmpDocs({
    'old.md': 'id: t/old\ntitle: Old\ntype: roadmap\nowner: t\nstatus: superseded\nsuperseded_by: t/new',
    'dep.md': 'id: t/dep\ntitle: Dep\ntype: handoff\nowner: t\nstatus: deprecated',
    'new.md': 'id: t/new\ntitle: New\ntype: roadmap\nowner: t\nstatus: active',
  });
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(!/old\.md: Documento stale/.test(r.out) && !/dep\.md: Documento stale/.test(r.out), 'warning stale su doc superati');
  assert(/new\.md: Documento stale/.test(r.out), 'il doc attivo vecchio deve restare stale');
  assert(/t\/old .*retired/.test(r.out), 'freshness retired non mostrata');
});

test('depends_on strong verso deprecated/superseded (0.6-p): errore da un doc attivo, warning da un doc storico', () => {
  const d = tmpDocs({
    'arch.md': 'id: t/arch\ntitle: Arch\ntype: spec\nowner: t\nstatus: deprecated',
    'old.md': 'id: t/old\ntitle: Old\ntype: roadmap\nowner: t\nstatus: superseded\nsuperseded_by: t/new\ndepends_on:\n  - id: t/arch\n    reason: storico verso storico',
    'dep.md': 'id: t/dep\ntitle: Dep\ntype: handoff\nowner: t\nstatus: deprecated\ndepends_on:\n  - id: t/old\n    reason: verso superseded',
    'new.md': 'id: t/new\ntitle: New\ntype: roadmap\nowner: t\nstatus: active\ndepends_on:\n  - id: t/arch\n    reason: attivo verso deprecated',
  });
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  const errori = r.out.slice(r.out.indexOf('ERRORI'));
  assert(/new\.md: depends_on strong verso documento deprecated: "t\/arch"/.test(errori), 'da un doc attivo deve restare errore');
  assert(!/old\.md: depends_on strong/.test(errori) && !/dep\.md: depends_on strong/.test(errori), `da un doc storico non deve essere errore:\n${errori.slice(0, 600)}`);
  assert(/old\.md: depends_on strong verso documento deprecated: "t\/arch" \(anche questo doc è superseded: coerente\)/.test(r.out), 'warning per storico → storico');
  assert(/dep\.md: depends_on strong verso documento superseded: "t\/old" \(anche questo doc è deprecated/.test(r.out), 'warning anche verso superseded');
});

test('review_needed (0.6-z): ammesso nel profilo light, warning «da aggiornare» col motivo; vuoto o troppo lungo → errore di schema', () => {
  const d = tmpDocs({
    'ok.md': 'id: t/ok\ntitle: Ok\ntype: log\nowner: t\nstatus: active\nreview_needed: "elenco fermo a 52 funzioni"',
    'old.md': 'id: t/old\ntitle: Old\ntype: log\nowner: t\nstatus: superseded\nsuperseded_by: t/ok\nreview_needed: "storico"',
    'vuoto.md': 'id: t/vuoto\ntitle: Vuoto\ntype: log\nowner: t\nstatus: active\nreview_needed: ""',
    'lungo.md': `id: t/lungo\ntitle: Lungo\ntype: log\nowner: t\nstatus: active\nreview_needed: "${'x'.repeat(201)}"`,
  });
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(!/campo fuori profilo "review_needed"/.test(r.out), 'review_needed deve essere nel profilo light');
  assert(/ok\.md: da aggiornare \(review_needed\): elenco fermo a 52 funzioni/.test(r.out), 'warning col motivo assente');
  assert(!/old\.md: da aggiornare/.test(r.out), 'un doc superseded non è da aggiornare');
  const errori = r.out.slice(r.out.indexOf('ERRORI'));
  assert(/vuoto\.md:.*review_needed/.test(errori) && /lungo\.md:.*review_needed/.test(errori), `vuoto e troppo lungo devono essere errori:\n${errori.slice(0, 800)}`);
  assert(!/ok\.md:.*review_needed/.test(errori), 'ok.md non deve avere errori');
});

test('chiavi di altri strumenti (0.6-z1): pdf_options di md-to-pdf → warning nel profilo light, errore nel full; i campi MR restano controllati', () => {
  // il caso del volantino di app-web: md-to-pdf legge pdf_options dallo stesso blocco del frontmatter
  const d = tmpDocs({
    'volantino.md': 'id: t/volantino\ntitle: Volantino\ntype: reference\nowner: t\nstatus: active\nstaleness_threshold: never\npdf_options:\n  format: A5\n  margin: 10mm\n  printBackground: true',
    'errato.md': 'id: t/errato\ntitle: Errato\ntype: reference\nowner: t\nstatus: attivo\nlayout: ../layouts/Doc.astro',
  });
  const light = run('--profile', 'light', d);
  const full = run(d);
  const solo = run('--profile', 'light', join(d, 'volantino.md'));
  rmSync(d, { recursive: true, force: true });
  assert(solo.code === 0 && /0 errori/.test(solo.out), `il volantino non deve avere errori nel profilo light:\n${solo.out.slice(-1500)}`);
  assert(!/volantino\.md: Schema/.test(light.out), 'errore di schema sul volantino');
  assert(/volantino\.md: Profilo light: chiave di un altro strumento "pdf_options"/.test(light.out), 'warning per pdf_options assente');
  assert(/errato\.md: Profilo light: chiave di un altro strumento "layout"/.test(light.out), 'warning per layout assente');
  assert(/errato\.md: Schema: \/status must be equal to one of the allowed values/.test(light.out), 'uno status non valido resta errore');
  assert(!/must NOT have additional properties/.test(light.out), 'nel profilo light niente errore per le chiavi altrui');
  assert(/volantino\.md: Schema: \(root\) must NOT have additional properties/.test(full.out), 'nel profilo full resta errore');
});

// i tre titoli di portale-b (branch docs/mr-frontmatter: _docs/07-runbook/runbook-16-06-reminder-recupero.md,
// _docs/07-runbook/runbook_quiz_pool_AvsB_28-may.md, handoff_sim-20.md), scritti senza virgolette (0.6-z3)
const TITOLI_REALI = [
  'Runbook 16/06 — Due sequenze email: reminder incompleti + recupero non-accessi',
  'Runbook — Bivio pool quiz Prodotto: opzione A (volume) vs B (qualità)',
  'Handoff — Simulatore: pausa 2.0 e pivot ad app iPhone nativa',
];

test('frontmatter non leggibile (0.6-z3): i tre titoli di portale-b senza virgolette → errore con la riga, conteggio dei saltati', () => {
  const docs = Object.fromEntries(TITOLI_REALI.map((t, i) => [`doc${i + 1}.md`, `id: t/doc${i + 1}\ntitle: ${t}\ntype: guide\nowner: t\nstatus: active`]));
  docs['ok.md'] = `id: t/ok\ntitle: "${TITOLI_REALI[0]}"\ntype: guide\nowner: t\nstatus: active`;
  const d = tmpDocs(docs);
  writeFileSync(join(d, 'altro.md'), '---\nlayout: a: b\n---\n\n# Altro strumento\n');
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(r.code === 1, `exit atteso 1, ottenuto ${r.code}`);
  const errori = r.out.slice(r.out.indexOf('ERRORI'));
  for (const n of [1, 2, 3]) assert(new RegExp(`doc${n}\\.md: frontmatter non leggibile \\(riga 4: `).test(errori), `doc${n}.md: errore con la riga 4 assente:\n${r.out.slice(0, 2500)}`);
  assert(/altro\.md: frontmatter non leggibile \(riga 2: .*senza mr_version/.test(r.out) && !/altro\.md/.test(errori), 'senza mr_version: warning, non errore');
  assert(/File con frontmatter non leggibile \(saltati\): 4/.test(r.out) && /\|  4 saltati \(frontmatter non leggibile\)/.test(r.out), 'riepilogo dei saltati assente');
  assert(/Documenti analizzati: 1\b/.test(r.out) && !/ok\.md: frontmatter/.test(r.out), 'il titolo tra virgolette si legge');
});

test('status paused (0.6-z5): nessun warning stale né «da aggiornare», freshness «paused»', () => {
  const d = tmpDocs({ 'sospeso.md': 'id: t/sospeso\ntitle: "Sospeso"\ntype: reference\nowner: t\nstatus: paused\nreview_needed: "da rifare"' });
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(r.code === 0 && !/sospeso\.md: Documento stale/.test(r.out) && !/sospeso\.md: da aggiornare/.test(r.out), r.out.slice(0, 1500));
  assert(/t\/sospeso .*paused/.test(r.out), 'freshness paused non mostrata');
});

// backlog (0.6-z6): body con le sezioni dello schema standard
function backlogBody(aggiornato) {
  return ['', '# App — backlog', '', '## In corso', '| ID | Cosa | Perché | Chi | Aggiornato | Link |', '|---|---|---|---|---|---|',
    `| B-001 | Login | sicurezza | agente | ${aggiornato[0]} | — |`, `| B-002 | Export | report | agente | ${aggiornato[1]} | — |`,
    '', '## Prossimi (in ordine di priorità)', '| ID | Cosa | Perché | Chi | Aggiornato | Link |', '|---|---|---|---|---|---|', '| B-003 | Vecchia | x | y | 2020-01-01 | — |', ''].join('\n');
}

test('tipo backlog (0.6-z6): nessun vincolo di relazioni; vecchio solo per voci «In corso» ferme oltre 14 giorni', () => {
  const oggi = new Date();
  const g = (n) => new Date(oggi.getTime() - n * 86400000).toISOString().slice(0, 10);
  const it = (n) => { const d = new Date(oggi.getTime() - n * 86400000); return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`; };
  const d = tmpDocs({
    'fresco.md': 'id: t/fresco\ntitle: "Fresco"\ntype: backlog\nowner: t\nstatus: active',
    'fermo.md': 'id: t/fermo\ntitle: "Fermo"\ntype: backlog\nowner: t\nstatus: active',
    'soglia.md': 'id: t/soglia\ntitle: "Soglia"\ntype: backlog\nowner: t\nstatus: active\nstaleness_threshold: 30d',
    'senza.md': 'id: t/senza\ntitle: "Senza data"\ntype: backlog\nowner: t\nstatus: active',
  });
  const add = (f, body) => writeFileSync(join(d, f), readFileSync(join(d, f), 'utf-8') + body);
  add('fresco.md', backlogBody([g(3), it(10)]));      // created/last_updated del 2026-01-01: la data del file non conta
  add('fermo.md', backlogBody([g(20), g(2)]));
  add('soglia.md', backlogBody([g(20), g(2)]));
  add('senza.md', backlogBody(['?', g(1)]));
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(r.code === 0, `exit atteso 0, ottenuto ${r.code}\n${r.out.slice(0, 1500)}`);
  assert(!/Vincolo tipo/.test(r.out) && !/campo fuori profilo/.test(r.out), 'nessun vincolo di relazioni né campi fuori profilo');
  assert(!/fresco\.md: (Backlog|Documento stale)/.test(r.out), 'backlog fresco: niente warning, anche col file del 2026-01-01');
  assert(/fermo\.md: Backlog: 1 voce «In corso» ferma da più di 14 giorni: B-001 \(20 g\)/.test(r.out), r.out.slice(0, 2000));
  assert(!/soglia\.md: Backlog/.test(r.out), 'staleness_threshold: 30d alza la soglia');
  assert(/senza\.md: Backlog: 1 senza una data leggibile in «Aggiornato»: B-001/.test(r.out), 'riga senza data segnalata');
  assert(/t\/fermo .*stale/.test(r.out) && /t\/fresco .*fresh/.test(r.out), 'freshness della tabella');
});

test('vincoli di tipo (0.6-z6): spenti sui doc chiusi e con `depends_on: []` esplicito; restano sugli altri', () => {
  const d = tmpDocs({
    'report-chiuso.md': 'id: t/report-chiuso\ntitle: "Report"\ntype: report\nowner: t\nstatus: deprecated',
    'spec-superata.md': 'id: t/spec-superata\ntitle: "Spec"\ntype: spec\nowner: t\nstatus: superseded\nsuperseded_by: t/roadmap-vuota',
    'roadmap-vuota.md': 'id: t/roadmap-vuota\ntitle: "Roadmap"\ntype: roadmap\nowner: t\nstatus: active\ndepends_on: []',
    'roadmap-attiva.md': 'id: t/roadmap-attiva\ntitle: "Roadmap"\ntype: roadmap\nowner: t\nstatus: active',
  });
  const r = run('--profile', 'light', d);
  rmSync(d, { recursive: true, force: true });
  assert(!/report-chiuso\.md: Vincolo tipo/.test(r.out) && !/spec-superata\.md: Vincolo tipo/.test(r.out), 'doc chiusi: nessun vincolo di tipo');
  assert(!/roadmap-vuota\.md: Vincolo tipo/.test(r.out) && !/roadmap-vuota\.md:.*(Schema|fuori profilo)/.test(r.out), '`depends_on: []` esplicito: nessun vincolo, schema valido');
  assert(/roadmap-attiva\.md: Vincolo tipo: un "roadmap" dovrebbe avere almeno un depends_on/.test(r.out), 'il vincolo resta su un doc attivo senza depends_on');
});

const passed = results.filter(Boolean).length;
console.log(`\nRisultato: ${passed}/${results.length} PASS`);
process.exit(passed === results.length ? 0 : 1);
