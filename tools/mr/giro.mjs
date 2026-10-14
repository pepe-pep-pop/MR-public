#!/usr/bin/env node
/**
 * giro.mjs — giro settimanale: claim check sui workspace attivi, un solo report per arch
 * (report/0.6-f/regole.md §4, decisione 4 del maintainer).
 *
 *   node tools/mr/giro.mjs [--indice <file>] [--only <slug>]... [--exclude <slug>]... [--fetch] [--locale] [--ignore-dir <dir>] [--senza-pr] [--write | --out <file>]
 *   node tools/mr/giro.mjs --precisione [--giro-dir <dir> | --file <report>...]
 *   node tools/mr/giro.mjs --precisione-ancore [--giro-dir <dir> | --file <report>...]
 *
 * - Workspace: gli slug ATTIVI di `_arch/segnalazioni/indice.md` (letto, mai scritto): tutti
 *   tranne quelli della riga «**Archivio:**» e del gruppo `archivio`. app-web incluso dalla 0.6-i.
 * - Versione letta (0.6-i): per ogni repo `origin/<default>` con --rev, senza checkout e senza
 *   toccare il working tree; HEAD per i repo senza remote; `--locale` = HEAD per tutti.
 *   `--fetch` aggiorna prima i riferimenti remoti (`git fetch origin`): lo usa arch, NON l'agente
 *   di manutenzione di MR (le sue regole vietano il fetch nei repo degli altri). Il report dice
 *   per ogni repo il ref letto, il commit, quanto è indietro la copia locale e l'ultimo fetch.
 * - Repo di un workspace: il repo che contiene la cartella (se ha .md tracciati sotto di
 *   lei) e i repo git dentro la cartella fino a 3 livelli.
 * - Repo del codice per un doc (0.6-i): `mr.repos.yaml` del repo del doc, se c'è; altrimenti
 *   la mappa per cartella: i doc di un repo che CONTIENE la cartella del workspace (es. GL per
 *   `monorepo/progetti/lezioni/go_live.md`) si controllano sui sotto-repo del workspace, mai sul
 *   repo del doc; i doc di un sotto-repo si controllano su tutti i repo del workspace tranne il
 *   contenitore esterno.
 * - Doc storici tolti dal giro (0.6-g, `isGiroHistorical`): non producono nulla.
 * - Nel giro entrano solo affermazioni di tipo path/command/env/endpoint/table/identifier
 *   con **prova di deriva verificata** (cause.mjs: il nome c'era ed è sparito); le altre
 *   not_found vanno in un'appendice non conteggiata.
 * - Eccezioni (0.6-k): oltre al `mr.claims.ignore` del repo, con `--ignore-dir <dir>` si legge
 *   `<dir>/<workspace>.ignore` (stessa sintassi), un'allow-list centrale tenuta da arch
 *   (`_arch/tool/mr-ignore/`) per i workspace in cui non si scrive. Il report dice quali file
 *   d'eccezione ha letto per ogni repo.
 * - PR aperte (0.6-q): una segnalazione su un doc toccato da una PR aperta del suo repo (gh pr
 *   list, sola lettura) va in «Già in correzione» e non conta tra le prodotte. Senza gh, o con
 *   --senza-pr, tutto come prima e il report lo dice.
 * - Uscita: un report markdown con un id per segnalazione e la colonna «esito» vuota; su
 *   stdout, con --write in report/giro/YYYY-MM-DD.md di questo repo, con --out nel file scelto
 *   da chi lancia (arch: la sua cartella; l'agente di manutenzione di MR non scrive in _arch).
 * - --precisione: segnalazioni confermate / segnalazioni prodotte, da report/giro/*.md.
 * - sezione «Ancore in deriva» (0.6-s): ancore e code_refs dei doc del giro valutati alla stessa
 *   versione (missing, moved, drift, unresolvable), conteggio a parte; --precisione-ancore:
 *   doc da correggere / valutate. --precisione non le legge.
 *
 * Exit: 0 eseguito, 2 errore d'uso (indice mancante).
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MR_VERSION, refsOfDoc } from './mr.mjs';
import { saluteDocs } from './lib/salute.mjs';
import { toSegnalazioni } from './lib/segnalazione.mjs';
import { RepoView, isSecretPath } from './lib/repo.mjs';
import { checkDocs, loadIgnore, parseIgnore, IGNORE_FILE, codeExcludes } from './lib/claims.mjs';
import { RepoMap } from './lib/repomap.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MR_ROOT = resolve(here, '../..');

/**
 * Indice di default. Da un worktree della release (`git worktree add --detach <dir> v0.6.0-x`)
 * il percorso relativo non porta a _arch: si risale al clone principale con --git-common-dir (0.6-j).
 */
