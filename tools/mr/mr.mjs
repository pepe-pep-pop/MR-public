#!/usr/bin/env node
/**
 * mr.mjs — comando `mr` (MR v0.6, fasi a e b).
 *
 *   mr claims <doc|dir> ...            claim check (R5)
 *   mr scan   <doc|dir> ...            claim check + deriva dei code_refs e delle ancore (R1-R4)
 *   mr impact <path|commit|a..b|--staged> [--docs <dir>]   doc da ricontrollare (R6)
 *   mr verify <doc>[#sezione] [--write]   verifica dei link, aggiornamento di verified (R7)
 *   mr suggest-links <doc|dir> [--write]  proposta di link, ancorati alla funzione (R8)
 *   mr remap <doc|dir> --commit-map <f> [--write]  verified riancorati dopo git filter-repo (A16)
 *   mr coverage [<repo>] [--docs <dir>]   punti d'ingresso del codice che nessun doc cita (R9)
 *   mr rivisto <doc> [--write] [--data d]  doc riletto e ancora vero: solo last_updated (0.6-y)
 *   mr env [<repo>] [--docs <dir>] [--rev c]  variabili lette dal codice ↔ elenchi (0.6-z9)
 *   mr stato [<repo>] [--indice <f>]           a che punto è il repo con MR e qual è il passo dopo (0.6-z11)
 *   mr indice [--write]                        indice dei doc dei workspace in ~/.mr/indice/INDICE_DOC.tsv (0.6-z17)
 *   mr trova <parole> [--owner o] [--type t] [--repo r]   i 10 doc più pertinenti dall'indice (0.6-z17, in prova)
 *
 * claims, scan, impact: sola lettura, sempre. verify, suggest-links, remap e rivisto scrivono SOLO con
 * --write e solo nei doc indicati; mai nel codice. `indice` scrive solo con --write e solo il suo TSV;
 * `trova` lo rigenera da solo se manca, ha più di un giorno o doc cambiati dopo (0.6-z24, z28; salvo --senza-rinnovo). Doc e codice si leggono via git (anche a
 * un commit, senza checkout). Nessuna rete, nessun LLM. Repo locali con --code-repo o
 * mr.repos.yaml (R10, note A5 e A9).
 *
 * Exit code (R11, 0.6-z10): 0 anche con segnali (MR segnala, non blocca) · 1 solo con --fail: claim
 * not_found, o link drift/moved/missing (esclusi i doc storici, nota A7); per `impact` solo per
 * un'ancora toccata (0.6-t); per `env` un nome non elencato · 2 errore del tool.
 * `scan` (0.6-p): in un doc con link contano solo i link; i claim restano nel report.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { collectMarkdownArgs, findRepoRoot } from '../lib/discover.mjs';
import { percorsoIUD } from './lib/iud.mjs';
import { RepoView, isSecretPath, scriviNelRepo } from './lib/repo.mjs';
import { checkDocs, loadIgnore, parseIgnore, codeExcludes, summarize, IGNORE_FILE } from './lib/claims.mjs';
import { readCodeRefs } from './lib/coderefs.mjs';
import { readFrontmatter, historicalReason, erroreFrontmatter } from './lib/frontmatter.mjs';
import { messaggioParser, bloccoMr } from '../lib/illeggibile.mjs';
import { nonVivo } from './lib/vivi.mjs';
import { shaNonRisolti } from '../lib/redazioni.mjs';
import { DriftContext, evaluateRef } from './lib/drift.mjs';
import { parseDiff, targetDiff, findImpacted, versionOnly } from './lib/impact.mjs';
import { RepoMap } from './lib/repomap.mjs';
import { planVerify, textChanges, applyUpdates } from './lib/verify.mjs';
import { parseCommitMap, planRemap } from './lib/remap.mjs';
import { toSegnalazioni } from './lib/segnalazione.mjs';
import { coverage } from './lib/coverage.mjs';
import { livello, haRegola, nelGiro, SOGLIA_VIVI } from './lib/stato.mjs';
import { parseIndice, defaultIndice, workspaceRepos } from './lib/indice.mjs';
import { costruisciIndice, scriviIndice, cartellaIndice, leggiIndice, trova, cercaNelTesto, parole, pulito, INDICE_FILE } from './lib/indicedoc.mjs';
import { nomiLetti, nomiEsempi, nomiNeiDoc, confrontoEnv, loadEnvConfig, envFileEsterni } from './lib/env.mjs';
import { RemoteRepos, evaluateRemoteRef } from './lib/remote.mjs';
import { proposeLinks, insertAnchors } from './lib/suggest.mjs';
import { REDAZIONI_FILE, parseRedazioni, commitsDelFile, dateDaCommit, soloFrontmatterGit, dateImport, commitsDiTutti, dateDiTutti } from './lib/date.mjs';
import { toJson, toMarkdown, scanToMarkdown, summarizeRefs, impactToMarkdown, ancoraToccata, NON_BLOCCA, recordMostrabile } from './lib/report.mjs';

export const MR_VERSION = '0.6.0-z36';
const COMMANDS = ['claims', 'scan', 'impact', 'verify', 'suggest-links', 'remap', 'coverage', 'rivisto', 'date', 'vivi', 'env', 'stato', 'indice', 'trova'];
const WRITERS = new Set(['verify', 'suggest-links', 'remap', 'rivisto', 'indice']);

const HELP = `
mr ${MR_VERSION} — Metadati Relazionali, collegamento codice ↔ doc

USAGE:
  node tools/mr/mr.mjs claims <doc|dir> [...] [flags]   affermazioni del doc verificate sul codice (R5)
  node tools/mr/mr.mjs scan   <doc|dir> [...] [flags]   claims + deriva dei code_refs e delle ancore (R1-R4)
  node tools/mr/mr.mjs impact <bersaglio> [--docs <dir>] [--senza-contenitori] [flags]   doc da ricontrollare dopo una modifica (R6); senza --docs anche i repo contenitori e GL (0.6-z33)
  node tools/mr/mr.mjs verify <doc>[#sezione] [--write]   mostra codice e diff dei link; con --write
                                                          aggiorna verified al commit corrente (R7)
  node tools/mr/mr.mjs suggest-links <doc|dir> [--write [--only <n,…>]]
                                                          propone ancore dai claim trovati, alla
                                                          funzione; file intero solo se serve (R8).
                                                          Esclude hof-*.md, handoff/, segnalazioni/,
                                                          log/ (diari); --include-journals per includerli.
                                                          --only: solo le proposte con quei numeri
                                                          (colonna # dell'anteprima, stessi argomenti)
  node tools/mr/mr.mjs rivisto <doc> [--write] [--data YYYY-MM-DD] [--tieni-review]
                                                          doc riletto e ancora vero: aggiorna solo
                                                          last_updated del frontmatter MR e toglie
                                                          review_needed (--tieni-review: lo lascia).
                                                          Rifiuta un doc senza frontmatter; scrive
                                                          solo con --write
  node tools/mr/mr.mjs vivi [<repo|dir>] [--senza-frontmatter] [--json] [--ignore-dir <d> --workspace <slug>] [--rev <c>]
                                                          doc vivi del repo (gli stessi del giro: niente
                                                          storici per path, codice:, doc:, storico:) e
                                                          quali hanno il frontmatter MR. Sola lettura
  node tools/mr/mr.mjs date <doc|dir> [--redazioni <f>] [--rev <commit>]
                                                          created e last_updated da git per il
                                                          frontmatter, saltando i commit di sola
                                                          redazione dichiarati in mr.redazioni (sha o
                                                          «messaggio: <testo>»). «import: <sha>»: per i
                                                          doc nati in quel commit, date dal testo
                                                          («Data:», «Last updated:»). Sola lettura
  node tools/mr/mr.mjs remap <doc|dir> [--commit-map <f>] [--write] [--accept-fallback]
                                                          dopo git filter-repo: verified riancorati in
                                                          modo esatto con .git/filter-repo/commit-map;
                                                          ripiego data+file solo proposto (A16)

  Directory: esclusioni di default (node_modules, .git, dist, build, cartelle nascoste,
  repo annidati, .gitignore). Doc storici (piani chiusi, status superseded/done, cartelle
  d'archivio): solo una riga informativa, nessun segnale.

FLAGS (claims, scan):
  --rev <commit>     legge doc e codice a quel commit (git show/ls-tree/grep, niente checkout)
  --code-repo <dir>  repo locale del codice, invece di quello dei doc (ripetibile; per scan,
                     i code_refs con repo: owner/nome si abbinano col remote origin)
  --code-rev <c>     commit del repo di codice (default: working tree / HEAD)
  --repos-file <f>   mappa doc → repo da un file esterno invece di mr.repos.yaml del repo dei
                     doc (nota A9: un claim conta trovato solo nei repo mappati per il suo doc).
                     Precedenza: --code-repo > --repos-file > mr.repos.yaml > solo il repo dei doc
  --external-repo <dir>  repo dove possono vivere nomi citati dai doc (ripetibile, 0.6-f): un
                     not_found trovato lì diventa external; vale anche «esterni:» in mr.repos.yaml
  --ignore-file <f>  allow-list da un file esterno invece di mr.claims.ignore del repo
  --subjects         (scan) nei commit di deriva mostra anche l'oggetto
  --remote           (scan) i link con repo: owner/nome non presenti in locale si leggono
                     da GitHub con gh api (solo GET, niente clone; R10)
  --all              nel report md mostra anche i claim found e ignored
  --format md|json|segnalazione   formato del report (default: md). segnalazione: una
                     segnalazione doc-stale per doc, nel formato di _arch, su stdout
  --workspace <slug> (segnalazione) slug del workspace; default: nome del repo

  --fail             (claims, scan) exit 1 se c'è almeno un segnale; senza, sempre 0

BERSAGLIO (impact):
  --staged | <commit> | <a>..<b> | <path di un file>
  --docs <dir>       dove cercare i doc (ripetibile; default: la root del repo del codice)
  --code-repo <dir>  repo del codice (default: quello della cartella corrente)
  --fail             exit 1 solo se è toccata almeno un'ancora o un code_ref (simbolo, o file
                     ancorato a file intero; anche cancellato o simbolo sparito). Path e nomi
                     citati dai claim e ancore «file toccato, simbolo no» non cambiano l'exit
                     code: restano nel report (per un hook che avvisa)
  --include-docs     considera anche i .md/.mdx toccati (default: solo codice; i legami
                     doc ↔ doc sono di mr-scanner)

ALLOW-LIST:
  mr.claims.ignore nella root del repo: testo, glob, tipo:pattern (es. env:VITE_*),
  doc:<glob>, storico:<glob>. Nel doc, <!-- mr:ignore-claim --> salta la riga.

  node tools/mr/mr.mjs coverage [<repo>] [--docs <dir>] [--include-journals]
                                                          punti d'ingresso (funzioni, route, migration,
                                                          CI, deploy, env) che nessun doc cita (R9)
  node tools/mr/mr.mjs stato [<repo>] [--rev <c>] [--indice <f>] [--ignore-dir <d> --workspace <slug>]
                                                          onboarding: livello del repo (0 fotografia, 1 doc
                                                          principali, 2 tutti i doc vivi, 3 nel giro), cosa
                                                          manca e il prossimo passo; sola lettura (0.6-z11)
  node tools/mr/mr.mjs env [<repo>] [--docs <dir>] [--rev <c>] [--ignore-dir <d> --workspace <slug>] [--fail]
                                                          variabili lette dal codice (process.env, Deno.env.get,
                                                          os.environ, helper di mr.coverage.yaml, \${X} dei compose)
                                                          contro gli elenchi: file d'esempio (.env*.example, se ci
                                                          sono) o doc vivi. Dice letti e non elencati, elencati e
                                                          non letti. --fail: 1 se c'è un nome non elencato (0.6-z9)
  node tools/mr/mr.mjs indice [--write] [--indice <f>] [--ignore-dir <d>] [--json]
                                                          indice dei doc dei workspace attivi (gli stessi del giro,
                                                          dal working tree): id, titolo, type, owner, status,
                                                          last_updated, percorso, prima riga, vivo/storico. Senza
                                                          cartelle di dati personali, segreti, CSV. Con --write
                                                          scrive ~/.mr/indice/INDICE_DOC.tsv (MR_INDICE_DIR) (0.6-z17)
  node tools/mr/mr.mjs trova <parole|"frase esatta"> [--owner <o>] [--type <t>] [--repo <r>] [--max <n>] [--testo] [--senza-rinnovo] [--json]
                                                          i 10 doc più pertinenti dell'indice, vivi prima degli
                                                          storici, con percorso e owner. Solo testo, nessun
                                                          modello; in prova (0.6-z17). Cerca anche nel testo dei doc
                                                          con una frase tra virgolette, con --testo, o se nessun doc
                                                          ha tutte le parole nel titolo (0.6-z23). Indice assente o
                                                          vecchio di un giorno o con doc cambiati: lo rigenera (0.6-z24, z28)

SCRITTURA:
  solo verify, suggest-links, remap e rivisto, solo con --write, solo nei doc indicati; indice, solo con
  --write, solo il suo TSV. Unica eccezione: trova rigenera l'indice (solo il TSV) se manca o ha più di
  un giorno, salvo --senza-rinnovo. Gli altri
  comandi rifiutano --write. remap applica il ripiego per data+file solo con
  --accept-fallback e un candidato unico.

Exit code (0.6-z10): MR segnala, non blocca. claims, scan, impact ed env danno 0 anche con
segnali, 1 solo con --fail (claims/scan: un not_found o un link in deriva; impact: un'ancora
toccata; env: un nome non elencato). verify e remap: 1 se restano link non verificabili o non
risolti. 2: errore del tool.
`;

export function parseArgs(argv) {
  const out = {
    cmd: null, paths: [], rev: null, format: 'md', all: false, help: false, ignoreFile: null,
    codeRepos: [], externalRepos: [], codeRev: null, subjects: false, docs: [], staged: false, fail: false, includeDocs: false,
    reposFile: null, write: false, includeJournals: false, commitMap: null, acceptFallback: false, workspace: null,
    remote: false, only: null, redazioni: null, tieniReview: false, senzaFrontmatter: false, ignoreDir: null,
    owner: null, type: null, repo: null, max: null, testo: false,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) out.cmd = args.shift();
  const need = (flag, v) => {
    if (v === undefined || v === '') out.error = `${flag} richiede un valore`;
    return v;
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--all') out.all = true;
    else if (a === '--subjects') out.subjects = true;
    else if (a === '--staged') out.staged = true;
    else if (a === '--fail') out.fail = true;
    else if (a === '--include-docs') out.includeDocs = true;
    else if (a === '--write') out.write = true;
    else if (a === '--include-journals') out.includeJournals = true;
    else if (a === '--commit-map') out.commitMap = need(a, args[++i]);
    else if (a === '--accept-fallback') out.acceptFallback = true;
    else if (a === '--workspace') out.workspace = need(a, args[++i]);
    else if (a === '--remote') out.remote = true;
    else if (a === '--data') out.data = need(a, args[++i]);
    else if (a === '--redazioni') out.redazioni = need(a, args[++i]);
    else if (a === '--tieni-review') out.tieniReview = true;
    else if (a === '--senza-frontmatter') out.senzaFrontmatter = true;
    else if (a === '--json') out.format = 'json';
    else if (a === '--ignore-dir') out.ignoreDir = need(a, args[++i]);
    else if (a === '--indice') out.indice = need(a, args[++i]);
    else if (a === '--owner') out.owner = need(a, args[++i]);
    else if (a === '--type') out.type = need(a, args[++i]);
    else if (a === '--repo') out.repo = need(a, args[++i]);
    else if (a === '--testo') out.testo = true;
    else if (a === '--senza-rinnovo') out.senzaRinnovo = true;
    else if (a === '--senza-contenitori') out.senzaContenitori = true;
    else if (a === '--max') {
      const v = need(a, args[++i]);
      if (!/^[1-9]\d{0,2}$/.test(String(v))) out.error = `--max vuole un numero da 1 a 999: ${v}`;
      else out.max = Number(v);
    }
    else if (a === '--only') {
      const v = need(a, args[++i]);
      const nums = String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (!nums.length || nums.some((x) => !/^[1-9]\d*$/.test(x))) out.error = `--only vuole numeri dell'anteprima separati da virgole (es. --only 1,4,7): ${v}`;
      else out.only = new Set(nums.map(Number));
    }
    else if (a === '--rev') out.rev = need(a, args[++i]);
    else if (a.startsWith('--rev=')) out.rev = need('--rev', a.slice(6));
    else if (a === '--format') out.format = need(a, args[++i]);
    else if (a.startsWith('--format=')) out.format = a.slice(9);
    else if (a === '--ignore-file') out.ignoreFile = need(a, args[++i]);
    else if (a === '--code-repo') out.codeRepos.push(need(a, args[++i]));
    else if (a === '--external-repo') out.externalRepos.push(need(a, args[++i]));
    else if (a === '--code-rev') out.codeRev = need(a, args[++i]);
    else if (a === '--docs') out.docs.push(need(a, args[++i]));
    else if (a === '--repos-file') out.reposFile = need(a, args[++i]);
    else if (a.startsWith('-')) out.error = `Flag sconosciuto: ${a}`;
    else out.paths.push(a);
  }
  if (!['md', 'json', 'segnalazione'].includes(out.format)) out.error = `Formato sconosciuto: ${out.format}`;
  if (out.format === 'segnalazione' && out.cmd && !['claims', 'scan'].includes(out.cmd)) out.error = '--format segnalazione vale per claims e scan';
  if (out.only && out.cmd && out.cmd !== 'suggest-links') out.error = '--only vale solo per suggest-links';
  if (out.data && out.cmd && out.cmd !== 'rivisto') out.error = '--data vale solo per rivisto';
  if (out.tieniReview && out.cmd && out.cmd !== 'rivisto') out.error = '--tieni-review vale solo per rivisto';
  if (out.redazioni && out.cmd && out.cmd !== 'date') out.error = '--redazioni vale solo per date';
  if (out.senzaFrontmatter && out.cmd && out.cmd !== 'vivi') out.error = '--senza-frontmatter vale solo per vivi';
  if (out.ignoreDir && out.cmd && !['vivi', 'env', 'stato', 'indice'].includes(out.cmd)) out.error = '--ignore-dir vale solo per vivi, env, stato e indice';
  if (out.indice && out.cmd && !['stato', 'indice'].includes(out.cmd)) out.error = '--indice vale solo per stato e indice';
  if ((out.owner || out.type || out.repo || out.max || out.testo || out.senzaRinnovo) && out.cmd && out.cmd !== 'trova') out.error = '--owner, --type, --repo, --max, --testo e --senza-rinnovo valgono solo per trova';
  if (out.ignoreDir && !out.workspace && out.cmd !== 'indice') out.error = '--ignore-dir vuole anche --workspace <slug> (il file è <dir>/<slug>.ignore, come nel giro)';
  return out;
}

/** Risolve i doc da controllare: { repo, docs, skipped } */
function resolveDocs(paths, rev) {
  let repo = null;
  const docs = new Set();
  for (const p of paths) {
    const abs = resolve(p);
    const view = RepoView.forPath(existsSync(abs) ? abs : resolve(abs, '..'), rev);
    if (!view) throw new Error(`non è dentro un repo git: ${p}`);
    if (repo && repo.root !== view.root) throw new Error(`i doc devono stare nello stesso repo (${repo.root} ≠ ${view.root})`);
    repo ??= view;
    if (rev) {
      const rel = repo.rel(abs);
      const atRev = repo.listMarkdownUnder(rel === '' ? '.' : rel);
      if (!atRev.length) throw new Error(`nessun .md in ${p} al commit ${rev}`);
      atRev.forEach((d) => docs.add(d));
    } else {
      if (!existsSync(abs)) throw new Error(`path non trovato: ${p}`);
      const files = statSync(abs).isFile() ? (abs.endsWith('.md') ? [abs] : []) : collectMarkdownArgs([abs]);
      files.forEach((f) => docs.add(repo.rel(f)));
    }
  }
  const all = [...docs].sort();
  // i doc con SECRET/SEGRETI nel nome non si leggono: si dichiarano come saltati
  return { repo, docs: all.filter((d) => !isSecretPath(d)), skipped: all.filter(isSecretPath) };
}

