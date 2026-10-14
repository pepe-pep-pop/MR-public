/**
 * drift.mjs — deriva dei link doc → codice via git (PRD v0.6 R3, R4, R10 minimo).
 *
 * Esiti per ogni code_ref:
 *   ok           nessun cambiamento del codice referenziato dopo verified
 *   drift        il codice è cambiato (commit + diff ridotto al simbolo)
 *   moved        file rinominato o simbolo spostato in un altro file
 *   missing      file o simbolo non esistono più
 *   unverified   verified assente: link dichiarato ma mai controllato
 *   unresolvable repo non disponibile in locale, o commit di verified non presente
 *
 * Tutto in lettura via git (rev-parse, cat-file, log, diff, show), senza checkout.
 * Nel report: hash e data dei commit (oggetti solo con `subjects`), diff troncato a
 * MAX_DIFF righe, con le righe che sembrano segreti o email sostituite (N4).
 */

import { findSymbol, normalizeBody } from './symbols.mjs';
import { Lookup } from './lookup.mjs';
import { isSchemaFile } from './check.mjs';

const MAX_DIFF = 40;
const MAX_COMMITS = 10;

// Oscuramento dei segreti (0.6-t, regola ibrida chiesta dal maintainer):
//   - un nome da segreto (password, secret, token, api key, credential, …) che riceve un LETTERALE
//     (tra virgolette, o una parola nuda dopo = o :) si oscura sempre, a qualunque lunghezza:
//     «password: hunter», «DB_PASSWORD=ciao2024», «secret = 'x'»;
//   - non si oscura se il valore è un tipo, una chiamata, un accesso a proprietà, un template con
//     ${…}, un segnaposto <…>, un'espressione o un confronto («idToken: string,»,
//     «clientSecret = process.env.X», «sessionSecret!.length < 32»);
//   - i valori con la forma di una chiave si oscurano qualunque sia il nome.
const SECRET_NAME = /(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|credential|bearer|authorization)/i;
// nome (con prefissi/suffissi) seguito da : o = di assegnazione (non ==, !=, <=, >=, =>, ::)
const ASSIGN = /([A-Za-z_$][\w$-]*)["']?\s*(?::(?!:)|(?<![=!<>])=(?![=>]))\s*(.*)$/;
const TYPES = /^(?:string|number|boolean|bigint|any|unknown|never|void|null|undefined|object|symbol|true|false|nan|none)$/i;

/** la riga assegna un letterale a un nome da segreto? (vedi la regola sopra) */
function secretAssignment(line) {
  // tutte le coppie nome : / = valore della riga, non solo la prima («Per provare: … password: x.»)
  const re = new RegExp(ASSIGN.source.replace(/\(\.\*\)\$$/, ''), 'g');
  let m;
  while ((m = re.exec(line))) {
    if (!SECRET_NAME.test(m[1])) continue;
    const rest = line.slice(m.index + m[0].length);
    const q = rest[0];
    if (q === '"' || q === "'" || q === '`') {
      const end = rest.indexOf(q, 1);
      const inner = end > 0 ? rest.slice(1, end) : rest.slice(1);
      if (!inner) continue; // stringa vuota
      if (q === '`' && inner.includes('${')) continue; // template calcolato
      if (/^<[^>]*>$/.test(inner)) continue; // segnaposto tra virgolette
      // un URL senza credenziali non è un segreto (token_endpoint: "https://…/token"); con credenziali
      // lo prende la regola degli URL qui sotto
      if (/^[a-z][a-z0-9+.-]*:\/\/[^\s@]*$/i.test(inner)) continue;
      return true;
    }
    if (rest[0] === '<') continue; // segnaposto <…>
    // parola nuda: deve chiudere la clausola (fine riga, separatore, punto finale, commento)
    const t = rest.match(/^([^\s,;)}\]]+?)\.?(?=$|\s*[,;)}\]]|\s+(?:\/\/|#)|\s*$)/);
    if (!t) continue;
    const v = t[1];
    if (/[()<>=!|&?[\]{}]/.test(v) || v.includes('.')) continue; // chiamata, proprietà, espressione, tipo composto
    if (TYPES.test(v)) continue; // tipo o costante del linguaggio
    if (/^[A-Z][a-z]+(?:[A-Z0-9][a-z0-9]*)*$/.test(v)) continue; // tipo in PascalCase (Uint8Array, Buffer, Date)
    if (/^\d+$/.test(v) && !/passw|pwd|pin/i.test(m[1])) continue; // numero (maxTokens: 1000), salvo password
    if (/^(?:await|new|typeof|this|self|env)$/i.test(v)) continue;
    return true;
  }
  return false;
}

const SECRET_LINE = [
  // Bearer seguito da un valore letterale
  /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  // forme note di chiavi e token, e credenziali in un URL
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}|\bghp_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|\bpat-[a-z0-9]{2,4}-[a-f0-9-]{20,}|\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i,
];