export function defaultIndice(root = MR_ROOT) {
  const direct = resolve(root, '../../_arch/segnalazioni/indice.md');
  if (existsSync(direct)) return direct;
  try {
    const common = execFileSync('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const viaClone = resolve(dirname(common), '../../_arch/segnalazioni/indice.md');
    if (existsSync(viaClone)) return viaClone;
  } catch {
    // non è un repo git
  }
  return direct;
}
const GIRO_DIR = join(MR_ROOT, 'report/giro');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.venv', 'vendor', 'Pods', 'DerivedData']);
const ESITI = ['confermata', 'scartata', 'non valutata'];

// doc storici o di lavoro (decisione 1 della 0.6-g): fuori dal giro, non una riga informativa
const HIST_TOKENS = new Set([
  'piano', 'piani', 'plan', 'plans', 'planning', 'roadmap', 'roadmaps', 'proposta', 'proposte',
  'proposal', 'proposals', 'ricerca', 'ricerche', 'research', 'spike', 'spikes', 'log', 'logs',
  'changelog', 'report', 'reports', 'incidente', 'incidenti', 'incident', 'incidents', 'postmortem',
  'archive', 'archivio', 'archived', 'archiviati', 'handoff', 'handoffs', 'hof', 'daily', 'diario',
  'audit', 'release', 'releases', // 0.6-i: fotografie di un momento (giro 2: audit e note di release)
  'delta', 'design', 'recon', 'ricognizione', // 0.6-j: confronti col legacy, design, ricognizioni (giro 3)
  // fixture di test (aggiunta dell'agente: doc sbagliati apposta)
  'fixtures', 'fixture',
]);

/** motivo di isGiroHistorical che indica una fixture di test (doc sbagliati apposta): fuori anche dalle ancore */
export function isFixture(reason) {
  return reason === 'fixture di test' || /^«fixtures?» nel path$/.test(reason || '');
}

/** il doc (path relativo al repo) è storico per il giro? ritorna il motivo o null */
export function isGiroHistorical(rel) {
  const low = rel.toLowerCase();
  const segs = low.split('/');
  const base = segs[segs.length - 1];
  if (base.startsWith('hof-')) return 'hof-*';
  if (low.includes('docs/superpowers/')) return 'docs/superpowers/';
  if (segs.some((sg) => sg === '_out' || sg.startsWith('_output'))) return '_out/, _output*/ (generati)';
  // cartelle o file datati (14-04-26/, emergenza-2026-08/, 2026-09-10_x.md): note del giorno
  if (segs.some((sg) => /(^|[^\d])(\d{4}-\d{2}(-\d{2})?|\d{2}-\d{2}-\d{2,4})([^\d]|$)/.test(sg))) return 'datato';
  if (segs.includes('test-files')) return 'fixture di test';
  // pacchetti di modifica numerati (app-web/code/136_griglia_20_minuti/) e runbook di applicazione (0.6-j)
  if (segs.slice(0, -1).some((sg) => /^\d{2,4}_[a-z0-9]/.test(sg))) return 'pacchetto di modifica';
  if (/^runbook[_-]apply/.test(base)) return 'runbook di applicazione';
  // note datate anche senza anno (24-07-pm.md, 0.6-j)
  if (/^\d{2}-\d{2}([-_.]|$)/.test(base)) return 'datato';
  // versione nel nome del file (rework-ui-0.7.0.md): nota di una release, storica
  if (/(^|[^\d])\d+\.\d+\.\d+([^\d]|$)/.test(base)) return 'versione nel nome';
  if (low.includes('lovable') && /(^|[\/_. -])prompts?([\/_. -]|$)/.test(low)) return 'prompt Lovable';
  const tokens = segs.flatMap((sg) => sg.replace(/\.md$/, '').split(/[-_. ]+/)).filter(Boolean);
  const hit = tokens.find((t) => HIST_TOKENS.has(t));
  return hit ? `«${hit}» nel path` : null;
}

function parseArgs(argv) {
  const o = { indice: null, only: [], exclude: [], write: false, precisione: false, fetch: false, locale: false, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--indice') o.indice = argv[++i];
    else if (a === '--only') o.only.push(argv[++i]);
    else if (a === '--exclude') o.exclude.push(argv[++i]);
    else if (a === '--fetch') o.fetch = true;
    else if (a === '--locale') o.locale = true;
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--file') o.files.push(argv[++i]);
    else if (a === '--ignore-dir') o.ignoreDir = argv[++i];
    else if (a === '--senza-pr') o.senzaPr = true;
    else if (a === '--write') o.write = true;
    else if (a === '--precisione') o.precisione = true;
    else if (a === '--precisione-ancore') o.precisioneAncore = true;
    else if (a === '--giro-dir') o.giroDir = argv[++i];
    else o.error = `argomento sconosciuto: ${a}`;
  }
  return o;
}

/** workspace dall'indice di arch: [{slug, gruppo, path, attivo, motivo}] */
export function parseIndice(text) {
  const archivio = new Set();
  const line = text.split('\n').find((l) => /^\*\*Archivio:\*\*/.test(l));
  if (line) for (const m of line.matchAll(/`([^`]+)`/g)) archivio.add(m[1]);
  const out = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/);
    if (!m) continue;
    const [, slug, gruppo, path] = m;
    const motivo = archivio.has(slug) ? 'archivio' : gruppo === 'archivio' ? 'gruppo archivio' : null;
    out.push({ slug, gruppo, path, attivo: !motivo, motivo });
  }
  return out;
}

function git(dir, args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** repo da leggere per un workspace: [{root, dir}] (dir = cartella su cui lanciare claims) */
export function workspaceRepos(path) {
  const out = [];
  if (!existsSync(path)) return out;
  // repo che contiene la cartella, se la cartella non è la sua root e ha .md tracciati
  try {
    const top = git(path, ['rev-parse', '--show-toplevel']).trim();
    if (resolve(top) !== resolve(path)) {
      // contenitore esterno (es. il monorepo per monorepo/progetti/lezioni): solo i suoi doc sotto la cartella
      if (git(path, ['ls-files', '--', '*.md']).trim()) out.push({ root: top, dir: path, outer: true });
    } else {
      out.push({ root: top, dir: path });
    }
  } catch {
    // non è dentro un repo git
  }
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const sub = join(d, e.name);
      if (existsSync(join(sub, '.git'))) out.push({ root: sub, dir: sub });
      walk(sub, depth + 1);
    }
  };
  walk(path, 1);
  return out;
}

/**
 * Versione da leggere per un repo (0.6-i): origin/<default>, oppure HEAD se non c'è un remote
 * origin o con --locale. Con fetch=true aggiorna prima i riferimenti remoti.
 * @returns {{rev: string, label: string, commit: string, behind: number|null, lastFetch: string|null, note?: string}}
 */
export function repoRef(root, { fetch = false, locale = false } = {}) {
  const short = (ref) => git(root, ['rev-parse', '--short', ref]).trim();
  let hasOrigin = false;
  try {
    hasOrigin = git(root, ['remote']).split('\n').includes('origin');
  } catch {
    hasOrigin = false;
  }
  let note;
  if (hasOrigin && fetch && !locale) {
    try {
      git(root, ['fetch', '--quiet', '--no-tags', 'origin']);
    } catch (err) {
      note = `fetch fallito: ${String(err.message).split('\n')[0]}`;
    }
  }
  let lastFetch = null;
  try {
    const fh = resolve(root, git(root, ['rev-parse', '--git-path', 'FETCH_HEAD']).trim());
    if (existsSync(fh)) lastFetch = statSync(fh).mtime.toISOString().slice(0, 16).replace('T', ' ');
  } catch {
    lastFetch = null;
  }
  if (hasOrigin && !locale) {
    let ref = null;
    try {
      ref = git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).trim().replace('refs/remotes/', '');
    } catch {
      for (const c of ['origin/main', 'origin/master']) {
        try {
          git(root, ['rev-parse', '--verify', '--quiet', c]);
          ref = c;
          break;
        } catch {
          // non c'è
        }
      }
    }
    if (ref) {
      let behind = null;
      try {
        behind = Number(git(root, ['rev-list', '--count', `HEAD..${ref}`]).trim());
      } catch {
        behind = null;
      }
      const commit = short(ref);
      return { rev: commit, label: ref, commit, behind, lastFetch, ...(note ? { note } : {}) };
    }
    note = note || 'origin senza ramo di default noto: letto HEAD';
  }
  const commit = short('HEAD');
  return { rev: commit, label: hasOrigin ? 'HEAD' : 'HEAD (senza remote)', commit, behind: null, lastFetch, ...(note ? { note } : {}) };
}

/**
 * File toccati dalle PR aperte del repo su GitHub (0.6-q): una segnalazione su un doc che una PR
 * aperta sta già correggendo non è nuova. Sola lettura (`gh pr list`). `MR_GH_BIN` sostituisce
 * `gh` nei test.
 * @returns {{ ok: boolean, slug?: string, files: Map<string, number[]>, note?: string }}
 */
/**
 * righe del paragrafo della riga n (1-based): stessi confini del contesto del giro, fino a 5 righe
 * prima e 3 dopo, fermandosi a righe vuote, titoli e righe di tabella (0.6-r, verbo legato al nome)
 * @returns {{ lines: string[], at: number }}
 */
export function paragraphOf(ls, n) {
  const row = ls[n - 1] || '';
  if (/^\s*\|/.test(row)) return { lines: [row], at: 0 };
  const acc = [row];
  for (let i = n - 2; i >= 0 && i >= n - 6 && ls[i].trim() && !/^#{1,6}\s/.test(ls[i]) && !/^\s*\|/.test(ls[i]); i--) acc.unshift(ls[i]);
  const at = acc.length - 1;
  for (let i = n; i < ls.length && i < n + 3 && ls[i].trim() && !/^#{1,6}\s/.test(ls[i]) && !/^\s*\|/.test(ls[i]); i++) acc.push(ls[i]);
  return { lines: acc, at };
}

export function openPrFiles(root) {
  const files = new Map();
  let url = '';
  try {
    url = git(root, ['remote', 'get-url', 'origin']).trim();
  } catch {
    return { ok: false, files, note: 'nessun remote origin' };
  }
  const m = url.match(/github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
  if (!m) return { ok: false, files, note: 'origin non è su GitHub' };
  const slug = m[1];
  let out;
  try {
    out = execFileSync(process.env.MR_GH_BIN || 'gh', ['pr', 'list', '--repo', slug, '--state', 'open', '--json', 'number,files', '--limit', '100'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { ok: false, slug, files, note: `gh non disponibile o errore (${String(err.message).split('\n')[0].slice(0, 80)})` };
  }
  try {
    for (const pr of JSON.parse(out || '[]')) {
      for (const f of pr.files || []) {
        if (!files.has(f.path)) files.set(f.path, []);
        files.get(f.path).push(pr.number);
      }
    }
  } catch {
    return { ok: false, slug, files, note: 'risposta di gh non leggibile' };
  }
  return { ok: true, slug, files };
}

/** una segnalazione per blocco: {doc, affermazioni, severita, testo} */
function splitSegnalazioni(text) {
  if (!text.trim() || text.trim() === 'Nessuna segnalazione.') return [];
  return text.split('\n\n---\n\n').map((b) => {
    const h = b.match(/^# Segnalazione — (.+): (\d+) affermazioni/m);
    const sev = b.match(/^\*\*Severita:\*\* (\S+)/m);
    return { doc: h ? h[1] : '?', affermazioni: h ? Number(h[2]) : 0, severita: sev ? sev[1] : '?', testo: b.trim() };
  });
}

function cell(s) {
  return String(s).replace(/\|/g, '\\|');
}

function runGiro(o) {
  o.indice ??= defaultIndice();
  if (!existsSync(o.indice)) {
    console.error(`indice non trovato: ${o.indice}`);
    return 2;
  }
  const all = parseIndice(readFileSync(o.indice, 'utf-8'));
  const excluded = [];
  const chosen = [];
  for (const w of all) {
    if (o.only.length && !o.only.includes(w.slug)) continue;
    if (!w.attivo) excluded.push([w.slug, w.motivo]);
    else if (o.exclude.includes(w.slug)) excluded.push([w.slug, 'escluso con --exclude']);
    else chosen.push(w);
  }

  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  const blocks = [];
  const notes = [];
  let reposRead = 0;
  const appendix = [];
  const historicalCount = new Map();
  let affermazioni = 0;
  const refs = []; // [{slug, repo, ...repoRef}]
  const inCorrezione = []; // [{id, prs}] segnalazioni su doc toccati da una PR aperta (0.6-q)
  // ancore e code_refs (0.6-s): conteggio a parte, mai sommato alle segnalazioni
  const ancore = []; // righe in deriva, spostate, mancanti, non risolvibili
  const ancoreInPr = []; // stesse righe, su doc toccati da una PR aperta
  const ancoreStat = { lette: 0, ok: 0, senzaVerified: 0, docs: new Set(), repos: new Set() };
  // salute dei doc (0.6-x): frontmatter MR dei doc vivi, conteggio a parte
  const salute = []; // [{slug, repo, ...saluteDocs}]
  const prNotes = new Map(); // repo → nota se le PR non si sono potute leggere
  for (const w of chosen) {
    const repos = workspaceRepos(w.path);
    if (!repos.length) {
      notes.push(`\`${w.slug}\`: ${existsSync(w.path) ? 'nessun repo git' : 'cartella non trovata'}, saltato`);
      continue;
    }
    // una vista per repo alla versione scelta (origin/<default> di default)
    const views = new Map();
    for (const r of repos) {
      if (views.has(r.root)) continue;
      try {
        const ref = repoRef(r.root, { fetch: o.fetch, locale: o.locale });
        views.set(r.root, new RepoView(r.root, ref.rev));
        refs.push({ slug: w.slug, repo: r.root.split('/').pop(), ...ref });
      } catch (err) {
        notes.push(`\`${w.slug}\` / ${r.root.split('/').pop()}: versione non leggibile (${err.message.split('\n')[0]})`);
      }
    }
    // allow-list centrale del workspace (0.6-k)
    let central = [];
    let centralFile = null;
    if (o.ignoreDir) {
      const f = join(o.ignoreDir, `${w.slug}.ignore`);
      if (existsSync(f)) {
        central = parseIgnore(readFileSync(f, 'utf-8'));
        centralFile = f;
      }
    }
    const outerRoot = repos.find((x) => x.outer)?.root;
    const inner = [...views.keys()].filter((root) => root !== outerRoot);
    for (const r of repos) {
      const view = views.get(r.root);
      if (!view) continue;
      const repoName = r.root.split('/').pop();
      const prefix = relative(r.root, r.dir) || '.';
      const docs = [];
      // doc storici per path (hof-*, piani, …): fuori dai claim, ma le loro ancore si leggono (0.6-s:
      // un'ancora è un legame verificato da qualcuno, le trappole di un HOF comprese); le fixture no
      const ancoraOnly = [];
      // doc dentro cartelle codice:<glob> (repo o allow-list centrale): sono della copia esclusa (0.6-m)
      const exDocs = codeExcludes([...(view.hasFile(IGNORE_FILE) ? loadIgnore(view) : []), ...central]);
      for (const rel of view.listMarkdownUnder(prefix)) {
        if (isSecretPath(rel)) continue;
        if (exDocs.some((r) => r.test(rel))) continue;
        const hist = isGiroHistorical(rel);
        if (hist) {
          historicalCount.set(w.slug, (historicalCount.get(w.slug) || 0) + 1);
          if (!isFixture(hist)) ancoraOnly.push(rel);
          continue;
        }
        docs.push(rel);
      }
      if (!docs.length && !ancoraOnly.length) continue;
      // repo del codice: mr.repos.yaml del repo del doc, altrimenti mappa per cartella
      let codeFor;
      let map = null;
      try {
        map = RepoMap.load(view, null, null);
      } catch (err) {
        notes.push(`\`${w.slug}\` / ${repoName}: mr.repos.yaml non valido (${err.message.split('\n')[0]}), uso la mappa per cartella`);
      }
      if (map) {
        codeFor = (d) => map.reposFor(d).map((x) => views.get(x.root) || new RepoView(x.root, repoRef(x.root, { locale: o.locale }).rev));
      } else if (r.outer) {
        const code = inner.length ? inner.map((x) => views.get(x)) : [view];
        codeFor = () => code;
      } else {
        const code = [view, ...inner.filter((x) => x !== r.root).map((x) => views.get(x))];
        codeFor = () => code;
      }
      let out;
      const pendingAncore = [];
      try {
        const own = loadIgnore(view);
        const ignore = [...own, ...central];
        const refRow = refs.find((x) => x.slug === w.slug && x.repo === repoName);
        if (refRow) refRow.ignore = [view.hasFile(IGNORE_FILE) ? IGNORE_FILE : null, centralFile].filter(Boolean).join(' + ') || 'nessuno';
        const records = checkDocs(view, docs, { ignore, codeReposFor: codeFor });
        const lines = new Map();
        // testo della riga più le righe precedenti dello stesso paragrafo (un elenco che
        // comincia con «Rimossi:» e va a capo)
        const lineText = (doc, n) => {
          if (!lines.has(doc)) lines.set(doc, view.readFile(doc).split('\n'));
          const ls = lines.get(doc);
          const acc = [ls[n - 1] || ''];
          // riga di tabella: conta solo la riga (le righe sopra sono altre voci, 0.6-j)
          if (/^\s*\|/.test(acc[0])) return acc[0];
          for (let i = n - 2; i >= 0 && i >= n - 6 && ls[i].trim() && !/^#{1,6}\s/.test(ls[i]); i--) acc.unshift(ls[i]);
          // anche le righe dopo, fino a 3, nello stesso paragrafo (0.6-q: «… \`x\` e \`y\` / sono stati
          // tolti il 20/08» va a capo)
          if (!/^#{1,6}\s/.test(acc[acc.length - 1])) {
            for (let i = n; i < ls.length && i < n + 3 && ls[i].trim() && !/^#{1,6}\s/.test(ls[i]) && !/^\s*\|/.test(ls[i]); i++) acc.push(ls[i]);
          }
          return acc.join(' ');
        };
        // intestazione della tabella che contiene la riga (per i registri di lavoro fatto, 0.6-k)
        const tableHeader = (doc, n) => {
          if (!lines.has(doc)) lines.set(doc, view.readFile(doc).split('\n'));
          const ls = lines.get(doc);
          if (!/^\s*\|/.test(ls[n - 1] || '')) return '';
          for (let i = n - 2; i >= 1; i--) {
            if (!/^\s*\|/.test(ls[i])) return '';
            if (/^\s*\|[\s:|-]+\|\s*$/.test(ls[i])) return ls[i - 1] || '';
          }
          return '';
        };
        const meta = { tool: `mr ${MR_VERSION}`, repo: repoName, rev: view.rev };
        const byDoc = new Map(docs.map((d) => [d, codeFor(d)]));
        out = toSegnalazioni(meta, records, [], () => view, {
          workspace: w.slug, onlyCaused: true, today, lineText, tableHeader, reposForDoc: (d) => byDoc.get(d),
          rawLine: (doc, n) => {
            if (!lines.has(doc)) lines.set(doc, view.readFile(doc).split('\n'));
            return lines.get(doc)[n - 1] || '';
          },
          paragraph: (doc, n) => {
            if (!lines.has(doc)) lines.set(doc, view.readFile(doc).split('\n'));
            return paragraphOf(lines.get(doc), n);
          },
        });
        // salute dei doc: frontmatter MR dei doc vivi (e degli storici per path, solo id e problemi)
        const sd = saluteDocs(docs.map((d) => ({ doc: d, text: view.readFile(d) })), today, ancoraOnly.map((d) => ({ doc: d, text: view.readFile(d) })));
        salute.push({ slug: w.slug, repo: repoName, ...sd });
        // ancore e code_refs dei doc che ne hanno, alla stessa versione letta (0.6-s)
        for (const d of [...docs, ...ancoraOnly]) {
          if (!/<!--\s*mr:code\b|^code_refs:/m.test(view.readFile(d))) continue;
          const code = codeFor(d);
          const all = [...new Set([...code, ...views.values()])].filter(Boolean);
          for (const x of refsOfDoc(view, d, code[0], all, ignore).refs) {
            if (x.historical) continue;
            ancoreStat.lette++;
            ancoreStat.docs.add(`${w.slug}/${repoName}/${d}`);
            ancoreStat.repos.add(`${w.slug}/${repoName}`);
            if (x.status === 'ok') ancoreStat.ok++;
            else if (x.status === 'unverified') ancoreStat.senzaVerified++;
            else pendingAncore.push({ ...x, id: `${w.slug}/${repoName}/${d}` });
          }
        }
      } catch (err) {
        notes.push(`\`${w.slug}\` / ${repoName}: errore del tool (${err.message.split('\n')[0]})`);
        continue;
      }
      reposRead++;
      for (const a of out.appendix) appendix.push({ ...a, id: `${w.slug}/${repoName}/${a.doc}` });
      const prs = o.senzaPr ? null : openPrFiles(r.root);
      if (prs && !prs.ok) prNotes.set(`${w.slug}/${repoName}`, prs.note);
      for (const a of pendingAncore) {
        const inPr = prs?.files.get(a.doc);
        if (inPr) ancoreInPr.push({ ...a, prs: inPr, slug: prs.slug });
        else ancore.push(a);
      }
      for (const s2 of splitSegnalazioni(out.text)) {
        const id = `${w.slug}/${repoName}/${s2.doc}`;
        const inPr = prs?.files.get(s2.doc);
        if (inPr) {
          // già in correzione: fuori dalle prodotte, elencata a parte
          inCorrezione.push({ id, prs: inPr, slug: prs.slug, affermazioni: s2.affermazioni });
          continue;
        }
        affermazioni += s2.affermazioni;
        rows.push({ id, slug: w.slug, repo: repoName, doc: s2.doc, affermazioni: s2.affermazioni, severita: s2.severita });
        // titoli interni della segnalazione sotto il titolo del blocco (### id): niente ## nel report
        blocks.push(`### ${id}\n\n${s2.testo.replace(/^# /m, '#### ').replace(/^## /gm, '##### ')}`);
      }
    }
  }

  const L = [];
  L.push(`# Giro settimanale MR — ${today}`, '');
  L.push(`Tool: \`mr ${MR_VERSION}\`, \`mr claims --format segnalazione\`, sola lettura. Indice: \`${o.indice}\` (letto, non modificato).`);
  L.push(`Workspace letti: ${chosen.length} · repo letti: ${reposRead} · segnalazioni: ${rows.length} · affermazioni con prova di deriva: ${affermazioni}.`);
  L.push(`Ancore (conteggio a parte, sezione «Ancore in deriva»): ${ancoreStat.lette} lette in ${ancoreStat.docs.size} doc · da rileggere: ${ancore.length}.`);
  {
    const v = salute.reduce((a, x) => a + x.vivi, 0);
    const t = salute.reduce((a, x) => a + x.taggati, 0);
    L.push(`Salute dei doc (conteggio a parte, sezione «Salute dei doc»): ${t} doc vivi su ${v} con frontmatter MR, in ${salute.filter((x) => x.taggati).length} repo su ${salute.length}; da aggiornare (review_needed): ${salute.reduce((a, x) => a + (x.daAggiornare || []).length, 0)}.`);
  }
  L.push(`Regole (0.6-g, 0.6-i): versione GitHub (origin/<default>) di ogni repo; doc storici fuori dal giro (${[...historicalCount.values()].reduce((a, b) => a + b, 0)} doc tolti); repo del codice dalla mappa (mr.repos.yaml o per cartella); righe che raccontano la rimozione o il passato = storico, righe di esempio fuori; solo affermazioni path/command/env/endpoint/table/identifier con prova di deriva («causato da»: il nome c'era ed è sparito). Le altre ${appendix.length} sono in appendice, non conteggiate.`, '');
  if (excluded.length) L.push(`Esclusi: ${excluded.map(([s, m]) => `\`${s}\` (${m})`).join(', ')}.`, '');
  if (o.senzaPr) L.push('PR aperte: non lette (`--senza-pr`).', '');
  else {
    L.push(`PR aperte: ${inCorrezione.length} segnalazioni su doc già toccati da una PR aperta, elencate in «Già in correzione»: non sono tra le prodotte, e \`--precisione\` le conta come confermate in una riga separata.`);
    if (prNotes.size) L.push(`PR non lette per ${prNotes.size} repo (comportamento come prima, segnalazioni contate): ${[...prNotes].map(([k, v]) => `${k} — ${v}`).join('; ')}.`);
    L.push('');
  }
  if (notes.length) L.push('Note:', '', ...notes.map((n) => `- ${n}`), '');
  L.push('## Versioni lette', '');
  L.push(`Ogni repo è letto alla versione indicata con --rev, senza checkout e senza toccare il working tree. Fetch eseguito in questo giro: ${o.fetch && !o.locale ? 'sì' : 'no'}.`, '');
  L.push(`Eccezioni: \`mr.claims.ignore\` del repo${o.ignoreDir ? ` + allow-list centrale \`${o.ignoreDir}/<workspace>.ignore\`` : ' (nessuna allow-list centrale: --ignore-dir non dato)'}.`, '');
  L.push('| workspace | repo | ref | commit | copia locale indietro di | ultimo fetch | eccezioni lette | nota |', '|---|---|---|---|---|---|---|---|');
  for (const r of refs) L.push(`| ${r.slug} | ${cell(r.repo)} | ${r.label} | ${r.commit} | ${r.behind === null ? '—' : r.behind} | ${r.lastFetch || '—'} | ${cell(r.ignore || '— (nessun doc letto)')} | ${r.note ? cell(r.note) : ''} |`);
  L.push('');
  L.push('## Riepilogo', '');
  L.push(`Colonna «esito»: la compila il coordinatore con ${ESITI.map((e) => `\`${e}\``).join(', ')}. \`node tools/mr/giro.mjs --precisione\` dà due numeri: (confermate + già in correzione) / (prodotte + già in correzione), e confermate / prodotte.`, '');
  L.push(`Segnalazioni prodotte: ${rows.length} · già in correzione: ${inCorrezione.length} (contate come confermate).`, '');
  L.push('| id | workspace | repo | doc | affermazioni | severità | esito |', '|---|---|---|---|---|---|---|');
  for (const r of rows) L.push(`| ${cell(r.id)} | ${r.slug} | ${cell(r.repo)} | ${cell(r.doc)} | ${r.affermazioni} | ${r.severita} |  |`);
  if (inCorrezione.length) {
    L.push('', '## Già in correzione (contate come confermate)', '', 'Il doc è toccato da una PR aperta sul suo repo: la correzione c\'è già, manca la merge. Sono derive vere: `--precisione` le conta come confermate, in una riga separata.', '');
    L.push('| id | affermazioni | PR aperte |', '|---|---|---|');
    for (const x of inCorrezione) L.push(`| ${cell(x.id)} | ${x.affermazioni} | ${x.prs.map((n) => `${x.slug}#${n}`).join(', ')} |`);
  }
  L.push('', '## Segnalazioni', '', ...blocks.flatMap((b) => [b, '']));
  L.push(...sezioneAncore(ancore, ancoreInPr, ancoreStat));
  L.push(...sezioneSalute(salute));
  L.push('## Appendice — non conteggiata', '', 'Affermazioni not_found senza prova di deriva (mai esistite nel codice, o vivono in un altro sistema), scartate da una regola (tra parentesi: storico, verbo «…» legato al nome, planned, negato, esempio, opzione) o di un tipo fuori dal giro (tipo). Non sono segnalazioni e non hanno esito.', '');
  const byDoc = new Map();
  for (const a of appendix) {
    if (!byDoc.has(a.id)) byDoc.set(a.id, []);
    byDoc.get(a.id).push(a);
  }
  for (const [id, list] of byDoc) L.push(`- ${cell(id)}: ${list.map((a) => `${a.line} ${a.kind} \`${a.claim.replace(/`/g, "'")}\`${motivoBreve(a)}`).join(' · ')}`);
  L.push('');
  const report = L.join('\n');

  if (o.out) {
    // file scelto da chi lancia il giro (arch: la sua cartella di valutazioni); non sovrascrive
    if (existsSync(o.out)) {
      console.error(`esiste già: ${o.out} (il giro non sovrascrive)`);
      return 2;
    }
    mkdirSync(dirname(resolve(o.out)), { recursive: true });
    writeFileSync(o.out, report + '\n', 'utf-8');
    console.log(`scritto: ${o.out} (${rows.length} segnalazioni)`);
  } else if (o.write) {
    const dir = o.giroDir || GIRO_DIR;
    mkdirSync(dir, { recursive: true });
    // un giro già scritto oggi non si sovrascrive: secondo giro in YYYY-MM-DD-2.md
    let file = join(dir, `${today}.md`);
    for (let n = 2; existsSync(file); n++) file = join(dir, `${today}-${n}.md`);
    writeFileSync(file, report + '\n', 'utf-8');
    console.log(`scritto: ${relative(process.cwd(), file)} (${rows.length} segnalazioni)`);
  } else {
    console.log(report);
  }
  return 0;
}

/**
 * sezione «Salute dei doc» (0.6-x): per repo, doc vivi, con frontmatter MR, senza, vecchi, problemi;
 * i riferimenti (superseded_by, depends_on) si risolvono contro gli id di tutti i repo letti
 */
export function sezioneSalute(salute, maxProblemi = 60) {
  const L = ['## Salute dei doc (conteggio a parte)', ''];
  const ids = new Set(salute.flatMap((x) => x.ids));
  for (const x of salute) {
    x.problemiTutti = [...x.problemi, ...x.riferimenti.filter((r) => !ids.has(r.id)).map((r) => ({ doc: r.doc, problema: `\`${r.campo}\` verso un id che non esiste in nessun repo letto: \`${r.id}\`` }))];
  }
  const v = salute.reduce((a, x) => a + x.vivi, 0);
  const t = salute.reduce((a, x) => a + x.taggati, 0);
  const p = salute.reduce((a, x) => a + x.problemiTutti.length, 0);
  const da = salute.reduce((a, x) => a + (x.daAggiornare || []).length, 0);
  L.push(`Doc vivi (non storici per il giro): ${v} · con frontmatter MR: ${t} · senza: ${v - t} · da aggiornare (review_needed): ${da} · problemi nei doc con frontmatter: ${p}.`, '');
  L.push('Non sono segnalazioni: dicono quanta documentazione dichiara cosa è e se è ancora valida. Il frontmatter si propone con la skill `mr-tag` (profilo light, matrix.md §1.8), doc per doc, dall\'agente del workspace. Doc vecchio: l\'agente del workspace lo rilegge; se è ancora vero `mr rivisto <doc> --write` (aggiorna solo `last_updated`), altrimenti lo corregge. Doc da aggiornare: valido, ma l\'agente del workspace ha scritto in \`review_needed\` cosa non è più vero; dopo la correzione \`mr rivisto <doc> --write\` toglie il campo.', '');
  L.push('| workspace | repo | doc vivi | con frontmatter | senza | vecchi | da aggiornare | problemi |', '|---|---|---|---|---|---|---|---|');
  const rows = [...salute].filter((x) => x.vivi || x.taggatiStorici || (x.daAggiornare || []).length).sort((a, b) => b.vivi - a.vivi || a.slug.localeCompare(b.slug));
  for (const x of rows) L.push(`| ${x.slug} | ${cell(x.repo)} | ${x.vivi} | ${x.taggati}${x.taggatiStorici ? ` (+${x.taggatiStorici} storici)` : ''} | ${x.vivi - x.taggati} | ${x.vecchi} | ${(x.daAggiornare || []).length} | ${x.problemiTutti.length} |`);
  const daLista = rows.flatMap((x) => (x.daAggiornare || []).map((q) => `- ${cell(`${x.slug}/${x.repo}/${q.doc}`)}: ${cell(q.motivo)}`));
  if (daLista.length) L.push('', 'Da aggiornare (review_needed), per repo:', '', ...daLista);
  const tutti = rows.flatMap((x) => x.problemiTutti.map((q) => `- ${cell(`${x.slug}/${x.repo}/${q.doc}`)}: ${q.problema}`));
  if (tutti.length) {
    L.push('', `Problemi nei doc con frontmatter${tutti.length > maxProblemi ? ` (i primi ${maxProblemi} su ${tutti.length})` : ''}:`, '', ...tutti.slice(0, maxProblemi));
  }
  L.push('');
  return L;
}