function resolveCodeRepos(dirs, codeRev, docRepo) {
  return dirs.map((dir) => {
    if (!dir || !existsSync(dir)) throw new Error(`--code-repo: cartella non trovata: ${dir}`);
    const view = RepoView.forPath(dir, codeRev);
    if (!view) throw new Error(`--code-repo: non è dentro un repo git: ${dir}`);
    if (docRepo && view.root === docRepo.root && !codeRev) return docRepo;
    view.resolveRev();
    return view;
  });
}

/**
 * Come si sceglie il repo del codice per ogni doc: --code-repo (uguale per tutti) >
 * --repos-file > mr.repos.yaml del repo dei doc > solo il repo dei doc.
 */
function codeResolution(opts, repo) {
  // repo esterni (0.6-f): --external-repo per tutti i doc, più `esterni` di mr.repos.yaml
  const extra = resolveCodeRepos(opts.externalRepos || [], null, null);
  const codeRepos = resolveCodeRepos(opts.codeRepos, opts.codeRev, repo);
  if (codeRepos.length) return { codeRepos, map: null, reposFor: () => codeRepos, all: codeRepos, externalFor: () => extra };
  const map = RepoMap.load(repo, opts.reposFile, opts.codeRev);
  if (map) return { codeRepos: [], map, reposFor: (d) => map.reposFor(d), all: map.allRepos(), externalFor: (d) => [...map.externalsFor(d), ...extra] };
  return { codeRepos: [], map: null, reposFor: () => [repo], all: [repo], externalFor: () => extra };
}

/** doc dentro cartelle `codice:<glob>`: appartengono alla copia esclusa, non a questo repo (0.6-m) */
function notExcluded(docs, rules) {
  const ex = codeExcludes(rules);
  return ex.length ? docs.filter((d) => !ex.some((r) => r.test(d))) : docs;
}

function loadRules(opts, repo) {
  if (opts.ignoreFile && !existsSync(opts.ignoreFile)) throw new Error(`allow-list non trovata: ${opts.ignoreFile}`);
  return opts.ignoreFile ? parseIgnore(readFileSync(opts.ignoreFile, 'utf-8')) : loadIgnore(repo);
}

function baseMeta(command, repo, revShort, res, docs, skipped, opts) {
  return {
    tool: `mr ${MR_VERSION}`,
    command,
    repo: repo.root.split('/').pop(),
    rev: revShort,
    code_repos: res.codeRepos.length ? res.codeRepos.map((r) => r.root.split('/').pop()) : undefined,
    repos_map: res.map ? { source: res.map.source, rules: res.map.rules.map((r) => `${r.docs} → ${r.names.join(', ')}`) } : undefined,
    docs: docs.length,
    skipped_docs: skipped,
    ignore_source: opts.ignoreFile ? 'file esterno' : 'mr.claims.ignore del repo',
  };
}

