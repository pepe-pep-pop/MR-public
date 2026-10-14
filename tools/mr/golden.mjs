#!/usr/bin/env node
/**
 * golden.mjs — misura del claim check sul golden set storico (PRD v0.6 §8).
 *
 *   node tools/mr/golden.mjs --repos-root <dir> [--cases <file>] [--format md|json] [--skip-repo <nome>]...
 *
 * Per ogni caso (repo, code_commit → doc_commit, doc) lancia il claim check AL
 * code_commit: doc e codice letti a quel commit, via git, senza checkout. Due misure:
 *   - doc segnalato: almeno un not_found nel doc (criterio del PRD §8);
 *   - claim rilevante: almeno un not_found su un token che il doc_commit ha tolto (non
 *     riscritto uguale) E che al doc_commit non è più not_found: il segnale punta proprio
 *     alla deriva che è stata corretta.
 *
 * Misura 0.6-b (nota A6): per i casi con `refs_06b`, i link dichiarati si valutano con R3
 * al code_commit, con verified = commit precedente; segnale = drift, moved o missing.
 * Controllo: allo stesso commit precedente tutti i link devono risultare ok.
 *
 * Misura 0.6-c (nota A8): ancore PROPOSTE dal tool. suggest-links gira al commit precedente
 * al code_commit (doc e codice di allora); R3 gira al code_commit con verified = quel commit.
 * Segnale = una proposta nella sezione poi corretta va in drift/moved/missing. Rumore = proposte
 * di altre sezioni in deriva allo stesso commit (verifiche in più, non per forza sbagliate).
 *
 * Sola lettura sui repo degli altri workspace: solo git show / ls-tree / grep / diff.
 * L'output contiene solo repo, commit, path, tipo di claim e nomi tecnici.
 * Exit code: 0 eseguito, 2 errore (cases mancanti, repo assente).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RepoView } from './lib/repo.mjs';
import { checkDoc, checkDocs, loadIgnore } from './lib/claims.mjs';
import { proposeLinks } from './lib/suggest.mjs';
import { DriftContext, evaluateRef } from './lib/drift.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CASES = resolve(here, '../../tests/golden/cases.json');

function parseArgs(argv) {
  const o = { reposRoot: null, cases: DEFAULT_CASES, format: 'md', skipRepos: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repos-root') o.reposRoot = argv[++i];
    else if (argv[i] === '--cases') o.cases = argv[++i];
    else if (argv[i] === '--format') o.format = argv[++i];
    else if (argv[i] === '--skip-repo') o.skipRepos.push(argv[++i]);
    else if (argv[i] === '--externals') o.externals = argv[++i];
    else o.error = `argomento sconosciuto: ${argv[i]}`;
  }
  if (!o.reposRoot) o.error = '--repos-root è obbligatorio';
  return o;
}

/** token tra backtick sulle righe tolte dal doc_commit nel doc */
function removedTokens(repo, docCommit, doc) {
  const diff = execFileSync('git', ['-C', repo.root, 'diff', '-U0', `${docCommit}^`, docCommit, '--', doc], {
    encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024,
  });
  const removed = new Set();
  const added = new Set();
  for (const l of diff.split('\n')) {
    if (l.startsWith('---') || l.startsWith('+++')) continue;
    const target = l.startsWith('-') ? removed : l.startsWith('+') ? added : null;
    if (!target) continue;
    for (const m of l.matchAll(/`([^`]+)`/g)) target.add(m[1].trim());
  }
  return { removed, changed: new Set([...removed].filter((t) => !added.has(t))) };
}

// repo esterni per caso (0.6-f): { "<repo del caso>": ["<repo esterno>", …] }, path relativi a --repos-root
let EXTERNALS = {};

/**
 * Repo esterni di un caso, letti all'ultimo commit prima della data del commit misurato
 * (lo stato che esisteva allora).
 */
function externalsAt(reposRoot, c, view, rev) {
  const list = EXTERNALS[c.repo] || [];
  if (!list.length) return () => [];
  const date = view.git(['show', '-s', '--format=%cI', rev]).trim();
  const views = list.map((rel) => {
    const root = join(reposRoot, rel);
    const at = execFileSync('git', ['-C', root, 'rev-list', '-1', `--before=${date}`, 'HEAD'], { encoding: 'utf-8' }).trim();
    return at ? new RepoView(root, at) : null;
  }).filter(Boolean);
  return () => views;
}

function evaluate(reposRoot, c) {
  const root = join(reposRoot, c.repo);
  if (!existsSync(join(root, '.git'))) return { ...c, error: `repo non trovato: ${c.repo}` };
  const atCode = new RepoView(root, c.code_commit);
  const atFix = new RepoView(root, c.doc_commit);
  // doc spostato tra il commit di codice e il fix (hold-out 3): path di allora in doc_at_code
  const docAtCode = c.doc_at_code || c.doc;
  if (!atCode.listFiles().includes(docAtCode)) return { ...c, error: `doc assente al code_commit` };

  const records = checkDoc(atCode, docAtCode, { ignore: loadIgnore(atCode), externalReposFor: externalsAt(reposRoot, c, atCode, c.code_commit) });
  const notFound = records.filter((r) => r.status === 'not_found');
  const ident = identifierNoise(root, c, docAtCode, records, reposRoot);
  // caso aperto (hold-out 2, nota A18): nessun commit di correzione. R5 «rilevante» =
  // un not_found nella sezione derivata al code_commit.
  if (!c.doc_commit) {
    const inSec = notFound.filter((r) => sameSection(c.section, r.section));
    let suggested = null;
    try {
      suggested = evaluate06c(root, c);
    } catch (err) {
      suggested = { error: err.message.split('\n')[0] };
    }
    return {
      id: c.id, repo: c.repo, kind: c.kind, realistic: c.realistic, code_commit: c.code_commit, doc_commit: null, doc: c.doc, open: true,
      relevant_hit_without_identifier: inSec.some((r) => r.kind !== 'identifier'), identifier: ident,
      claims: records.length, not_found: notFound.length, doc_flagged: notFound.length > 0,
      relevant_hit: inSec.length > 0, relevant: inSec.map((r) => ({ line: r.line, kind: r.kind, claim: r.claim })),
      discarded_still_not_found_after_fix: [], refs: null, refs_not_applicable: 'caso aperto', suggested,
    };
  }
  const { changed } = removedTokens(atCode, c.doc_commit, c.doc);
  // etichetta oggettiva (0.6-g, A29): il fix toglie o cambia almeno un nome tra backtick
  const labelObj = changed.size ? 'nome' : 'semantico';
  const candidates = notFound.filter((r) => changed.has(r.claim) || changed.has(r.key));

  // controllo: dopo la correzione il token non deve più essere not_found
  let stillAfterFix = [];
  if (candidates.length) {
    const after = checkDoc(atFix, c.doc, { ignore: loadIgnore(atFix), externalReposFor: externalsAt(reposRoot, c, atFix, c.doc_commit) });
    const keys = new Set(candidates.map((r) => r.key));
    stillAfterFix = [...new Set(after.filter((r) => r.status === 'not_found' && keys.has(r.key)).map((r) => r.key))];
  }
  const relevant = candidates.filter((r) => !stillAfterFix.includes(r.key));
  const relevantKeys = new Set(relevant.map((r) => r.key));
  ident.nf_code_not_relevant = notFound.filter((r) => r.kind === 'identifier' && !relevantKeys.has(r.key)).length;
  // ── 0.6-b: code_refs dichiarati ──
  let refs = null;
  if (c.refs_06b?.refs) {
    const parent = atCode.git(['rev-parse', '--short', `${c.code_commit}^`]).trim();
    const evalAt = (rev) => {
      const view = new RepoView(root, rev);
      const ctx = new DriftContext(view, [view]);
      return c.refs_06b.refs.map((r) => evaluateRef({ ...r, verified: { commit: parent } }, ctx));
    };
    const atChange = evalAt(c.code_commit);
    const atParent = evalAt(parent);
    // costo: commit sui file collegati nei 90 giorni prima del code_commit (escluso),
    // cioè quante altre volte questi link avrebbero chiesto una verifica
    const date = atCode.git(['show', '-s', '--format=%cI', c.code_commit]).trim();
    const since = new Date(new Date(date).getTime() - 90 * 86400000).toISOString();
    const specs = c.refs_06b.refs.map((r) => (r.path.includes('*') ? `:(glob)${r.path}` : r.path));
    const churn = atCode.git(['log', '--format=%h', `--since=${since}`, parent, '--', ...specs]).split('\n').filter(Boolean).length;
    refs = {
      churn90: churn,
      statuses: atChange.map((r) => `${r.path.split('/').pop()}${r.symbol ? '#' + r.symbol : ''}: ${r.status}`),
      signal: atChange.some((r) => ['drift', 'moved', 'missing'].includes(r.status)),
      sanity_ok: atParent.every((r) => r.status === 'ok'),
    };
  }
  let suggested = null;
  try {
    suggested = evaluate06c(root, c);
  } catch (err) {
    suggested = { error: err.message.split('\n')[0] };
  }
  return {
    id: c.id, repo: c.repo, kind: c.kind, label_obj: labelObj, realistic: c.realistic, readme_rule: c.readme_rule, code_commit: c.code_commit, doc_commit: c.doc_commit, doc: c.doc,
    refs,
    suggested,
    refs_not_applicable: c.refs_06b?.not_applicable,
    claims: records.length,
    not_found: notFound.length,
    doc_flagged: notFound.length > 0,
    relevant_hit: relevant.length > 0,
    relevant: relevant.map((r) => ({ line: r.line, kind: r.kind, claim: r.claim })),
    // R5 senza il claim identificatore = R5 della 0.6-d (gli altri tipi non sono cambiati)
    relevant_hit_without_identifier: relevant.some((r) => r.kind !== 'identifier'),
    identifier: ident,
    discarded_still_not_found_after_fix: stillAfterFix,
  };
}

/**
 * Rumore del claim identificatore (report/0.6-e/regole.md §3): al commit precedente al
 * commit di codice il doc era vero per definizione del caso, quindi ogni not_found di tipo
 * identifier è un falso allarme (salvo derive diverse già presenti).
 */
function identifierNoise(root, c, docAtCode, recordsAtCode, reposRoot) {
  const probe = new RepoView(root, c.code_commit);
  const parent = probe.git(['rev-parse', '--short', `${c.code_commit}^`]).trim();
  const before = new RepoView(root, parent);
  const out = { claims_code: recordsAtCode.filter((r) => r.kind === 'identifier').length };
  if (!before.listFiles().includes(docAtCode)) return { ...out, parent_error: 'doc assente al commit precedente' };
  const recs = checkDoc(before, docAtCode, { ignore: loadIgnore(before), externalReposFor: externalsAt(reposRoot, c, before, parent) }).filter((r) => r.kind === 'identifier');
  const nf = recs.filter((r) => r.status === 'not_found');
  const ext = recs.filter((r) => r.status === 'external');
  return { ...out, claims_parent: recs.length, nf_parent: nf.length, nf_parent_keys: [...new Set(nf.map((r) => r.claim))], external_parent: ext.length };
}

function normSec(s) {
  // titoli con formattazione (`create-cc-booking`, **x**): conta il testo
  return String(s || '').replace(/^#+\s*/, '').replace(/[`*]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** la sezione della proposta è quella del caso? (sezioni composte «a / b», riquadri sotto il titolo) */
function sameSection(caseSection, propSection) {
  const p = normSec(propSection);
  if (caseSection.trim().startsWith('(')) return /^#\s/.test(propSection) || propSection === '';
  return caseSection.split(' / ').map(normSec).some((c) => c && (p.includes(c) || (p && c.includes(p))));
}

function evaluate06c(root, c) {
  const probe = new RepoView(root, c.code_commit);
  const parent = probe.git(['rev-parse', '--short', `${c.code_commit}^`]).trim();
  const before = new RepoView(root, parent);
  const doc = c.doc_at_code || c.doc;
  if (!before.listFiles().includes(doc)) return { error: 'doc assente al commit precedente' };
  const text = before.readFile(doc);
  const records = checkDocs(before, [doc], { ignore: loadIgnore(before) });
  if (records.some((r) => r.historical)) return { error: 'doc storico al commit precedente' };
  const proposals = proposeLinks(text, records, () => null, before, doc);
  // la sezione nomina codice? (nota A14): almeno un claim, o un nome tra backtick nel titolo
  const heading = (text.match(/^#{1,6}\s+.+$/gm) || []).find((h) => sameSection(c.section, h.trim()));
  const namesCode = records.some((r) => sameSection(c.section, r.section)) || /`[^`]+`/.test(heading || '');
  // definizione della 0.6-d (senza il claim identificatore), per confronto
  const namesCode06d = records.some((r) => r.kind !== 'identifier' && sameSection(c.section, r.section)) || /`[^`]+`/.test(heading || '');
  const atChange = new RepoView(root, c.code_commit);
  const ctx = new DriftContext(atChange, [atChange]);
  const evaluated = proposals.map((p) => ({ ...p, res: evaluateRef({ path: p.path, symbol: p.symbol, verified: { commit: parent } }, ctx) }));
  const sig = (e) => ['drift', 'moved', 'missing'].includes(e.res.status);
  const inSection = evaluated.filter((e) => sameSection(c.section, e.section));
  const readme = evaluated.find((e) => e.from === 'posizione del README');
  return {
    names_code: namesCode,
    names_code_06d: namesCode06d,
    ...(readme ? { readme_proposal: { path: readme.path, section: readme.section, in_section: sameSection(c.section, readme.section), status: readme.res.status } } : {}),
    proposals: proposals.length,
    file_level: proposals.filter((p) => p.level === 'file').length,
    in_section: inSection.length,
    section_signal: inSection.some(sig),
    section_hits: inSection.filter(sig).map((e) => `${e.path.split('/').pop()}${e.symbol ? '#' + e.symbol : ''}: ${e.res.status}`),
    other_signals: evaluated.filter((e) => !sameSection(c.section, e.section) && sig(e)).length,
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

function pct(n, d) {
  return d ? `${Math.round((100 * n) / d)}%` : 'n/a';
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error(o.error);
    return 2;
  }
  if (!existsSync(o.cases)) {
    console.error(`cases non trovato: ${o.cases}`);
    return 2;
  }
  const cases = JSON.parse(readFileSync(o.cases, 'utf-8')).cases;
  if (o.externals) EXTERNALS = JSON.parse(readFileSync(o.externals, 'utf-8'));
  // --skip-repo: repo da non leggere affatto (es. app-web durante il lavoro del suo agente)
  const skipped = cases.filter((c) => c.cross_repo || o.skipRepos.includes(c.repo))
    .map((c) => (c.cross_repo ? c : { ...c, cross_repo: 'repo escluso con --skip-repo: non letto' }));
  const results = cases.filter((c) => !c.cross_repo && !o.skipRepos.includes(c.repo)).map((c) => {
    try {
      return evaluate(resolve(o.reposRoot), c);
    } catch (err) {
      return { ...c, error: err.message.split('\n')[0] };
    }
  });
  const ok = results.filter((r) => !r.error);
  const by = (k) => ok.filter((r) => !k || r.kind === k);
  const stats = (rs) => ({
    cases: rs.length,
    doc_flagged: rs.filter((r) => r.doc_flagged).length,
    relevant_hit: rs.filter((r) => r.relevant_hit).length,
    refs_cases: rs.filter((r) => r.refs).length,
    refs_signal: rs.filter((r) => r.refs?.signal).length,
    either: rs.filter((r) => r.relevant_hit || r.refs?.signal).length,
    sugg_cases: rs.filter((r) => r.suggested && !r.suggested.error).length,
    sugg_with_section: rs.filter((r) => r.suggested?.in_section > 0).length,
    sugg_signal: rs.filter((r) => r.suggested?.section_signal).length,
    sugg_or_r5: rs.filter((r) => r.relevant_hit || r.suggested?.section_signal).length,
    names_code: rs.filter((r) => r.suggested?.names_code).length,
    names_code_signal: rs.filter((r) => r.suggested?.names_code && r.suggested.section_signal).length,
    names_code_06d: rs.filter((r) => r.suggested?.names_code_06d).length,
    names_code_06d_signal: rs.filter((r) => r.suggested?.names_code_06d && r.suggested.section_signal).length,
    realistic: rs.filter((r) => r.realistic).length,
    realistic_relevant: rs.filter((r) => r.realistic && r.relevant_hit).length,
    realistic_relevant_06d: rs.filter((r) => r.realistic && r.relevant_hit_without_identifier).length,
    relevant_hit_06d: rs.filter((r) => r.relevant_hit_without_identifier).length,
    only_identifier: rs.filter((r) => r.relevant_hit && !r.relevant_hit_without_identifier).map((r) => r.id),
    ident_claims_parent: rs.reduce((n, r) => n + (r.identifier?.claims_parent || 0), 0),
    ident_nf_parent: rs.reduce((n, r) => n + (r.identifier?.nf_parent || 0), 0),
    ident_nf_parent_median: median(rs.filter((r) => r.identifier?.claims_parent !== undefined).map((r) => r.identifier.nf_parent)),
    ident_nf_code_not_relevant: rs.reduce((n, r) => n + (r.identifier?.nf_code_not_relevant || 0), 0),
    ident_external_parent: rs.reduce((n, r) => n + (r.identifier?.external_parent || 0), 0),
    no_code: rs.filter((r) => r.suggested && !r.suggested.error && !r.suggested.names_code).length,
    sugg_proposals: rs.reduce((n, r) => n + (r.suggested?.proposals || 0), 0),
    sugg_file_level: rs.reduce((n, r) => n + (r.suggested?.file_level || 0), 0),
    sugg_other_signals: rs.reduce((n, r) => n + (r.suggested?.other_signals || 0), 0),
  });
  const summary = { all: stats(by()), existence: stats(by('existence')), semantic: stats(by('semantic')), errors: results.length - ok.length };

  if (o.format === 'json') {
    console.log(JSON.stringify({ summary, results, skipped: skipped.map((c) => ({ id: c.id, reason: c.cross_repo })) }, null, 2));
    return 0;
  }
  const L = [];
  L.push('# Golden set — claim check 0.6-a');
  L.push('');
  L.push('| Insieme | Casi | Doc segnalato (0.6-a, largo) | Claim rilevante R5 | Con code_refs: casi misurabili | Segnale R3 | R5 o R3 |');
  L.push('|---|---|---|---|---|---|---|');
  for (const [name, s] of Object.entries(summary)) {
    if (name === 'errors') continue;
    L.push(`| ${name} | ${s.cases} | ${s.doc_flagged} (${pct(s.doc_flagged, s.cases)}) | ${s.relevant_hit} (${pct(s.relevant_hit, s.cases)}) | ${s.refs_cases} | ${s.refs_signal} (${pct(s.refs_signal, s.refs_cases)}) | ${s.either} (${pct(s.either, s.cases)}) |`);
  }
  L.push('');
  L.push('### Soglia (note A14, A17): solo sezioni che nominano codice', '');
  L.push('| Insieme | Casi | Sezioni che nominano codice | Segnale (proposte del tool) | Recall | Sezioni senza codice nominato (lavoro manuale) |');
  L.push('|---|---|---|---|---|---|');
  for (const [name, s] of Object.entries(summary)) {
    if (name === 'errors') continue;
    L.push(`| ${name} | ${s.sugg_cases} | ${s.names_code} | ${s.names_code_signal} | ${pct(s.names_code_signal, s.names_code)} | ${s.no_code} (${pct(s.no_code, s.sugg_cases)}) |`);
  }
  L.push('');
  const a = summary.all;
  L.push('### 0.6-e — claim identificatore (report/0.6-e/regole.md)', '');
  L.push('| | Valore |', '|---|---|');
  L.push(`| Claim rilevante R5, 0.6-d (senza identificatore) | ${a.relevant_hit_06d}/${a.cases} (${pct(a.relevant_hit_06d, a.cases)}) |`);
  L.push(`| Claim rilevante R5, 0.6-e | ${a.relevant_hit}/${a.cases} (${pct(a.relevant_hit, a.cases)}) |`);
  L.push(`| Realistici: 0.6-d → 0.6-e | ${a.realistic_relevant_06d}/${a.realistic} → ${a.realistic_relevant}/${a.realistic} |`);
  L.push(`| Casi presi solo grazie all'identificatore | ${a.only_identifier.join(', ') || 'nessuno'} |`);
  L.push(`| Rumore (a): not_found identificatore al commit precedente / claim identificatore | ${a.ident_nf_parent}/${a.ident_claims_parent} (${pct(a.ident_nf_parent, a.ident_claims_parent)}) · mediana per doc ${a.ident_nf_parent_median} |`);
  L.push(`| Rumore (b): not_found identificatore non rilevanti al commit di codice | ${a.ident_nf_code_not_relevant} |`);
  L.push(`| Identificatori con esito external al commit precedente | ${a.ident_external_parent} |`);
  L.push(`| Sezioni che nominano codice: 0.6-d → 0.6-e (segnale) | ${a.names_code_06d} (${a.names_code_06d_signal}) → ${a.names_code} (${a.names_code_signal}) |`);
  for (const r of results.filter((x) => x.readme_rule && !x.error)) {
    const p = r.suggested?.readme_proposal;
    L.push(`| Regola README, ${r.id} | ${p ? `proposta \`${p.path}\` ${p.in_section ? 'nella sezione' : 'in altra sezione'} → **${p.status}**` : 'nessuna proposta README'} |`);
  }
  L.push('');
  L.push('### 0.6-c — ancore proposte da suggest-links (nota A8)', '');
  L.push('| Insieme | Casi | Con proposte nella sezione | Segnale nella sezione | R5 o proposte | Proposte (di cui file intero) | Segnali in altre sezioni |');
  L.push('|---|---|---|---|---|---|---|');
  for (const [name, s] of Object.entries(summary)) {
    if (name === 'errors') continue;
    L.push(`| ${name} | ${s.sugg_cases} | ${s.sugg_with_section} | ${s.sugg_signal} (${pct(s.sugg_signal, s.sugg_cases)}) | ${s.sugg_or_r5} (${pct(s.sugg_or_r5, s.cases)}) | ${s.sugg_proposals} (${s.sugg_file_level}) | ${s.sugg_other_signals} |`);
  }
  L.push('');
  if (summary.errors) L.push(`Casi non valutati per errore: ${summary.errors}`, '');
  for (const c of skipped) L.push(`Escluso: ${c.id} (${c.repo}) — ${c.cross_repo}`, '');
  L.push('| Caso | Repo | Tipo | code → doc | Claim | not_found | Doc | Rilevante (R5) | code_refs (R3) | Proposte (0.6-c) | Nota |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    if (r.error) {
      L.push(`| ${r.id} | ${r.repo} | ${r.kind} | ${r.code_commit} → ${r.doc_commit} | — | — | — | — | — | — | errore: ${r.error} |`);
      continue;
    }
    const rel = [...new Set(r.relevant.map((x) => `\`${x.claim}\``))].join(', ');
    const after = r.discarded_still_not_found_after_fix.length ? `scartati (ancora not_found dopo il fix): ${r.discarded_still_not_found_after_fix.join(', ')}` : '';
    const refCell = r.refs ? `${r.refs.signal ? '✅' : '❌'} ${r.refs.statuses.join('; ')} · commit nei 90 gg prima: ${r.refs.churn90}${r.refs.sanity_ok ? '' : ' ⚠️ controllo al commit precedente non ok'}` : `n/a: ${r.refs_not_applicable || '—'}`;
    const sg = r.suggested;
    const sugCell = !sg ? '—' : sg.error ? `errore: ${sg.error}` : `${sg.names_code ? '' : '(sezione senza codice nominato) '}${sg.section_signal ? '✅' : '❌'} ${sg.in_section}/${sg.proposals} nella sezione${sg.section_hits.length ? ': ' + sg.section_hits.join('; ') : ''} · altre in deriva: ${sg.other_signals}`;
    L.push(`| ${r.id} | ${r.repo} | ${r.kind} | ${r.code_commit} → ${r.doc_commit} | ${r.claims} | ${r.not_found} | ${r.doc_flagged ? '✅' : '❌'} | ${r.relevant_hit ? `✅ ${rel}` : '❌'} | ${refCell} | ${sugCell} | ${after} |`);
  }
  console.log(L.join('\n'));
  return 0;
}

process.exitCode = main();