const ESITI_ANCORE = ['doc da correggere', 'doc ancora vero', 'non valutata'];
const ORDINE_STATI = { missing: 0, moved: 1, drift: 2, unresolvable: 3 };

/** sezione «Ancore in deriva» (0.6-s): una riga per ancora, missing e moved prima, poi drift, poi non risolvibili */
export function sezioneAncore(ancore, inPr, stat) {
  const L = ['## Ancore in deriva (conteggio a parte)', ''];
  const by = (st) => ancore.filter((a) => a.status === st).length;
  L.push(`Ancore e code_refs letti: ${stat.lette} in ${stat.docs.size} doc (${stat.repos.size} repo) · ok ${stat.ok} · senza verified ${stat.senzaVerified} · mancanti ${by('missing')} · spostate ${by('moved')} · in deriva ${by('drift')} · non risolvibili ${by('unresolvable')}.`, '');
  L.push(`Non sono segnalazioni e \`--precisione\` non le conta. Colonna «esito»: ${ESITI_ANCORE.map((e) => `\`${e}\``).join(', ')} (\`giro.mjs --precisione-ancore\`). Chi agisce: l'agente del workspace con \`mr-drift-review\` (rilegge la sezione e il diff, corregge o \`mr verify --write\`).`, '');
  const sorted = [...ancore].sort((a, b) => (ORDINE_STATI[a.status] ?? 9) - (ORDINE_STATI[b.status] ?? 9) || a.id.localeCompare(b.id) || a.line - b.line);
  L.push('| id | riga | sezione | ancora | stato | verified | commit dopo verified | esito |', '|---|---|---|---|---|---|---|---|');
  const commits = (a) => {
    const cs = a.commits || [];
    if (!cs.length) return a.note ? cell(a.note) : '—';
    const shown = cs.slice(0, 3).map((c) => `${c.hash} ${c.date}`).join(', ');
    return cs.length > 3 ? `${shown} (+${cs.length - 3})` : shown;
  };
  for (const a of sorted) {
    const anc = `${a.path}${a.symbol ? `#${a.symbol}` : ''}${a.moved_to ? ` → ${a.moved_to}` : ''}`;
    L.push(`| ${cell(a.id)} | ${a.line} | ${cell(a.section || '')} | ${cell(anc)} | ${a.status} | ${a.verified || '—'} | ${commits(a)} |  |`);
  }
  if (!sorted.length) L.push('| — | | | nessuna ancora da rileggere | | | | |');
  if (inPr.length) {
    L.push('', 'Su doc già toccati da una PR aperta (non nella tabella):', '');
    for (const a of inPr) L.push(`- ${cell(a.id)}:${a.line} \`${a.path}${a.symbol ? `#${a.symbol}` : ''}\` ${a.status} — ${a.prs.map((n) => `${a.slug}#${n}`).join(', ')}`);
  }
  L.push('');
  return L;
}