export function runClaims(opts) {
  const { repo, docs: allDocs, skipped } = resolveDocs(opts.paths, opts.rev);
  const revShort = repo.resolveRev();
  const ignore = loadRules(opts, repo);
  const docs = notExcluded(allDocs, ignore);
  const res = codeResolution(opts, repo);
  const records = checkDocs(repo, docs, { ignore, codeReposFor: res.reposFor, externalReposFor: res.externalFor });
  return { meta: baseMeta('claims', repo, revShort, res, docs, skipped, opts), records, res, repo };
}

/**
 * code_refs e ancore di un doc, valutati contro il codice (R3). Usata da scan e dal giro (0.6-s).
 * @param {RepoView} repo - repo dei doc (alla versione letta)
 * @param {string} d - doc
 * @param {RepoView} defaultCode - repo del codice di default del doc
 * @param {RepoView[]} allCode - tutti i repo di codice disponibili
 * @returns {{ refs: object[], errors: string[] }}
 */
export function refsOfDoc(repo, d, defaultCode, allCode, ignore = [], opts = {}) {
  const ctx = new DriftContext(defaultCode, allCode, { subjects: opts.subjects });
  const text = repo.readFile(d);
  const historical = historicalReason(d, readFrontmatter(text), ignore);
  const { refs: list, errors } = readCodeRefs(text);
  const refs = [];
  for (const ref of list) {
    let res;
    try {
      res = evaluateRef(ref, ctx);
      // R10: repo non in locale → lettura remota con gh api, solo con --remote
      if (opts.remote && ref.repo && res.status === 'unresolvable' && !ctx.repoFor(ref)) res = evaluateRemoteRef(ref, opts.remote);
    } catch (err) {
      res = { path: ref.path, status: 'unresolvable', level: 'n/a', note: `errore: ${err.message.split('\n')[0]}` };
    }
    refs.push({ doc: d, line: ref.line, section: ref.section, via: ref.source === 'anchor' ? 'ancora' : 'code_refs', ...res, ...(historical ? { historical } : {}) });
  }
  return { refs, errors };
}

export function runScan(opts) {
  const { repo, docs: allDocs, skipped } = resolveDocs(opts.paths, opts.rev);
  const revShort = repo.resolveRev();
  const ignore = loadRules(opts, repo);
  const docs = notExcluded(allDocs, ignore);
  const res = codeResolution(opts, repo);
  const records = checkDocs(repo, docs, { ignore, codeReposFor: res.reposFor, externalReposFor: res.externalFor });

  // code_refs e ancore: repo di default = il primo repo del doc (mappa o --code-repo,
  // altrimenti quello dei doc, letto allo stesso commit se c'è --rev); i link con
  // repo: owner/nome si abbinano a uno qualunque dei repo dichiarati
  const refs = [];
  const refErrors = [];
  const remote = opts.remote ? new RemoteRepos() : null;
  for (const d of docs) {
    const out = refsOfDoc(repo, d, res.reposFor(d)[0], res.all, ignore, { subjects: opts.subjects, remote });
    out.errors.forEach((e) => refErrors.push({ doc: d, error: e }));
    refs.push(...out.refs);
  }
  return { meta: { ...baseMeta('scan', repo, revShort, res, docs, skipped, opts), ref_errors: refErrors }, records, refs, res, repo };
}

export function runImpact(opts) {
  const codeRepo = opts.codeRepos[0]
    ? resolveCodeRepos([opts.codeRepos[0]], null, null)[0]
    : RepoView.forPath(process.cwd());
  if (!codeRepo) throw new Error('la cartella corrente non è in un repo git: usa --code-repo');

  const targets = [opts.staged ? 'staged' : null, ...opts.paths].filter(Boolean);
  if (targets.length !== 1) throw new Error('impact: indica un solo bersaglio (--staged, commit, a..b o path)');
  const t = opts.paths[0];
  let touched;
  let newRev = null;
  let label;
  if (opts.staged) {
    const d = targetDiff(codeRepo, { staged: true });
    touched = parseDiff(d.diff);
    newRev = d.newRev;
    label = '--staged';
  } else if (t.includes('..')) {
    const d = targetDiff(codeRepo, { range: t });
    touched = parseDiff(d.diff);
    newRev = d.newRev;
    label = t;
  } else if (existsSync(resolve(t)) && statSync(resolve(t)).isFile()) {
    const rel = codeRepo.rel(resolve(t));
    touched = new Map([[rel, { path: rel, ranges: [], tokens: new Set(), text: [], whole: true }]]);
    label = rel;
  } else {
    try {
      codeRepo.git(['rev-parse', '--verify', `${t}^{commit}`]);
    } catch {
      throw new Error(`impact: "${t}" non è un file, un commit o un intervallo`);
    }
    const d = targetDiff(codeRepo, { commit: t });
    touched = parseDiff(d.diff);
    newRev = d.newRev;
    label = t;
  }

  // package.json / package-lock.json con il solo numero di versione cambiato: non contano (0.6-u)
  let versionOnlyTouched = 0;
  for (const [p, f] of [...touched.entries()]) {
    let content = null;
    try {
      content = newRev === null ? codeRepo.readFile(p) : codeRepo.git(['show', newRev === ':' ? `:${p}` : `${newRev}:${p}`]);
    } catch {
      content = null;
    }
    if (versionOnly(f, content)) {
      touched.delete(p);
      versionOnlyTouched++;
    }
  }

  // cartelle che non sono codice del repo (codice:<glob>, 0.6-m): fuori dalla ricerca e dai file toccati
  codeRepo.excludeCode(codeExcludes(loadRules(opts, codeRepo)));
  let excludedTouched = 0;
  for (const p of [...touched.keys()]) {
    if (codeRepo.isExcludedCode(p)) {
      touched.delete(p);
      excludedTouched++;
    }
  }

  // R6 riguarda il codice: i doc toccati si escludono, salvo --include-docs
  const skippedDocsTouched = [];
  if (!opts.includeDocs) {
    for (const p of [...touched.keys()]) {
      if (/\.mdx?$/i.test(p)) {
        touched.delete(p);
        skippedDocsTouched.push(p);
      }
    }
  }

  const docDirs = opts.docs.length ? opts.docs : [codeRepo.root];
  const { repo: docRepo, docs: allDocs, skipped } = resolveDocs(docDirs, null);
  // con una mappa dei repo, solo i doc mappati sul repo del codice (nota A9)
  const map = RepoMap.load(docRepo, opts.reposFile, null);
  const mapped = map ? allDocs.filter((d) => map.reposFor(d).some((r) => r.root === codeRepo.root)) : allDocs;
  const docRules = loadRules(opts, docRepo);
  const docs = notExcluded(mapped, docRules);
  const items = findImpacted(docRepo, docs, codeRepo, touched, newRev, docRules);
  // 0.6-z33 (A): senza --docs, anche i doc dei repo che contengono quello del codice (il contenitore
  // di un submodule o di un repo annidato, poi il repo ombrello GL). Le loro voci hanno il nome del repo
  // davanti al doc. Mai sopra la home, mai in ~/IUD.
  const contenitori = [];
  if (!opts.docs.length && !opts.senzaContenitori) {
    let dir = dirname(codeRepo.root);
    const limite = codeRepo.root.startsWith(homedir() + '/') ? homedir() : '/';
    while (dir !== limite && dir !== '/') {
      const root = findRepoRoot(dir);
      if (!root || root === codeRepo.root || percorsoIUD(root)) break;
      const cRepo = new RepoView(root, null);
      const cRules = loadRules({ ...opts, ignoreFile: null }, cRepo);
      const cDocs = notExcluded(cRepo.listMarkdownUnder('.'), cRules);
      const nome = root.split('/').pop();
      const voci = findImpacted(cRepo, cDocs, codeRepo, touched, newRev, cRules).map((i) => ({ ...i, doc: `[${nome}] ${i.doc}`, repo_doc: nome }));
      items.push(...voci);
      contenitori.push({ repo: nome, docs: cDocs.length, root });
      dir = dirname(root);
    }
  }
  // 0.6-z35 (B ridotto): doc vivi dell'indice dei doc che stanno in altri repo (non quello del codice né i
  // contenitori) e nominano il repo del codice. Non rinnova l'indice: usa quello che c'è.
  let fuoriRepo = null;
  const fileIndiceDoc = join(cartellaIndice(), INDICE_FILE);
  if (!opts.docs.length && !opts.senzaContenitori && existsSync(fileIndiceDoc)) {
    const nomeRepo = codeRepo.root.split('/').pop();
    const forme = [...new Set([nomeRepo, nomeRepo.replace(/\s+/g, '-'), nomeRepo.replace(/\s+/g, '_')].map((x) => x.toLowerCase()))].filter((x) => x.length >= 4);
    const giaVisti = [codeRepo.root, ...contenitori.map((c) => c.root)];
    const perRepo = new Map();
    let letti = 0;
    for (const v of leggiIndice(fileIndiceDoc)) {
      if (v.stato !== 'vivo' || !v.percorso.endsWith('.md') || percorsoIUD(v.percorso)) continue;
      const root = findRepoRoot(dirname(v.percorso));
      if (!root || giaVisti.includes(root)) continue;
      let testo = '';
      try { testo = readFileSync(v.percorso, 'utf-8').toLowerCase(); } catch { continue; }
      letti++;
      if (!forme.some((f) => testo.includes(f))) continue;
      if (!perRepo.has(root)) perRepo.set(root, []);
      perRepo.get(root).push(relative(root, v.percorso));
    }
    let docs = 0;
    for (const [root, rels] of perRepo) {
      const fRepo = new RepoView(root, null);
      const nome = root.split('/').pop();
      docs += rels.length;
      items.push(...findImpacted(fRepo, rels, codeRepo, touched, newRev, loadRules({ ...opts, ignoreFile: null }, fRepo)).map((i) => ({ ...i, doc: `[${nome}] ${i.doc}`, repo_doc: nome, fuori_repo: true })));
    }
    fuoriRepo = { letti, docs, repo: perRepo.size };
  }
  return {
    meta: {
      tool: `mr ${MR_VERSION}`,
      command: 'impact',
      contenitori: contenitori.map(({ repo, docs }) => ({ repo, docs })),
      fuori_repo: fuoriRepo,
      target: label,
      code_repo: codeRepo.root.split('/').pop(),
      docs_repo: docRepo.root.split('/').pop(),
      touched_files: [...touched.keys()],
      touched_docs_ignored: skippedDocsTouched.length,
      touched_version_only: versionOnlyTouched,
      touched_excluded_code: excludedTouched,
      docs: docs.length,
      docs_not_mapped: allDocs.length - docs.length,
      skipped_docs: skipped,
    },
    items,
  };
}

/**
 * `mr rivisto <doc> [--write] [--data YYYY-MM-DD]` (0.6-y): il doc è stato riletto ed è ancora vero.
 * Aggiorna solo `last_updated` del frontmatter MR (alla data del giorno, o a --data). Rifiuta un doc
 * senza frontmatter MR. Senza --write mostra il cambio e non scrive. È la regola di freschezza
 * decisa il 13/10: rileggi un doc «vecchio»; se è ancora vero, rivisto --write.
 */