// stringa lunga e compatta (40+) con la forma di un hash o di una chiave: lettere e cifre insieme,
// pochi separatori. Non i righelli dei commenti (-----), non le classi CSS o le variabili
// --radix-…-height (niente cifre), non i path di un'API (/crm/v4/…: troppi separatori)
function compactKey(line) {
  // il digest di un'immagine (image: x@sha256:…) è pubblico, non un segreto
  const scan = line.replace(/@sha256:[0-9a-f]{64}\b/gi, '@sha256:');
  for (const run of scan.match(/[A-Za-z0-9+/_=-]{40,}/g) || []) {
    if (!/\d/.test(run) || !/[A-Za-z]/.test(run)) continue;
    if ((run.match(/[-/_]/g) || []).length > 3) continue;
    return true;
  }
  return false;
}
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// cellulari italiani (nota A10): 3xx + 6-7 cifre, con o senza +39 / 0039, con spazi,
// punti o trattini tra i gruppi; non dentro numeri più lunghi
const PHONE_IT = /(?<![\d+])(?:(?:\+|00)\s?39[\s.-]?)?3\d{2}(?:[\s.-]?\d){6,7}(?!\d)/g;

/** oscura una riga di diff o un oggetto di commit: segreti (riga intera), email, telefoni */
export function redactLine(line) {
  if (secretAssignment(line) || compactKey(line) || SECRET_LINE.some((re) => re.test(line))) return line.slice(0, 1) + ' [riga omessa: possibile segreto]';
  return line.replace(EMAIL, '[email]').replace(PHONE_IT, '[telefono]');
}

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** diff di righe minimale (LCS), per corpi di simboli piccoli */
export function lineDiff(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 400 * 400) {
    return ['@@ corpo troppo lungo per il diff ridotto: vedi git diff @@'];
  }
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
    else if (j < y.length && (i >= x.length || dp[i][j + 1] >= dp[i + 1][j])) out.push('+' + y[j++]);
    else out.push('-' + x[i++]);
  }
  return out;
}

function truncate(lines) {
  const red = lines.map(redactLine);
  return red.length > MAX_DIFF ? [...red.slice(0, MAX_DIFF), `… (${red.length - MAX_DIFF} righe omesse)`] : red;
}

/** "owner/repo" dal remote origin (https o ssh), minuscolo, senza .git */
export function remoteSlug(repo) {
  try {
    const url = repo.git(['remote', 'get-url', 'origin']).trim();
    const m = url.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/);
    return m ? m[1].toLowerCase() : null;
  } catch {
    return null;
  }
}

export class DriftContext {
  /**
   * @param {import('./repo.mjs').RepoView} defaultRepo - repo del codice di default
   * @param {import('./repo.mjs').RepoView[]} repos - tutti i repo di codice disponibili
   * @param {{ subjects?: boolean }} opts
   */
  constructor(defaultRepo, repos, opts = {}) {
    this.defaultRepo = defaultRepo;
    this.repos = repos;
    this.subjects = !!opts.subjects;
    this._slugs = new Map();
    this._lookups = new Map();
  }

  repoFor(ref) {
    if (!ref.repo) return this.defaultRepo;
    const want = ref.repo.toLowerCase();
    for (const r of this.repos) {
      if (!this._slugs.has(r.root)) this._slugs.set(r.root, remoteSlug(r));
      const slug = this._slugs.get(r.root);
      if (slug === want || (slug && slug.split('/')[1] === want.split('/')[1] && r.root.split('/').pop().toLowerCase() === want.split('/')[1])) return r;
    }
    return null;
  }

  lookup(repo) {
    if (!this._lookups.has(repo.root)) this._lookups.set(repo.root, new Lookup(repo, isSchemaFile));
    return this._lookups.get(repo.root);
  }
}

/** HEAD del repo di codice (rev della vista o HEAD) */
function headRev(repo) {
  return repo.rev || 'HEAD';
}