/** precisione delle ancore (0.6-s): doc da correggere / valutate, dalla sola sezione «Ancore in deriva» */
export function precisioneAncore(texts) {
  let righe = 0;
  const per = Object.fromEntries(ESITI_ANCORE.map((e) => [e, 0]));
  for (const t of texts) {
    const start = t.indexOf('## Ancore in deriva');
    if (start < 0) continue;
    const end = t.indexOf('\n## ', start + 1);
    for (const l of t.slice(start, end < 0 ? undefined : end).split('\n')) {
      const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      if (cells.length !== 8 || cells[0] === 'id' || cells[0] === '—' || /^-+$/.test(cells[0])) continue;
      righe++;
      const e = cells[7].toLowerCase();
      if (e in per) per[e]++;
    }
  }
  return { righe, ...per, valutate: per['doc da correggere'] + per['doc ancora vero'] };
}

/** motivo dello scarto nell'appendice (0.6-r: per giudicare gli scarti senza rilanciare il giro) */
export function motivoBreve(a) {
  if (a.reason === 'tipo fuori dal giro') return ' (tipo)';
  if (a.verbo) return ` (verbo «${a.verbo}»)`;
  if (a.reason.startsWith('nessuna prova')) return '';
  return ` (${a.reason.split(':')[0]})`;
}