export function runRivisto(opts) {
  if (opts.paths.length !== 1) throw new Error('rivisto: indica un solo doc');
  const { repo, docs } = resolveDocs(opts.paths, null);
  if (docs.length !== 1) {
    // 0.6-z4: il motivo più comune è il nome (SECRET/SEGRETI): dirlo, invece di «non leggibile»
    if (isSecretPath(opts.paths[0])) throw new Error(`rivisto: ${opts.paths[0]} ha SECRET o SEGRETI nel nome, e MR non legge questi file per regola (anche se è un .md). Aggiorna last_updated a mano, o rinomina il doc se non contiene segreti`);
    throw new Error(`rivisto: doc non leggibile: ${opts.paths[0]}`);
  }
  const docRel = docs[0];
  const text = repo.readFile(docRel);
  const fm = readFrontmatter(text);
  const rotto = (!fm || !fm.id) && erroreFrontmatter(text);
  if (rotto) throw new Error(`rivisto: ${docRel}: frontmatter non leggibile (${messaggioParser(rotto)}); un valore con i due punti va tra virgolette`);
  if (!fm || !fm.id) throw new Error(`rivisto: ${docRel} non ha il frontmatter MR (usa la skill mr-tag per aggiungerlo)`);
  const data = opts.data || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error(`rivisto: --data vuole YYYY-MM-DD: ${data}`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const end = lines.indexOf('---', 1);
  const prima = fm.last_updated instanceof Date ? fm.last_updated.toISOString().slice(0, 10) : fm.last_updated ? String(fm.last_updated) : null;
  let changed = false;
  const i = lines.slice(0, end).findIndex((l) => /^last_updated\s*:/.test(l));
  if (i > 0) {
    const quote = (lines[i].match(/:\s*(['"])/) || [])[1] || '';
    const nuova = `last_updated: ${quote}${data}${quote}`;
    if (lines[i] !== nuova) { lines[i] = nuova; changed = true; }
  } else {
    // nel profilo light last_updated è obbligatorio: se manca si aggiunge in fondo al frontmatter
    lines.splice(end, 0, `last_updated: '${data}'`);
    changed = true;
  }
  // review_needed (0.6-z): «riletto ed è vero» vuol dire che le parti da aggiornare sono a posto
  const reviewPrima = fm.review_needed !== undefined && fm.review_needed !== null ? String(fm.review_needed) : null;
  let reviewTolto = false;
  if (reviewPrima !== null && !opts.tieniReview) {
    const fine = lines.indexOf('---', 1);
    const r = lines.slice(0, fine).findIndex((l) => /^review_needed\s*:/.test(l));
    if (r > 0) {
      // la riga e le sue continuazioni (valore su più righe, rientrate)
      let n = 1;
      while (r + n < fine && /^\s+\S/.test(lines[r + n])) n++;
      lines.splice(r, n);
      reviewTolto = true;
      changed = true;
    }
  }
  let written = false;
  if (opts.write && changed) {
    scriviNelRepo(repo.root, docRel, lines.join(eol));
    written = true;
  }
  return { meta: { tool: `mr ${MR_VERSION}`, command: 'rivisto', repo: repo.root.split('/').pop(), doc: docRel, id: String(fm.id), last_updated_prima: prima, last_updated: data, review_needed_prima: reviewPrima, review_tolto: reviewTolto, changed, write: !!opts.write, written } };
}

/**
 * date (0.6-z): created e last_updated da git per il frontmatter, saltando i commit di sola
 * redazione (mr.redazioni o --redazioni). Sola lettura.
 */
export function runDate(opts) {
  const { repo, docs, skipped } = resolveDocs(opts.paths, opts.rev);
  const file = opts.redazioni ? resolve(opts.redazioni) : resolve(repo.root, REDAZIONI_FILE);
  const presente = existsSync(file);
  if (opts.redazioni && !presente) throw new Error(`--redazioni: file non trovato: ${opts.redazioni}`);
  const regole = presente ? parseRedazioni(readFileSync(file, 'utf-8')) : { sha: [], messaggi: [], import: [], errori: [] };
  if (regole.errori.length) throw new Error(`${file}:\n  ${regole.errori.join('\n  ')}`);
  // 0.6-z8: uno sha che non c'è più (storia riscritta) o è ambiguo è un errore, non una regola che
  // smette in silenzio di valere
  const nonRisolti = presente ? shaNonRisolti(repo.root, readFileSync(file, 'utf-8'), relative(repo.root, file) || file) : [];
  if (nonRisolti.length) throw new Error(nonRisolti.join('\n  '));
  const fmData = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v) : null);
  // 0.6-z4: con più di qualche doc, un solo git log per il repo e i controlli a lotti
  const aLotti = docs.length > 3;
  const liste = aLotti ? commitsDiTutti(repo.root, opts.rev, docs) : null;
  const dateLotti = aLotti ? dateDiTutti(repo.root, liste, regole) : null;
  const items = docs.map((doc) => {
    const commits = aLotti ? liste.get(doc) : commitsDelFile(repo.root, opts.rev, doc);
    const text = repo.readFile(doc);
    const d = dateImport(aLotti ? dateLotti.get(doc) : dateDaCommit(commits, regole, soloFrontmatterGit(repo.root, commits)), commits, regole, text);
    const fm = readFrontmatter(text);
    return {
      doc, id: fm.id ? String(fm.id) : null, ...d,
      saltati: d.saltati.map((c) => ({ hash: c.hash.slice(0, 8), date: c.date, motivo: c.motivo })),
      fm_created: fmData(fm.created), fm_last_updated: fmData(fm.last_updated),
    };
  });
  return {
    meta: {
      tool: `mr ${MR_VERSION}`, command: 'date', repo: repo.root.split('/').pop(), rev: opts.rev || 'HEAD',
      redazioni: presente ? relative(repo.root, file) || file : null, sha: regole.sha.length, messaggi: regole.messaggi, import: regole.import,
      skipped,
    },
    items,
  };
}

/**
 * vivi (0.6-z4): i doc vivi di un repo, gli stessi che il giro conta nella «Salute dei doc», e quali
 * hanno il frontmatter MR. Regole: mr.claims.ignore del repo, più l'allow-list centrale
 * <ignore-dir>/<workspace>.ignore come nel giro. Sola lettura.
 */
export function runVivi(opts) {
  if (opts.paths.length > 1) throw new Error('vivi: indica un solo repo o cartella');
  const base = resolve(opts.paths[0] || '.');
  if (!existsSync(base) || !statSync(base).isDirectory()) throw new Error(`vivi: cartella non trovata: ${opts.paths[0] || '.'}`);
  const view = RepoView.forPath(base, opts.rev);
  if (!view) throw new Error(`non è dentro un repo git: ${base}`);
  const prefix = relative(view.root, base) || '.';
  let central = [];
  let centralFile = null;
  if (opts.ignoreDir) {
    centralFile = resolve(opts.ignoreDir, `${opts.workspace}.ignore`);
    if (existsSync(centralFile)) central = parseIgnore(readFileSync(centralFile, 'utf-8'));
    else centralFile = `${centralFile} (assente)`;
  }
  const rules = [...loadIgnore(view), ...central];
  const vivi = [];
  const nonVivi = [];
  for (const rel of view.listMarkdownUnder(prefix)) {
    const nv = nonVivo(rel, rules);
    if (nv) { nonVivi.push({ doc: rel, motivo: nv.motivo, gruppo: nv.gruppo }); continue; }
    const text = view.readFile(rel);
    const fm = readFrontmatter(text);
    const frontmatter = fm && fm.id ? 'sì' : bloccoMr(text) && erroreFrontmatter(text) ? 'non leggibile' : 'no';
    vivi.push({ doc: rel, id: fm && fm.id ? String(fm.id) : null, frontmatter });
  }
  const conta = (f) => vivi.filter((v) => v.frontmatter === f).length;
  const gruppi = {};
  for (const n of nonVivi) gruppi[n.gruppo] = (gruppi[n.gruppo] || 0) + 1;
  return {
    meta: {
      tool: `mr ${MR_VERSION}`, command: 'vivi', repo: view.root.split('/').pop(), cartella: prefix, rev: opts.rev || 'working tree',
      regole: [view.hasFile(IGNORE_FILE) ? IGNORE_FILE : null, centralFile].filter(Boolean),
      doc_md: vivi.length + nonVivi.length, vivi: vivi.length, con_frontmatter: conta('sì'), senza: conta('no'), non_leggibile: conta('non leggibile'),
      non_vivi: gruppi,
    },
    // 0.6-z6 (rilievo 4): stessa forma di `mr date --json`: una voce per doc in `items`, con `doc` e
    // `id` (null se manca). `vivi` resta per questa versione come alias deprecato di `items`.
    items: vivi,
    non_vivi: nonVivi,
  };
}

export function runVerify(opts) {
  if (opts.paths.length !== 1) throw new Error('verify: indica un solo doc (doc.md oppure doc.md#sezione)');
  if (opts.rev) throw new Error('verify lavora sul working tree del doc: --rev non è ammesso');
  const m = opts.paths[0].match(/^(.*?\.md)(?:#(.+))?$/i);
  if (!m) throw new Error('verify: serve un file .md');
  const [, docPath, section] = m;
  const { repo, docs } = resolveDocs([docPath], null);
  if (docs.length !== 1) throw new Error(`verify: doc non leggibile: ${docPath}`);
  const res = codeResolution(opts, repo);
  const docRel = docs[0];
  const text = repo.readFile(docRel);
  const ctx = new DriftContext(res.reposFor(docRel)[0], res.all, { subjects: opts.subjects });
  const plan = planVerify(text, ctx, section || null);
  let written = false;
  if (opts.write && plan.newText !== null) {
    scriviNelRepo(repo.root, docRel, plan.newText);
    written = true;
  }
  return {
    meta: { tool: `mr ${MR_VERSION}`, command: 'verify', repo: repo.root.split('/').pop(), doc: docRel, section: section || null, write: !!opts.write, written },
    plan,
    changes: plan.newText !== null ? textChanges(text, plan.newText) : [],
  };
}

/** diari di sessione esclusi da suggest-links per default (nota A15) */
export function isJournal(docRel) {
  const segs = docRel.split('/');
  return /^hof-.*\.md$/i.test(segs[segs.length - 1]) || segs.slice(0, -1).some((s) => ['handoff', 'segnalazioni', 'log'].includes(s.toLowerCase()));
}

export function runSuggest(opts) {
  const resolved = resolveDocs(opts.paths, null);
  const { repo, skipped } = resolved;
  const journals = opts.includeJournals ? [] : resolved.docs.filter(isJournal);
  const ignore = loadRules(opts, repo);
  const docs = notExcluded(resolved.docs.filter((d) => !journals.includes(d)), ignore);
  const res = codeResolution(opts, repo);
  const records = checkDocs(repo, docs, { ignore, codeReposFor: res.reposFor, externalReposFor: res.externalFor });
  const byName = new Map(res.all.map((r) => [r.root.split('/').pop(), r]));
  const out = [];
  // numeri dell'anteprima (0.6-t): progressivi su tutta l'esecuzione, nello stesso ordine di sempre,
  // così --only <n,…> sceglie le proposte viste nell'anteprima
  let n = 0;
  const seen = new Set();
  for (const d of docs) {
    const text = repo.readFile(d);
    const recs = records.filter((r) => r.doc === d);
    if (recs.some((r) => r.historical)) {
      out.push({ doc: d, historical: recs.find((r) => r.historical).historical, proposals: [] });
      continue;
    }
    const codeRepo = res.reposFor(d)[0];
    // niente ancore verso cartelle che non sono codice (codice:<glob>, 0.6-m), anche se citate per intero
    const all = proposeLinks(text, recs, (name) => byName.get(name) || null, codeRepo, d)
      .filter((p) => !(p.repo ? false : codeRepo.isExcludedCode(p.path)))
      .map((p) => ({ n: ++n, ...p }));
    all.forEach((p) => seen.add(p.n));
    const proposals = opts.only ? all.filter((p) => opts.only.has(p.n)) : all;
    if (!proposals.length) continue;
    const newText = insertAnchors(text, proposals);
    out.push({ doc: d, proposals, changes: textChanges(text, newText), written: false, newText });
  }
  // un numero di --only che non esiste: errore prima di scrivere qualunque doc
  const missing = opts.only ? [...opts.only].filter((x) => !seen.has(x)) : [];
  if (missing.length) throw new Error(`--only: numeri non presenti nell'anteprima (1-${n}): ${missing.join(', ')}`);
  for (const o of out) {
    if (opts.write && o.newText !== undefined) {
      scriviNelRepo(repo.root, o.doc, o.newText);
      o.written = true;
    }
    delete o.newText;
  }
  return { meta: { tool: `mr ${MR_VERSION}`, command: 'suggest-links', repo: repo.root.split('/').pop(), docs: docs.length, journals_excluded: journals.length, skipped_docs: skipped, write: !!opts.write, only: opts.only ? [...opts.only].sort((a, b) => a - b) : null, proposals_total: n }, docs: out };
}

export function runRemap(opts) {
  if (opts.acceptFallback && !opts.write) throw new Error('--accept-fallback ha senso solo con --write');
  let commitMap = null;
  if (opts.commitMap) {
    if (!existsSync(opts.commitMap)) throw new Error(`commit-map non trovata: ${opts.commitMap}`);
    commitMap = parseCommitMap(readFileSync(opts.commitMap, 'utf-8'));
    if (!commitMap.size) throw new Error(`commit-map senza righe valide: ${opts.commitMap}`);
  }
  const { repo, docs, skipped } = resolveDocs(opts.paths, null);
  const res = codeResolution(opts, repo);
  const out = [];
  for (const d of docs) {
    const text = repo.readFile(d);
    const ctx = new DriftContext(res.reposFor(d)[0], res.all);
    const items = planRemap(text, ctx, commitMap);
    if (!items.length) continue;
    const apply = items.filter((i) => i.outcome === 'esatto' || (opts.acceptFallback && i.outcome === 'ripiego' && i.newCommit));
    const newText = apply.length ? applyUpdates(text, apply.map((i) => ({ ref: i.ref, newCommit: i.newCommit, newDate: i.newDate }))) : null;
    let written = false;
    if (opts.write && newText !== null) {
      scriviNelRepo(repo.root, d, newText);
      written = true;
    }
    out.push({ doc: d, items, changes: newText !== null ? textChanges(text, newText) : [], written });
  }
  return { meta: { tool: `mr ${MR_VERSION}`, command: 'remap', repo: repo.root.split('/').pop(), commit_map: opts.commitMap ? `${commitMap.size} commit` : null, docs: docs.length, skipped_docs: skipped, write: !!opts.write, accept_fallback: !!opts.acceptFallback }, docs: out };
}

function remapToMarkdown(meta, docs) {
  const L = [`# Remap — ${meta.repo}`, '', `commit-map: ${meta.commit_map || 'nessuna (solo ripiego per data + file)'} · ${meta.write ? 'scrittura attiva' : 'anteprima: nulla è stato scritto'}`, ''];
  if (!docs.length) L.push('Nessun link con verified.', '');
  const icon = { presente: '✅', esatto: '🔁', eliminato: '⛔', ambiguo: '⚠️', ripiego: '❓', non_trovato: '❌' };
  for (const d of docs) {
    L.push(`## ${d.doc}`, '', '| Riga | Link | verified | Esito | Nuovo | Nota |', '|---|---|---|---|---|---|');
    for (const i of d.items) {
      const cand = i.candidates?.length > 1 ? ` — candidati: ${i.candidates.map((c) => `${c.hash} ${c.date} ${c.subject}`).join('; ')}` : '';
      L.push(`| ${i.ref.line} | \`${i.ref.path}${i.ref.symbol ? '#' + i.ref.symbol : ''}\` | ${i.old} | ${icon[i.outcome]} ${i.outcome} | ${i.newCommit || ''} | ${(i.note || '') + cand} |`);
    }
    L.push('');
    if (d.changes.length) L.push(d.written ? 'Scritto:' : 'Modifiche (anteprima):', '', '```diff', ...d.changes, '```', '');
  }
  return L.join('\n');
}

export function runCoverage(opts) {
  const target = opts.paths[0] || process.cwd();
  if (opts.paths.length > 1) throw new Error('coverage: indica un solo repo');
  if (!existsSync(target)) throw new Error(`coverage: cartella non trovata: ${target}`);
  const codeRepo = RepoView.forPath(target);
  if (!codeRepo) throw new Error(`coverage: non è dentro un repo git: ${target}`);
  const docDirs = opts.docs.length ? opts.docs : [codeRepo.root];
  const { repo: docRepo, docs: all, skipped } = resolveDocs(docDirs, null);
  const rules = loadRules(opts, docRepo);
  const docs = notExcluded(opts.includeJournals ? all : all.filter((d) => !isJournal(d)), rules);
  // codice:<glob> del repo dei doc e, se diverso, del repo del codice (0.6-m)
  codeRepo.excludeCode(codeExcludes(rules));
  if (codeRepo.root !== docRepo.root && !opts.ignoreFile) codeRepo.excludeCode(codeExcludes(loadIgnore(codeRepo)));
  const c = coverage(codeRepo, docRepo, docs, rules);
  return { meta: { tool: `mr ${MR_VERSION}`, command: 'coverage', code_repo: codeRepo.root.split('/').pop(), docs_repo: docRepo.root.split('/').pop(), docs: docs.length, docs_used: c.docs_used, journals_excluded: all.length - docs.length, skipped_docs: skipped, exclude: c.exclude }, entries: c.entries };
}

/**
 * env (0.6-z9): variabili lette dal codice contro gli elenchi (file d'esempio o doc vivi). Sola
 * lettura; regole env: di mr.claims.ignore e dell'allow-list centrale (--ignore-dir) come eccezioni.
 */
export function runEnv(opts) {
  if (opts.paths.length > 1) throw new Error('env: indica un solo repo');
  const base = resolve(opts.paths[0] || '.');
  if (!existsSync(base) || !statSync(base).isDirectory()) throw new Error(`env: cartella non trovata: ${opts.paths[0] || '.'}`);
  const view = RepoView.forPath(base, opts.rev);
  if (!view) throw new Error(`env: non è dentro un repo git: ${base}`);
  let central = [];
  if (opts.ignoreDir) {
    const f = resolve(opts.ignoreDir, `${opts.workspace}.ignore`);
    if (existsSync(f)) central = parseIgnore(readFileSync(f, 'utf-8'));
  }
  const extra = opts.ignoreFile ? parseIgnore(readFileSync(opts.ignoreFile, 'utf-8')) : [];
  const rules = [...loadIgnore(view), ...central, ...extra];
  view.excludeCode(codeExcludes(rules));
  const cfg = loadEnvConfig(view);
  const testi = [];
  // una cartella del repo (un workspace dentro GL): codice, esempi e doc solo lì sotto
  const prefix = relative(view.root, base) || '.';
  const docViews = [{ v: view, prefix }, ...opts.docs.map((d) => {
    const v = RepoView.forPath(resolve(d), opts.rev && resolve(d).startsWith(view.root) ? opts.rev : null);
    if (!v) throw new Error(`env: --docs non è dentro un repo git: ${d}`);
    return { v, prefix: relative(v.root, resolve(d)) || '.' };
  })];
  let nDoc = 0;
  for (const { v, prefix } of docViews) {
    const r = v === view ? rules : [...loadIgnore(v), ...central];
    const vivi = v.listMarkdownUnder(prefix).filter((rel) => !nonVivo(rel, r));
    nDoc += vivi.length;
    testi.push(...v.readFiles(vivi).values());
  }
  const c = confrontoEnv(nomiLetti(view, cfg.helpers, prefix), nomiEsempi(view, prefix), nomiNeiDoc(testi), { ignore: cfg.ignore, rules, esterni: envFileEsterni(view, prefix) });
  return { tool: `mr ${MR_VERSION}`, command: 'env', repo: view.root.split('/').pop(), cartella: prefix, rev: opts.rev || 'working tree', doc_vivi: nDoc, helpers: cfg.helpers, ...c };
}

/**
 * stato (0.6-z11, M3): l'onboarding da riga di comando. Livello del repo, cosa manca, prossimo passo.
 * Sola lettura: vivi, env, mr-validate (processo a parte, solo sul working tree), CLAUDE.md/AGENTS.md
 * dalla cartella in su (come li legge Claude Code), indice di arch se c'è.
 */
export function runStato(opts) {
  if (opts.paths.length > 1) throw new Error('stato: indica un solo repo o cartella');
  const base = resolve(opts.paths[0] || '.');
  const indice = opts.indice || defaultIndice();
  const ws = existsSync(indice) ? parseIndice(readFileSync(indice, 'utf-8')) : null;
  const giro = ws ? nelGiro(base, ws) : null;
  // nel giro: stesse regole del giro (allow-list centrale del workspace accanto all'indice), così i
  // numeri coincidono con la «Salute dei doc»
  const w = giro ? ws.filter((x) => x.attivo && (base === x.path || base.startsWith(x.path.replace(/\/+$/, '') + '/'))).sort((a, b) => b.path.length - a.path.length)[0] : null;
  if (w && !opts.ignoreDir) {
    const dir = resolve(dirname(indice), '../tool/mr-ignore');
    if (existsSync(dir)) opts = { ...opts, ignoreDir: dir, workspace: w.slug };
  }
  const vivi = runVivi({ ...opts, paths: [base] });
  const prefix = vivi.meta.cartella;
  const dentro = (doc) => (prefix === '.' ? doc : doc.slice(prefix.length + 1));
  const principali = vivi.items.filter((v) => /^(README|CLAUDE|AGENTS)\.md$/i.test(dentro(v.doc))).map((v) => ({ doc: v.doc, frontmatter: v.frontmatter === 'sì' }));
  // validatore: solo sul working tree (non legge un commit)
  let validate = null;
  if (!opts.rev) {
    const r = spawnSync(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '../mr-validate/mr-validate.mjs'), '--profile', 'light', base], { encoding: 'utf-8' });
    const m = (r.stdout || '').match(/\|\s*(\d+) errori\s*\|\s*(\d+) warning/);
    validate = m ? { errori: Number(m[1]), warning: Number(m[2]) } : { errori: 0, warning: 0, nota: 'nessun doc con frontmatter' };
  }
  // la regola «MR segnala, non blocca»: CLAUDE.md o AGENTS.md dalla cartella in su, fino alla home
  let regola = null;
  const stop = homedir();
  for (let d = base; ; d = dirname(d)) {
    for (const f of ['CLAUDE.md', 'AGENTS.md', 'CLAUDE.local.md']) {
      const p = join(d, f);
      try { if (existsSync(p) && haRegola(readFileSync(p, 'utf-8'))) regola ??= p; } catch { /* illeggibile */ }
    }
    if (regola || d === stop || d === dirname(d)) break;
  }
  const env = runEnv({ ...opts, paths: [base], docs: [] });
  const l = livello({ vivi: vivi.meta.vivi, conFrontmatter: vivi.meta.con_frontmatter, principali, erroriValidate: validate ? validate.errori : null, regola, giro });
  return {
    tool: `mr ${MR_VERSION}`, command: 'stato', repo: vivi.meta.repo, cartella: prefix, rev: opts.rev || 'working tree',
    ...l,
    vivi: vivi.meta.vivi, con_frontmatter: vivi.meta.con_frontmatter, principali, validate, regola,
    allow_list: vivi.meta.regole,
    env: { elenco: env.elenco, letti: env.letti, non_elencati: env.non_elencati.length, non_letti: env.non_letti.length },
    giro, indice: ws ? indice : null, workspace: w ? w.slug : opts.workspace || null,
  };
}

function statoToMarkdown(r) {
  const nomi = ['fotografia', 'doc principali', 'tutti i doc vivi', 'nel giro'];
  const L = [`# Stato MR — ${r.repo}${r.cartella !== '.' ? `/${r.cartella}` : ''} (${r.rev})`, '', NON_BLOCCA, ''];
  // 0.6-z12: il livello è il più alto con tutti i criteri soddisfatti; «nel giro» non lo alza da solo
  L.push(`**Livello ${r.livello} — ${nomi[r.livello]}**${r.verso !== null ? `, verso il livello ${r.verso}` : ''}${r.giro && r.livello < 3 ? ' (il workspace è già nel giro di arch, ma il livello 3 chiede prima i livelli 1 e 2)' : ''}`, '');
  L.push(`**Prossimo passo:** ${r.prossimo}`, '');
  if (r.mancano.length) L.push('Manca:', '', ...r.mancano.map((m) => `- ${m}`), '');
  const q = r.vivi ? Math.round((r.con_frontmatter / r.vivi) * 100) : 0;
  L.push('| voce | stato |', '|---|---|');
  L.push(`| doc vivi con frontmatter | ${r.con_frontmatter} su ${r.vivi} (${q}%; livello 2 da ${Math.round(SOGLIA_VIVI * 100)}%) |`);
  L.push(`| doc principali | ${r.principali.length ? r.principali.map((p) => `\`${p.doc}\` ${p.frontmatter ? '✅' : '—'}`).join(', ') : 'nessun README, CLAUDE.md o AGENTS.md'} |`);
  L.push(`| mr-validate --profile light | ${r.validate ? `${r.validate.errori} errori, ${r.validate.warning} warning${r.validate.nota ? ` (${r.validate.nota})` : ''}` : 'non calcolato con --rev (legge solo il working tree)'} |`);
  L.push(`| regola «MR segnala, non blocca» | ${r.regola ? `\`${r.regola}\`` : 'non trovata nei CLAUDE.md/AGENTS.md dalla cartella in su'} |`);
  L.push(`| variabili d'ambiente (mr env) | ${r.env.letti} lette · ${r.env.non_elencati} non elencate · ${r.env.non_letti} elencate e non lette (elenco: ${r.env.elenco === 'doc' ? 'doc vivi' : 'file d\'esempio'}) |`);
  L.push(`| allow-list | ${r.allow_list.length ? r.allow_list.map((x) => `\`${x}\``).join(', ') : 'nessuna'} |`);
  L.push(`| giro di arch | ${r.giro === null ? 'indice non trovato (fuori dal Mac di arch)' : r.giro ? 'sì' : 'no'} |`, '');
  L.push('I criteri di tempo (due settimane a 0 errori, un proprietario che risponde) non si misurano qui. Le variabili e le segnalazioni si guardano dopo la task in corso. Procedura: `report/onboarding/proposta.md` nel repo MR.');
  return L.join('\n');
}

function envToMarkdown(r) {
  const dove = (refs) => refs.slice(0, 3).map((x) => `\`${x.path}:${x.line}\``).join(', ') + (refs.length > 3 ? ` (+${refs.length - 3})` : '');
  const L = [`# Variabili d'ambiente — ${r.repo}${r.cartella !== '.' ? `/${r.cartella}` : ''} (${r.rev})`, '', NON_BLOCCA, ''];
  L.push(r.elenco === 'doc'
    ? `Elenco: i doc vivi (${r.doc_vivi}); nessun file d'esempio nel repo.`
    : `Elenco: i file d'esempio (${r.esempi.map((f) => `\`${f}\``).join(', ')}), ${r.elencati} nomi. I doc vivi (${r.doc_vivi}) danno solo la nota «citato in un doc».${r.esempi_di_immagini.length ? ` Letti da un'immagine esterna (env_file nel compose, verso «non letti» non controllato): ${r.esempi_di_immagini.map((f) => `\`${f}\``).join(', ')}.` : ''}`);
  L.push(`Nomi letti dal codice: ${r.letti}${r.helpers.length ? ` (helper: ${r.helpers.join(', ')})` : ''} · ignorati: ${r.ignorati.length} · letti e non elencati: ${r.non_elencati.length} · elencati e non letti: ${r.non_letti.length}.`, '');
  if (r.non_elencati.length) {
    L.push('## Letti e non elencati', '', '| nome | dove lo legge il codice | nota |', '|---|---|---|');
    for (const x of r.non_elencati) L.push(`| \`${x.nome}\` | ${dove(x.refs)} | ${x.nota || ''} |`);
    L.push('');
  }
  if (r.non_letti.length) {
    L.push('## Elencati e non letti', '', 'Nel file d\'esempio, ma né il codice né i compose li leggono: tolti, o letti in un modo che MR non vede (altro repo, script di shell).', '', '| nome | dove |', '|---|---|');
    for (const x of r.non_letti) L.push(`| \`${x.nome}\` | ${dove(x.refs)} |`);
    L.push('');
  }
  if (!r.non_elencati.length && !r.non_letti.length) L.push('Elenco e codice combaciano.', '');
  L.push('Eccezioni: `env_ignore` ed `env_helpers` in mr.coverage.yaml, regole `env:` in mr.claims.ignore. Solo nomi, mai valori.');
  return L.join('\n');
}

