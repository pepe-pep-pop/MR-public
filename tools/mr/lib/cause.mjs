/**
 * cause.mjs — prova di deriva per un claim not_found (0.6-g, nota A20 rivista).
 *
 * «Causato da <commit>» vale solo se è verificato: al commit precedente il nome c'era nel
 * codice e al commit non c'è più. Prima (0.6-d) bastava l'ultimo `git log -S`, che trova
 * anche i commit che AGGIUNGONO il nome (es. una migration che lo cita in un commento).
 *
 *   path con /     ultimo commit che cancella o rinomina quel file (o un file che finisce
 *                  così); al padre il file c'era
 *   nome di file   ultimo commit che cancella o rinomina un file con quel nome
 *   altri nomi     tra i commit di `git log -S <nome>` (esclusi i .md), dal più recente: il
 *                  primo in cui il nome come parola intera c'era al padre e non c'è più
 *                  (env, identifier, symbol: parola; table: ultima parte nei file di schema;
 *                  endpoint: prefisso fisso come stringa; command: script nei package.json)
 * Si guardano al massimo MAX_CANDIDATES commit per claim. Nessun contenuto esce: solo hash e data.
 *
 * Tempi (0.6-z4): nel giro questa prova è l'80% del tempo (239 s su 338). Due correzioni:
 *   - `git log` si ferma alle prime MAX_CANDIDATES candidate (--max-count): le altre non si guardano;
 *   - la prova si ricorda per repo, commit, tipo e nome: lo stesso nome citato da più doc si prova una volta.
 */

import { RepoView } from './repo.mjs';
import { classifySpan } from './extract.mjs';
import { endpointPrefixes, isSchemaFile } from './check.mjs';

const MAX_CANDIDATES = 6;
const NOT_DOCS = ['.', ':(exclude,glob)**/*.md', ':(exclude,glob)**/*.mdx'];

function log(repo, args) {
  try {
    return repo.git(['log', `--max-count=${MAX_CANDIDATES}`, '--format=%h|%as', ...args]).split('\n').filter(Boolean).map((l) => {
      const [hash, date] = l.split('|');
      return { hash, date };
    });
  } catch {
    return [];
  }
}

function present(repo, rev, test) {
  try {
    return test(new RepoView(repo.root, rev).excludeCode(repo.codeExcludes));
  } catch {
    return false;
  }
}

// paths: limita la ricerca ai file indicati (al padre bastano i file toccati dal commit)
function wordAt(view, word, schemaOnly = false, paths = null) {
  const hits = view.grepMatches([word], { fixed: true, word: true, ...(paths ? { paths } : {}) });
  return schemaOnly ? hits.some((h) => isSchemaFile(h.path)) : hits.length > 0;
}

function literalAt(view, lit, paths = null) {
  return view.grepMatches([lit], { fixed: true, ...(paths ? { paths } : {}) }).length > 0;
}

function touchedFiles(repo, hash) {
  try {
    return repo.git(['show', '--name-only', '--format=', hash]).split('\n').filter((f) => f && !/\.mdx?$/i.test(f));
  } catch {
    return [];
  }
}

function scriptAt(view, name) {
  for (const f of view.listFiles().filter((p) => /(^|\/)package\.json$/.test(p) && !p.includes('node_modules'))) {
    try {
      if (name in (JSON.parse(view.readFile(f)).scripts || {})) return true;
    } catch {
      // package.json non valido
    }
  }
  return false;
}

/**
 * Primo commit (dal più recente) in cui il nome c'era al padre e non c'è più al commit.
 * test(view, paths): paths = file toccati dal commit (ricerca ridotta al padre), null = tutto.
 */
function firstRemoval(repo, candidates, test) {
  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    const files = touchedFiles(repo, c.hash);
    if (!files.length) continue;
    if (present(repo, `${c.hash}^`, (v) => test(v, files)) && !present(repo, c.hash, (v) => test(v, null))) return c;
  }
  return null;
}

/**
 * @param {RepoView} repo - repo del codice (con rev = commit di riferimento, o HEAD)
 * @param {{kind: string, key: string, claim?: string}} r - record di un claim not_found
 * @returns {{hash: string, date: string}|null}
 */
const CACHE = new Map();

export function verifiedCause(repo, r) {
  const k = [repo.root, repo.rev || 'HEAD', (repo.codeExcludes || []).map(String).join(','), r.kind, r.key, r.kind === 'command' ? r.claim : ''].join('\0');
  if (!CACHE.has(k)) CACHE.set(k, verifiedCauseSenzaCache(repo, r));
  return CACHE.get(k);
}

function verifiedCauseSenzaCache(repo, r) {
  const head = repo.rev || 'HEAD';
  if (r.kind === 'path') {
    const clean = r.key.replace(/^\.\//, '').replace(/\/+$/, '');
    const spec = clean.includes('/') ? [clean, `:(glob)**/${clean}`] : [`:(glob)**/${clean}`];
    const cands = log(repo, ['--diff-filter=DR', head, '--', ...spec]);
    const test = (v) => v.listFiles().some((f) => f === clean || f.endsWith('/' + clean)) || v.hasDir(clean);
    // per i path il commit cancella o rinomina: al padre si guarda l'albero intero
    for (const c of cands.slice(0, MAX_CANDIDATES)) {
      if (present(repo, `${c.hash}^`, test) && !present(repo, c.hash, test)) return c;
    }
    return null;
  }
  let key = r.key;
  let test;
  let specs = NOT_DOCS;
  if (r.kind === 'env' || r.kind === 'identifier' || r.kind === 'symbol') {
    test = (v, paths) => wordAt(v, key, false, paths);
  } else if (r.kind === 'table') {
    key = r.key.split('.').pop();
    test = (v, paths) => wordAt(v, key, true, paths);
  } else if (r.kind === 'endpoint') {
    const pref = endpointPrefixes(r.key).prefixes[0];
    if (!pref) return null;
    key = '/' + pref.join('/');
    test = (v, paths) => literalAt(v, key, paths);
  } else if (r.kind === 'command') {
    const c = classifySpan(r.claim || '');
    if (!c || c.runner !== 'package.json') return null;
    key = c.key;
    specs = [':(glob)**/package.json'];
    test = (v) => scriptAt(v, key);
  } else {
    return null;
  }
  const cands = log(repo, ['-S', key, head, '--', ...specs]);
  return firstRemoval(repo, cands, test);
}