/** precisione in uso dai report del giro: righe del riepilogo con un esito */
export function precisione(texts) {
  let prodotte = 0;
  let inCorrezione = 0;
  const per = Object.fromEntries(ESITI.map((e) => [e, 0]));
  for (const t of texts) {
    const start = t.indexOf('## Riepilogo');
    if (start < 0) continue;
    const end = t.indexOf('\n## ', start + 1);
    for (const l of t.slice(start, end < 0 ? undefined : end).split('\n')) {
      const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
      if (cells.length !== 7 || cells[0] === 'id' || /^-+$/.test(cells[0])) continue;
      prodotte++;
      const e = cells[6].toLowerCase();
      if (e in per) per[e]++;
    }
    // «Già in correzione» (0.6-w): derive vere con una PR aperta, contate come confermate a parte
    const c = t.indexOf('## Già in correzione');
    if (c >= 0) {
      const cEnd = t.indexOf('\n## ', c + 1);
      for (const l of t.slice(c, cEnd < 0 ? undefined : cEnd).split('\n')) {
        const cells = l.split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim());
        if (cells.length !== 3 || cells[0] === 'id' || /^-+$/.test(cells[0])) continue;
        inCorrezione++;
      }
    }
  }
  return { prodotte, ...per, valutate: per.confermata + per.scartata, inCorrezione };
}