function coverageToMarkdown(meta, entries) {
  const kinds = ['function', 'route', 'migration', 'ci', 'deploy', 'env'];
  const label = { function: 'Funzioni / handler', route: 'Route', migration: 'Migration', ci: 'CI e cron', deploy: 'Deploy', env: 'Variabili (.env.example)' };
  const L = [`# Copertura — ${meta.code_repo}`, '', NON_BLOCCA, '', `Doc considerati: ${meta.docs_used} (${meta.docs_repo}; storici e diari esclusi${meta.journals_excluded ? `, ${meta.journals_excluded} diari` : ''})${meta.exclude.length ? ` · esclusi da mr.coverage.yaml: ${meta.exclude.join(', ')}` : ''}`, ''];
  L.push('| Tipo | Punti d\'ingresso | Citati | Non citati |', '|---|---|---|---|');
  for (const k of kinds) {
    const es = entries.filter((e) => e.kind === k);
    if (es.length) L.push(`| ${label[k]} | ${es.length} | ${es.filter((e) => e.covered).length} | ${es.filter((e) => !e.covered).length} |`);
  }
  L.push('');
  for (const k of kinds) {
    const miss = entries.filter((e) => e.kind === k && !e.covered);
    if (!miss.length) continue;
    L.push(`## ${label[k]} non citati`, '');
    for (const e of miss) L.push(`- \`${e.name}\` — \`${e.path}${e.line ? ':' + e.line : ''}\``);
    L.push('');
  }
  L.push('Non tutto va documentato: l\'elenco serve a scegliere cosa merita una riga.');
  return L.join('\n');
}