function commitExists(repo, commit) {
  try {
    repo.git(['cat-file', '-e', `${commit}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function commitsTouching(repo, from, to, paths, subjects) {
  const fmt = subjects ? '%h|%as|%s' : '%h|%as';
  const out = repo.git(['log', `--format=${fmt}`, `${from}..${to}`, '--', ...paths]).trim();
  if (!out) return [];
  return out.split('\n').slice(0, MAX_COMMITS).map((l) => {
    const [hash, date, ...rest] = l.split('|');
    return subjects ? { hash, date, subject: redactLine(rest.join('|')) } : { hash, date };
  });
}

function readAt(repo, rev, path) {
  try {
    return repo.git(['show', `${rev}:${path}`]);
  } catch {
    return null;
  }
}

function renamedTo(repo, from, to, path) {
  const out = repo.git(['diff', '-M50%', '--name-status', '--diff-filter=R', from, to]).trim();
  for (const line of out.split('\n')) {
    const [st, oldP, newP] = line.split('\t');
    if (st && st.startsWith('R') && oldP === path) return newP;
  }
  return null;
}

/**
 * Valuta un code_ref. Ritorna { status, level, path, symbol, repo, verified, commits?, diff?, note?, moved_to? }.
 */
export function evaluateRef(ref, ctx) {
  const base = {
    path: ref.path,
    ...(ref.symbol ? { symbol: ref.symbol } : {}),
    ...(ref.repo ? { repo: ref.repo } : {}),
    ...(ref.verified ? { verified: ref.verified.commit } : {}),
  };
  const repo = ctx.repoFor(ref);
  if (!repo) return { ...base, status: 'unresolvable', level: 'n/a', note: `repo ${ref.repo} non disponibile in locale (usa --code-repo)` };
  const head = headRev(repo);
  const files = repo.listFiles();
  base.code_repo = repo.root.split('/').pop();

  // ── glob: solo a livello di file ──
  if (ref.path.includes('*')) {
    const re = globToRegex(ref.path);
    const matched = files.filter((f) => re.test(f));
    if (!matched.length) return { ...base, status: 'missing', level: 'glob', note: 'nessun file corrisponde al glob' };
    if (!ref.verified) return { ...base, status: 'unverified', level: 'glob', note: `${matched.length} file corrispondono` };
    if (!commitExists(repo, ref.verified.commit)) return { ...base, status: 'unresolvable', level: 'glob', note: `commit ${ref.verified.commit} non presente nel repo` };
    const commits = commitsTouching(repo, ref.verified.commit, head, [`:(glob)${ref.path}`], ctx.subjects);
    return commits.length ? { ...base, status: 'drift', level: 'glob', commits } : { ...base, status: 'ok', level: 'glob' };
  }

  // ── file presente? ──
  let path = ref.path;
  let movedTo = null;
  if (!files.includes(path)) {
    if (ref.verified && commitExists(repo, ref.verified.commit)) movedTo = renamedTo(repo, ref.verified.commit, head, path);
    if (!movedTo && ref.symbol) {
      const defs = ctx.lookup(repo).definition(ref.symbol);
      if (defs.length) return { ...base, status: 'moved', level: 'regex', moved_to: defs[0].path, note: 'file non più presente; simbolo definito altrove' };
    }
    if (!movedTo) return { ...base, status: 'missing', level: 'file', note: 'file non più presente' };
    path = movedTo;
  }

  const textHead = readAt(repo, head, path) ?? '';
  let symHead = null;
  if (ref.symbol) {
    symHead = findSymbol(textHead, ref.symbol, path);
    // per funzioni, classi, tabelle ci si aspetta una definizione; per nomi tipo
    // variabile d'ambiente bastano le occorrenze
    const occurrencesEnough = /^[A-Z][A-Z0-9_]+$/.test(ref.symbol) || !/^[A-Za-z_$][\w$]*$/.test(ref.symbol);
    if (!symHead || (symHead.level === 'occurrences' && !occurrencesEnough)) {
      const defs = ctx.lookup(repo).definition(ref.symbol).filter((d) => d.path !== path);
      if (defs.length) return { ...base, status: 'moved', level: 'regex', moved_to: defs[0].path, note: 'simbolo definito in un altro file' };
      if (!symHead) return { ...base, status: 'missing', level: 'file', note: `simbolo ${ref.symbol} non trovato` };
      // definizione sparita ma nome ancora usato nel file: si confrontano le occorrenze
    }
  }
  if (movedTo) {
    return { ...base, status: 'moved', level: symHead ? symHead.level : 'file', moved_to: movedTo, note: 'file rinominato' };
  }
  if (!ref.verified) {
    return { ...base, status: 'unverified', level: symHead ? symHead.level : 'file', ...(symHead ? { lines: [symHead.start, symHead.end] } : {}) };
  }
  if (!commitExists(repo, ref.verified.commit)) {
    return { ...base, status: 'unresolvable', level: 'n/a', note: `commit ${ref.verified.commit} non presente nel repo` };
  }

  const commits = commitsTouching(repo, ref.verified.commit, head, [path], ctx.subjects);
  if (!commits.length) return { ...base, status: 'ok', level: symHead ? symHead.level : 'file' };

  if (symHead) {
    const textOld = readAt(repo, ref.verified.commit, path);
    const symOld = textOld === null ? null : findSymbol(textOld, ref.symbol, path);
    if (symOld && normalizeBody(symOld.body) === normalizeBody(symHead.body)) {
      return { ...base, status: 'ok', level: symHead.level, note: `il file è cambiato (${commits.length} commit), il simbolo no` };
    }
    const diff = symOld ? lineDiff(normalizeBody(symOld.body), normalizeBody(symHead.body)) : ['@@ simbolo assente al commit verificato @@'];
    return { ...base, status: 'drift', level: symHead.level, lines: [symHead.start, symHead.end], commits, diff: truncate(diff) };
  }

  const diff = repo.git(['diff', '--no-color', '-U1', ref.verified.commit, head, '--', path]).split('\n')
    .filter((l) => (l.startsWith('+') || l.startsWith('-') || l.startsWith('@@')) && !l.startsWith('+++') && !l.startsWith('---'));
  return { ...base, status: 'drift', level: 'file', commits, diff: truncate(diff) };
}