function reportFiles(o) {
  const dir = o.files.length ? '' : o.giroDir || GIRO_DIR;
  const files = o.files.length ? o.files : existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(f)).sort() : [];
  return { dir, files, texts: () => files.map((f) => readFileSync(o.files.length ? f : join(dir, f), 'utf-8')) };
}

function runPrecisioneAncore(o) {
  const { dir, files, texts } = reportFiles(o);
  if (!files.length) {
    console.log(`Nessun report in ${relative(process.cwd(), dir) || dir}: lancia prima il giro con --write.`);
    return 0;
  }
  const p = precisioneAncore(texts());
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
  console.log(`Report: ${files.join(', ')}`);
  console.log(`Precisione delle ancore = doc da correggere / valutate = ${p['doc da correggere']}/${p.valutate} (${pct(p['doc da correggere'], p.valutate)})`);
  console.log(`Righe: ${p.righe} · doc da correggere ${p['doc da correggere']} · doc ancora vero ${p['doc ancora vero']} · non valutate ${p['non valutata']} · senza esito ${p.righe - p.valutate - p['non valutata']}`);
  return 0;
}

function runPrecisione(o) {
  // --file <report> (ripetibile) per report salvati con --out; altrimenti i YYYY-MM-DD*.md della cartella
  const dir = o.files.length ? '' : o.giroDir || GIRO_DIR;
  const files = o.files.length ? o.files : existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}(-\d+)?\.md$/.test(f)).sort() : [];
  if (!files.length) {
    console.log(`Nessun report in ${relative(process.cwd(), dir) || dir}: lancia prima il giro con --write.`);
    return 0;
  }
  const p = precisione(files.map((f) => readFileSync(o.files.length ? f : join(dir, f), 'utf-8')));
  const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : 'n/a');
  console.log(`Report: ${files.join(', ')}`);
  // 0.6-w: le «già in correzione» sono derive vere con una PR aperta: contano come confermate
  const conf = p.confermata + p.inCorrezione;
  const tot = p.prodotte + p.inCorrezione;
  console.log(`Precisione in uso = (confermate + già in correzione) / (prodotte + già in correzione) = ${conf}/${tot} (${pct(conf, tot)})`);
  console.log(`  di cui già in correzione: ${p.inCorrezione} (derive vere con una PR aperta, contate come confermate)`);
  console.log(`  solo le segnalazioni prodotte: confermate / prodotte = ${p.confermata}/${p.prodotte} (${pct(p.confermata, p.prodotte)})`);
  console.log(`Valutate: ${p.valutate}/${p.prodotte} · confermate ${p.confermata} · scartate ${p.scartata} · non valutate ${p['non valutata']} · senza esito ${p.prodotte - p.valutate - p['non valutata']}`);
  console.log(`Precisione sulle sole valutate: ${pct(p.confermata, p.valutate)}`);
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  const o = parseArgs(process.argv.slice(2));
  if (o.error) {
    console.error(o.error);
    process.exitCode = 2;
  } else {
    try {
      process.exitCode = o.precisioneAncore ? runPrecisioneAncore(o) : o.precisione ? runPrecisione(o) : runGiro(o);
    } catch (err) {
      console.error(`errore: ${err.message}`);
      process.exitCode = 2;
    }
  }
}