function dateToMarkdown({ meta, items }) {
  const L = [`# Date da git — ${meta.repo} (${items.length} doc, ${meta.rev})`, ''];
  L.push(meta.redazioni
    ? `Commit di sola redazione da \`${meta.redazioni}\`: ${meta.sha} sha${meta.messaggi.length ? `, messaggi: ${meta.messaggi.map((m) => `«${m}»`).join(', ')}` : ''}. Non contano per last_updated; il commit che crea il file conta sempre.`
    : 'Nessun `mr.redazioni`: nessun commit di redazione da saltare.', '');
  if (meta.import.length) L.push(`Commit d'importazione (\`import:\`): ${meta.import.join(', ')}. Per i doc nati lì le date vengono dal testo («Data:», «Last updated:»…, colonna fonte); senza data nel testo restano sconosciute e il frontmatter non si segna «diverso».`, '');
  L.push('Si saltano anche i commit che lasciano il testo invariato: solo frontmatter (il tag stesso, `mr rivisto`, uno status) o solo spostamento del file. last_updated è l\'ultimo commit che cambia il testo.', '');
  L.push('Sola lettura: le date vanno nel frontmatter con la skill mr-tag (doc nuovi) o a mano nello stesso commit (doc già taggati).', '');
  const diversa = (x) => x.fm_last_updated !== null && x.last_updated !== null && x.fm_last_updated !== x.last_updated;
  const spostati = items.filter((x) => x.saltati.length).length;
  const red = items.filter((x) => x.saltati.some((c) => c.motivo === 'redazione')).length;
  const imp = items.filter((x) => x.import);
  L.push(`Doc con commit saltati: ${spostati} (di redazione: ${red}) · frontmatter con last_updated diverso: ${items.filter(diversa).length}${meta.import.length ? ` · nati in un import: ${imp.length} (date dal testo: ${imp.filter((x) => x.created).length}, sconosciute: ${imp.filter((x) => !x.created).length})` : ''}.`, '');
  L.push('| doc | id | created | git log -1 | last_updated | fonte | nel frontmatter | commit saltati |', '|---|---|---|---|---|---|---|---|');
  for (const x of items) {
    const nelFm = x.fm_last_updated === null ? '—' : `${x.fm_last_updated}${diversa(x) ? ' ⚠ diverso' : ''}`;
    const salt = x.saltati.length ? x.saltati.map((c) => `${c.hash} ${c.date} ${c.motivo}`).join(', ') + (x.tutti_saltati ? ' (tutti: = created)' : '') : '';
    const ignota = x.import ? '? (sconosciuta)' : '— (mai committato)';
    L.push(`| ${x.doc} | ${x.id ?? '—'} | ${x.created ?? (x.import ? '? (sconosciuta)' : '—')} | ${x.ultimo ?? '—'} | ${x.last_updated ?? ignota} | ${x.fonte}${x.import ? ` (import ${x.import})` : ''} | ${nelFm} | ${salt} |`);
  }
  const ignote = items.filter((x) => x.import && !x.created);
  if (ignote.length) L.push('', `Date sconosciute (${ignote.length}): doc nati nell'import senza una data nel testo. La data la sceglie chi tagga, leggendo il doc: per esempio quella del README della stessa cartella, o del primo doc che lo cita. Scrivila nel frontmatter e dichiarala nel report del lotto, con il motivo.`);
  if (meta.skipped.length) L.push('', `Non letti (SECRET/SEGRETI nel nome): ${meta.skipped.length}. MR non legge questi file per regola: le date vanno messe a mano.`);
  return L.join('\n');
}

function viviToMarkdown({ meta, items: vivi, non_vivi }, soloSenza) {
  const L = [`# Doc vivi — ${meta.repo}${meta.cartella !== '.' ? ` (${meta.cartella})` : ''}`, ''];
  L.push(`Gli stessi doc che il giro conta nella «Salute dei doc». Regole lette: ${meta.regole.length ? meta.regole.map((r) => `\`${r}\``).join(' + ') : 'nessuna'}. Versione: ${meta.rev}.`, '');
  const g = meta.non_vivi;
  L.push(`Doc .md: ${meta.doc_md} · **vivi: ${meta.vivi}** · con frontmatter MR: ${meta.con_frontmatter} · senza: ${meta.senza}${meta.non_leggibile ? ` · frontmatter non leggibile: ${meta.non_leggibile}` : ''}`);
  L.push(`Non vivi: ${non_vivi.length} (storici per path ${g.storico || 0}, regole doc:/storico: ${g.regola || 0}, codice: ${g.codice || 0}, segreti ${g.segreti || 0}).`, '');
  const rotti = vivi.filter((v) => v.frontmatter === 'non leggibile');
  if (rotti.length) L.push(`## Frontmatter non leggibile (${rotti.length})`, '', ...rotti.map((v) => `- ${v.doc}`), '');
  const senza = vivi.filter((v) => v.frontmatter === 'no');
  L.push(`## Senza frontmatter (${senza.length})`, '', ...(senza.length ? senza.map((v) => `- ${v.doc}`) : ['nessuno']), '');
  if (!soloSenza) {
    const con = vivi.filter((v) => v.frontmatter === 'sì');
    L.push(`## Con frontmatter (${con.length})`, '', ...(con.length ? con.map((v) => `- ${v.doc} (\`${v.id}\`)`) : ['nessuno']), '');
  }
  return L.join('\n');
}

function verifyToMarkdown(meta, plan, changes) {
  const L = [`# Verify — ${meta.doc}${meta.section ? '#' + meta.section : ''}`, ''];
  if (!plan.items.length) L.push('Nessun link in questo doc (o in questa sezione).', '');
  for (const it of plan.items) {
    const r = it.res;
    L.push(`## ${it.ref.source === 'anchor' ? 'ancora' : 'code_refs'} riga ${it.ref.line}: \`${it.ref.path}${it.ref.symbol ? '#' + it.ref.symbol : ''}\``, '');
    L.push(`- esito: **${r.status}** (livello ${r.level})${r.moved_to ? ` → \`${r.moved_to}\`` : ''}${r.note ? ` — ${r.note}` : ''}`);
    L.push(`- verified: ${it.ref.verified?.commit || '—'}${it.newCommit ? ` → **${it.newCommit}**${it.unchanged ? ' (già aggiornato)' : ''}` : ''}`);
    if (it.blocked) L.push(`- ⛔ non verificabile: ${it.blocked}`);
    if (r.commits?.length) L.push(`- commit dopo verified: ${r.commits.map((c) => `${c.hash} ${c.date}${c.subject ? ' ' + c.subject : ''}`).join(', ')}`);
    if (r.diff?.length) L.push('', '```diff', ...r.diff, '```');
    if (it.code?.length) L.push('', 'Codice attuale:', '', '```', ...it.code, '```');
    L.push('');
  }
  if (changes.length) {
    L.push(meta.written ? '## Scritto nel doc' : '## Modifiche al doc (anteprima: rilancia con --write per applicarle)', '', '```diff', ...changes, '```', '');
  } else {
    L.push('Nessuna modifica al doc.', '');
  }
  return L.join('\n');
}

function suggestToMarkdown(meta, docs) {
  const L = [`# Suggest-links — ${meta.repo}`, '', meta.write ? 'Ancore scritte nei doc.' : 'Anteprima: nulla è stato scritto. Rilancia con --write per inserire le ancore, o con --write --only <n,…> per le sole proposte scelte.', ''];
  if (meta.only) L.push(`Solo le proposte ${meta.only.join(', ')} su ${meta.proposals_total} (--only).`, '');
  if (meta.journals_excluded) L.push(`Diari esclusi (hof-*.md, handoff/, segnalazioni/, log/): ${meta.journals_excluded} — --include-journals per includerli.`, '');
  const live = docs.filter((d) => d.proposals.length);
  if (!live.length) L.push('Nessun link da proporre.', '');
  for (const d of live) {
    L.push(`## ${d.doc}`, '', '| # | Sezione | Link proposto | Livello | Perché | Da |', '|---|---|---|---|---|---|');
    for (const p of d.proposals) {
      const lvl = p.level === 'file' ? '⚠️ file intero' : p.level === 'file-funzione' ? 'file = funzione' : 'funzione';
      L.push(`| ${p.n} | ${p.section || '(inizio)'} | \`${p.path}${p.symbol ? '#' + p.symbol : ''}\`${p.repo ? ` (${p.repo})` : ''} | ${lvl} | ${p.reason} | ${p.from} |`);
    }
    L.push('', '```diff', ...d.changes, '```', '');
  }
  const hist = docs.filter((d) => d.historical);
  if (hist.length) L.push(`Doc storici saltati: ${hist.map((d) => `\`${d.doc}\``).join(', ')}`, '');
  return L.join('\n');
}

/**
 * Segnali di scan per l'exit code (0.6-p): in un doc con link (code_refs o ancore) contano solo
 * i link in drift/moved/missing; i claim non trovati restano nel report ma non cambiano l'exit
 * code. In un doc senza link valgono i claim, come in `mr claims`. Doc storici esclusi (A7).
 */
function scanSignals(records, refs) {
  const withLinks = new Set(refs.map((r) => r.doc));
  const bad = refs.filter((r) => !r.historical && ['drift', 'moved', 'missing'].includes(r.status)).length;
  const claims = records.filter((r) => !r.historical && r.status === 'not_found' && !withLinks.has(r.doc)).length;
  return bad + claims;
}

/**
 * indice (0.6-z17): indice dei doc dei workspace attivi (gli stessi del giro), dal working tree.
 * Senza --write dice solo cosa scriverebbe; con --write scrive ~/.mr/indice/INDICE_DOC.tsv
 * (MR_INDICE_DIR per un'altra cartella). Allow-list centrale: --ignore-dir, altrimenti
 * `_arch/tool/mr-ignore` accanto all'indice di arch, se c'è.
 */
export function runIndice(opts) {
  if (opts.paths.length) throw new Error('indice: niente argomenti (legge i workspace dall\'indice di arch; --indice <f> per un altro)');
  const fileIndice = resolve(opts.indice || defaultIndice());
  if (!existsSync(fileIndice)) throw new Error(`indice dei workspace non trovato: ${fileIndice} (--indice <f>)`);
  const ignoreDefault = resolve(dirname(fileIndice), '../tool/mr-ignore');
  const ignoreDir = opts.ignoreDir ? resolve(opts.ignoreDir) : existsSync(ignoreDefault) ? ignoreDefault : null;
  const t0 = Date.now();
  const r = costruisciIndice(parseIndice(readFileSync(fileIndice, 'utf-8')), { ignoreDir, workspaceRepos });
  const file = opts.write ? scriviIndice(r.voci) : join(cartellaIndice(), INDICE_FILE);
  return {
    voci: r.voci,
    meta: {
      tool: `mr ${MR_VERSION}`, command: 'indice', indice_workspace: fileIndice, allow_list: ignoreDir, file, scritto: Boolean(opts.write),
      workspace: r.workspace, doc: r.voci.length, vivi: r.voci.filter((v) => v.stato === 'vivo').length,
      con_frontmatter: r.voci.filter((v) => v.id).length, esclusi: r.esclusi, note: r.note, ms: Date.now() - t0,
    },
  };
}

function indiceToMarkdown(m) {
  const L = [`# Indice dei doc — ${m.doc} doc in ${m.workspace} workspace`, ''];
  L.push(`Vivi: ${m.vivi} · storici: ${m.doc - m.vivi} · con frontmatter MR: ${m.con_frontmatter} · ${m.ms} ms`);
  const ex = Object.entries(m.esclusi).map(([k, n]) => `${k} ${n}`).join(', ');
  L.push(`Esclusi: ${ex || 'nessuno'} (solo .md, e i .tsv nominati da una regola registro:; mai CSV o export).`);
  L.push(`Allow-list centrale: ${m.allow_list ? `\`${m.allow_list}\`` : 'nessuna'}.`);
  if (m.note.length) L.push('', 'Note:', ...m.note.map((n) => `- ${n}`));
  L.push('', m.scritto ? `Scritto: \`${m.file}\`. Cerca con \`mr trova <parole>\`.` : `Anteprima: nulla è stato scritto. Con --write scrive \`${m.file}\`.`);
  return L.join('\n');
}

/**
 * 0.6-z28 (F4): un doc dell'indice modificato dopo l'indice, o una sua cartella con file nuovi (la mtime
 * della cartella cambia quando ci entra un file), o null. Solo stat, nessuna lettura. Al più un rinnovo
 * ogni 10 minuti: una cartella che cambia spesso non fa rigenerare a ogni ricerca.
 */
function cambiatiDopo(file) {
  const t = statSync(file).mtime.getTime();
  if (Date.now() - t < 600000) return null;
  const cartelle = new Set();
  for (const v of leggiIndice(file)) {
    try {
      if (statSync(v.percorso).mtime.getTime() > t) return 'un doc è cambiato dopo l\'indice';
    } catch {
      return 'un doc dell\'indice non c\'è più';
    }
    cartelle.add(dirname(v.percorso));
  }
  for (const d of cartelle) {
    try {
      if (statSync(d).mtime.getTime() > t) return 'una cartella dei doc ha file nuovi';
    } catch { /* cartella sparita: la prossima regola la vede */ }
  }
  return null;
}

/** data e ora locali (0.6-z28): «indice del» non più in UTC */
const oraLocale = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** trova (0.6-z17, in prova): i doc più pertinenti dall'indice, solo testo */
export function runTrova(opts) {
  const q = opts.paths.join(' ').trim();
  if (!q && !opts.owner && !opts.type && !opts.repo) throw new Error('trova: indica almeno una parola (o --owner, --type, --repo)');
  const file = join(cartellaIndice(), INDICE_FILE);
  // 0.6-z24 (sì di il maintainer, 22/10): eccezione a «scrive solo con --write». Indice assente o più vecchio
  // di un giorno → lo rigenera come `mr indice --write`, solo nel suo TSV. --senza-rinnovo lo evita.
  let rinnovo = null;
  const motivo = !existsSync(file) ? 'mancava' : Date.now() - statSync(file).mtime.getTime() > 86400000 ? 'aveva più di un giorno' : cambiatiDopo(file);
  if (motivo && !opts.senzaRinnovo && existsSync(resolve(defaultIndice()))) {
    try {
      const m = runIndice({ paths: [], write: true }).meta;
      rinnovo = { motivo, doc: m.doc, ms: m.ms };
    } catch (err) {
      rinnovo = { errore: err.message };
    }
  }
  if (!existsSync(file)) throw new Error(`indice non trovato: ${file}. Generalo con \`mr indice --write\` (lo scrive anche il giro).${rinnovo?.errore ? ` Rinnovo automatico fallito: ${rinnovo.errore}` : ''}`);
  const voci = leggiIndice(file);
  const r = trova(voci, q, { owner: opts.owner, type: opts.type, repo: opts.repo, max: opts.max ?? 10 });
  // 0.6-z23: ricerca nel testo dei doc. Un argomento con spazi (tra virgolette nella shell) è una frase
  // esatta. 0.6-z26 (F2): il testo si cerca sempre, anche con risultati per titolo, che possono essere
  // fuori tema; completi = doc con tutte le parole intere (non un prefisso). Una frase che non c'è in
  // nessun doc si ricerca come parole in qualunque ordine.
  let frasi = opts.paths.filter((a) => /\s/.test(a.trim()));
  const completi = r.risultati.filter((v) => v.parole_intere === r.parole.length).length;
  let testo = null;
  if (q) {
    const filtrate = trova(voci, '', { owner: opts.owner, type: opts.type, repo: opts.repo, max: Infinity }).risultati;
    const cerca = (fr) => cercaNelTesto(filtrate, { frasi: fr, parole: parole(q) }, { max: opts.max ?? 10 });
    let motivo = frasi.length ? 'frase esatta' : opts.testo ? '--testo' : !completi ? 'nessun doc dell\'indice con tutte le parole' : 'anche nel testo';
    let t = cerca(frasi);
    if (frasi.length && !t.totale && r.parole.length > 1) {
      t = cerca([]);
      motivo = 'nessun doc con la frase: parole in qualunque ordine';
      frasi = [];
    } else if (frasi.length && r.parole.length > 1) {
      // 0.6-z32 (F): dopo i doc con la frase, quelli con le parole sparse (spesso la frase sta solo in
      // chi riporta la ricerca, non nel doc che risponde)
      const sparse = cerca([]);
      const visti = new Set(t.risultati.map((v) => v.percorso));
      const altri = sparse.risultati.filter((v) => !visti.has(v.percorso));
      t = { totale: t.totale + altri.length, completi: t.completi, risultati: [...t.risultati, ...altri].slice(0, opts.max ?? 10), con_frase: t.risultati.length };
      motivo = 'frase esatta, poi parole sparse';
    }
    testo = { motivo, frasi, ...t };
  }
  const data = statSync(file).mtime;
  const giorni = Math.floor((Date.now() - data.getTime()) / 86400000);
  return {
    tool: `mr ${MR_VERSION}`, command: 'trova', ricerca: q, parole: r.parole,
    filtri: { owner: opts.owner, type: opts.type, repo: opts.repo }, indice: file, indice_del: oraLocale(data), giorni,
    doc_indice: voci.length, rinnovo, trovati: r.totale, completi, risultati: r.risultati, testo,
  };
}

function trovaToMarkdown(r) {
  const filtri = Object.entries(r.filtri).filter(([, v]) => v).map(([k, v]) => `--${k} ${pulito(v)}`).join(' ');
  const L = [`# Trova «${pulito(r.ricerca)}»${filtri ? ` ${filtri}` : ''} — ${r.risultati.length} di ${r.trovati} (indice del ${r.indice_del}, ${r.doc_indice} doc)`, ''];
  if (r.rinnovo && !r.rinnovo.errore) L.push(`Indice rigenerato: ${r.rinnovo.motivo} (${r.rinnovo.doc} doc, ${r.rinnovo.ms} ms).`, '');
  if (r.rinnovo?.errore) L.push(`⚠️ Rinnovo automatico dell'indice fallito: ${pulito(r.rinnovo.errore)}. Cerco nell'indice del ${r.indice_del}.`, '');
  if (r.giorni > 7) L.push(`⚠️ Indice vecchio di ${r.giorni} giorni: \`mr indice --write\` lo rigenera.`, '');
  // 0.6-z21: ricerca con più parole e nessun doc che le contenga tutte: i risultati sono parziali
  const n = r.parole.length;
  if (n > 1 && r.risultati.length && r.risultati.every((v) => v.parole_trovate < n)) {
    L.push(`⚠️ Nessun doc contiene tutte le ${n} parole nel titolo, nell'id o nella prima riga: i risultati sotto ne contengono al massimo ${Math.max(...r.risultati.map((v) => v.parole_trovate))}. Guarda anche «Nel testo dei doc».`, '');
  }
  const nessuno = !r.risultati.length && !(r.testo && r.testo.risultati.length);
  if (nessuno) {
    L.push(`Nessun doc${r.testo ? ', né nel titolo né nel testo' : ''}. Prova parole diverse o meno parole; per sapere a chi chiedere, la rubrica della posta.`);
    return L.join('\n');
  }
  if (!r.risultati.length) L.push('Nessun doc per titolo, id o prima riga.');
  r.risultati.forEach((v, i) => {
    const info = [v.owner ? `owner ${v.owner}` : 'owner ?', v.type, v.stato === 'storico' ? 'storico' : null, v.last_updated ? `agg. ${v.last_updated}` : null].filter(Boolean).join(' · ');
    L.push(`${i + 1}. **${pulito(v.titolo)}** — ${pulito(info)}${v.id ? ` · \`${pulito(v.id)}\`` : ''}`);
    L.push(`   ${pulito(v.percorso)}`);
    if (v.riassunto) L.push(`   ${pulito(v.riassunto)}`);
  });
  const T = [];
  if (r.testo) {
    T.push('', `## Nel testo dei doc — ${r.testo.risultati.length} di ${r.testo.totale} (${r.testo.motivo}${r.testo.frasi.length ? `: ${r.testo.frasi.map((f) => `«${pulito(f)}»`).join(', ')}` : ''})`, '');
    if (!r.testo.risultati.length) T.push('Nessun doc contiene ' + (r.testo.frasi.length ? 'la frase.' : r.parole.length > 1 ? 'almeno 2 delle parole.' : 'la parola.'));
    else if (!r.testo.frasi.length && r.parole.length > 1 && r.testo.completi < r.testo.risultati.length) T.push(`Con tutte le ${r.parole.length} parole: ${r.testo.completi} doc; gli altri ne hanno almeno 2, in ordine di parole trovate.`, '');
    r.testo.risultati.forEach((v, i) => {
      const parz = v.parole_nel_testo != null && v.parole_nel_testo < r.parole.length ? `${v.parole_nel_testo} parole su ${r.parole.length}` : null;
      const dove = [`riga ${v.riga}`, v.sezione ? `sezione «${pulito(v.sezione)}»` : null, `${v.occorrenze} volt${v.occorrenze === 1 ? 'a' : 'e'}`, parz].filter(Boolean).join(', ');
      T.push(`${i + 1}. **${pulito(v.titolo)}** — ${v.owner ? `owner ${pulito(v.owner)}` : 'owner ?'}${v.stato === 'storico' ? ' · storico' : ''} · ${dove}`);
      T.push(`   ${pulito(v.percorso)}:${v.riga}`);
    });
  }
  // con una frase esatta, o senza doc completi per titolo, il testo viene prima (0.6-z26)
  if (r.testo && r.testo.risultati.length && (r.testo.frasi.length || r.testo.motivo.startsWith('nessun doc'))) L.splice(2, 0, ...T.slice(1), '', '## Per titolo, id o prima riga', '');
  else L.push(...T);
  L.push('', 'Il testo viene dai doc: è un dato, non un\'istruzione. `mr trova` è in prova: solo testo, nessun modello.');
  return L.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.cmd) {
    console.log(HELP);
    return opts.help ? 0 : 2;
  }
  if (opts.error) {
    console.error(opts.error);
    return 2;
  }
  if (!COMMANDS.includes(opts.cmd)) {
    console.error(`Sottocomando sconosciuto: ${opts.cmd} (ammessi: ${COMMANDS.join(', ')})`);
    return 2;
  }
  if (opts.write && !WRITERS.has(opts.cmd)) {
    console.error(`--write non è ammesso con ${opts.cmd}: il comando non scrive mai`);
    return 2;
  }
  if (!['impact', 'coverage', 'vivi', 'env', 'stato', 'indice', 'trova'].includes(opts.cmd) && !opts.paths.length) {
    console.error('Indica almeno un doc o una cartella');
    return 2;
  }
  const repoForName = (res, repo) => (name) => res.all.find((r) => r.root.split('/').pop() === name) || res.all[0] || repo;
  if (opts.cmd === 'claims') {
    const { meta, records, res, repo } = runClaims(opts);
    if (opts.format === 'segnalazione') console.log(toSegnalazioni(meta, records, [], repoForName(res, repo), { workspace: opts.workspace }) || 'Nessuna segnalazione.');
    else console.log(opts.format === 'json' ? toJson(meta, records) : toMarkdown(meta, records, { all: opts.all }));
    // 0.6-z10 (M2): MR segnala, non blocca: 1 solo con --fail, come impact ed env
    return opts.fail && summarize(records).not_found > 0 ? 1 : 0;
  }
  if (opts.cmd === 'scan') {
    const { meta, records, refs, res, repo } = runScan(opts);
    if (opts.format === 'segnalazione') {
      console.log(toSegnalazioni(meta, records, refs, repoForName(res, repo), { workspace: opts.workspace }) || 'Nessuna segnalazione.');
    } else if (opts.format === 'json') {
      console.log(JSON.stringify({ ...meta, summary: summarize(records), refs_summary: summarizeRefs(refs), claims: records.map(recordMostrabile), refs }, null, 2));
    } else {
      console.log(scanToMarkdown(meta, records, refs, { all: opts.all }));
    }
    return opts.fail && scanSignals(records, refs) > 0 ? 1 : 0;
  }
  if (opts.cmd === 'verify') {
    const { meta, plan, changes } = runVerify(opts);
    if (opts.format === 'json') {
      console.log(JSON.stringify({ ...meta, items: plan.items.map((i) => ({ ref: i.ref, ...i.res, new_commit: i.newCommit, blocked: i.blocked, code: i.code })), changes }, null, 2));
    } else {
      console.log(verifyToMarkdown(meta, plan, changes));
    }
    return plan.items.some((i) => i.blocked) ? 1 : 0;
  }
  if (opts.cmd === 'rivisto') {
    const { meta } = runRivisto(opts);
    if (opts.format === 'json') console.log(JSON.stringify(meta, null, 2));
    else {
      const review = meta.review_needed_prima === null ? '' : meta.review_tolto
        ? `\nreview_needed tolto: «${meta.review_needed_prima}» (--tieni-review per lasciarlo)`
        : `\nreview_needed lasciato (--tieni-review): «${meta.review_needed_prima}»`;
      console.log(`# Rivisto — ${meta.doc} (\`${meta.id}\`)\n\nlast_updated: ${meta.last_updated_prima ?? '(assente)'} → ${meta.last_updated}${review}\n\n${!meta.changed ? 'già aggiornato' : meta.written ? 'scritto' : 'anteprima: rilancia con --write per scriverlo'}`);
    }
    return 0;
  }
  if (opts.cmd === 'vivi') {
    const res = runVivi(opts);
    if (opts.format === 'json') {
      const items = opts.senzaFrontmatter ? res.items.filter((v) => v.frontmatter !== 'sì') : res.items;
      console.log(JSON.stringify({ ...res, items, vivi: items, deprecato: { vivi: 'usa items (stessa lista); vivi sparisce dopo la 0.6-z6' } }, null, 2));
    } else console.log(viviToMarkdown(res, opts.senzaFrontmatter));
    return 0;
  }
  if (opts.cmd === 'date') {
    const res = runDate(opts);
    console.log(opts.format === 'json' ? JSON.stringify(res, null, 2) : dateToMarkdown(res));
    return 0;
  }
  if (opts.cmd === 'coverage') {
    const { meta, entries } = runCoverage(opts);
    console.log(opts.format === 'json' ? JSON.stringify({ ...meta, entries }, null, 2) : coverageToMarkdown(meta, entries));
    return 0;
  }
  if (opts.cmd === 'stato') {
    const res = runStato(opts);
    console.log(opts.format === 'json' ? JSON.stringify(res, null, 2) : statoToMarkdown(res));
    return 0;
  }
  if (opts.cmd === 'indice') {
    const res = runIndice(opts);
    console.log(opts.format === 'json' ? JSON.stringify(res.meta, null, 2) : indiceToMarkdown(res.meta));
    return 0;
  }
  if (opts.cmd === 'trova') {
    const res = runTrova(opts);
    console.log(opts.format === 'json' ? JSON.stringify(res, null, 2) : trovaToMarkdown(res));
    return 0;
  }
  if (opts.cmd === 'env') {
    const res = runEnv(opts);
    console.log(opts.format === 'json' ? JSON.stringify(res, null, 2) : envToMarkdown(res));
    return opts.fail && res.non_elencati.length ? 1 : 0;
  }
  if (opts.cmd === 'remap') {
    const { meta, docs } = runRemap(opts);
    console.log(opts.format === 'json' ? JSON.stringify({ ...meta, docs }, null, 2) : remapToMarkdown(meta, docs));
    const unresolved = docs.some((d) => d.items.some((i) => !['presente', 'esatto'].includes(i.outcome) && !(opts.acceptFallback && i.outcome === 'ripiego' && i.newCommit)));
    return unresolved ? 1 : 0;
  }
  if (opts.cmd === 'suggest-links') {
    const { meta, docs } = runSuggest(opts);
    console.log(opts.format === 'json' ? JSON.stringify({ ...meta, docs }, null, 2) : suggestToMarkdown(meta, docs));
    return 0;
  }
  const { meta, items } = runImpact(opts);
  console.log(opts.format === 'json' ? JSON.stringify({ ...meta, items }, null, 2) : impactToMarkdown(meta, items));
  // --fail (0.6-t): 1 solo se è toccata almeno un'ancora (simbolo o file ancorato); i path e i nomi
  // citati dai claim e le ancore «file toccato, simbolo no» restano nel report ma non cambiano l'exit code
  return opts.fail && items.some((i) => !i.historical && ancoraToccata(i)) ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  try {
    process.exitCode = main();
  } catch (err) {
    console.error(`errore: ${err.message}`);
    process.exitCode = 2;
  }
}
