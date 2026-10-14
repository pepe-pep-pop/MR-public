/**
 * impact.mjs — indice inverso: quali doc e sezioni toccare dopo una modifica (PRD v0.6 R6).
 *
 * Bersagli: `--staged` (indice git), un commit, un intervallo `a..b`, un path.
 * Per ogni doc nello scope:
 *   - code_refs e ancore il cui path (o glob) corrisponde a un file toccato; con symbol,
 *     «simbolo toccato» se le righe cambiate cadono nel simbolo, altrimenti «file toccato»;
 *   - claim (R5): path che risolvono a un file toccato; nomi (env, simboli, tabelle) che
 *     compaiono nelle righe cambiate; endpoint il cui prefisso compare nelle righe cambiate.
 * Il contenuto del diff resta in memoria: nell'output solo path, righe e nomi.
 */

import { extractClaims } from './extract.mjs';
import { readCodeRefs } from './coderefs.mjs';
import { findSymbol } from './symbols.mjs';
import { endpointPrefixes, isSchemaFile } from './check.mjs';
import { readFrontmatter, historicalReason } from './frontmatter.mjs';
import { redactLine } from './drift.mjs';

const IDENT = /[A-Za-z_$][\w$]*/g;

/** analisi di un diff unificato -U0 */
export function parseDiff(text) {
  const files = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('--- ')) {
      // path vecchio: serve solo se il file viene cancellato (+++ /dev/null)
      const p = line.slice(4).replace(/^a\//, '');
      cur = p === '/dev/null' ? null : { path: p, ranges: [], tokens: new Set(), text: [], deleted: true };
      continue;
    }
    if (line.startsWith('+++ ')) {
      const p = line.slice(4).replace(/^b\//, '');
      if (p !== '/dev/null') {
        const prev = files.get(p);
        cur = prev || { path: p, ranges: [], tokens: new Set(), text: [] };
        cur.deleted = false;
      }
      // con /dev/null resta il record del path vecchio, marcato come cancellato
      if (cur) files.set(cur.path, cur);
      continue;
    }
    if (!cur) continue;
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h) {
      const start = Number(h[1]);
      const len = h[2] === undefined ? 1 : Number(h[2]);
      cur.ranges.push([start, Math.max(start, start + len - 1)]);
      // righe tolte e aggiunte per hunk, con il numero di riga nel file nuovo (0.6-u: numero di versione)
      (cur.hunks ||= []).push({ start, plus: [], minus: [] });
      continue;
    }
    if ((line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
      const body = line.slice(1);
      const hk = cur.hunks?.[cur.hunks.length - 1];
      if (hk) (line[0] === '+' ? hk.plus : hk.minus).push(body);
      cur.text.push(body);
      for (const t of body.match(IDENT) || []) if (t.length >= 3) cur.tokens.add(t);
    }
  }
  return files;
}

const TEXT_MAX = 120;

/** riga del doc per il report di impact: spazi compressi, redazione, al più TEXT_MAX caratteri */
export function lineText(line) {
  const red = redactLine(' ' + String(line || '').replace(/\s+/g, ' ').trim()).slice(1).trim();
  return red.length > TEXT_MAX ? `${red.slice(0, TEXT_MAX - 1)}…` : red;
}

const VERSION_LINE = /^(\s*)"version":\s*"[^"]*",?\s*$/;

/**
 * Il diff di package.json / package-lock.json cambia solo il numero di versione del pacchetto? (0.6-u)
 * In package.json conta solo la "version" in cima (rientro di 2 spazi); in package-lock.json la
 * "version" in cima e quella di packages[""]. Le versioni delle dipendenze sono un cambio vero.
 * @param {object} f - file di parseDiff
 * @param {string|null} content - contenuto nuovo del file
 */
export function versionOnly(f, content) {
  const base = f.path.split('/').pop();
  if (!['package.json', 'package-lock.json'].includes(base) || f.deleted || !f.hunks?.length || content === null) return false;
  const lines = content.split('\n');
  // la riga n (1-based) del file nuovo è la "version" del pacchetto?
  const isPackageVersion = (n) => {
    const m = (lines[n - 1] || '').match(VERSION_LINE);
    if (!m) return false;
    if (m[1] === '  ') return true; // in cima
    if (base !== 'package-lock.json') return false;
    // dentro packages[""]: il blocco aperto più vicino sopra, con rientro di 4, è `"": {`
    for (let i = n - 2; i >= 0; i--) {
      const open = lines[i].match(/^(\s*)"([^"]*)":\s*\{\s*$/);
      if (open && open[1].length < m[1].length) return open[1] === '    ' && open[2] === '' && m[1] === '      ';
    }
    return false;
  };
  return f.hunks.every((h) => h.plus.length === h.minus.length && h.plus.length > 0
    && h.minus.every((l) => VERSION_LINE.test(l))
    && h.plus.every((l, k) => isPackageVersion(h.start + k)));
}

/** quante volte compare `needle` (come parola, se è un identificatore) nelle righe */
function countIn(lines, needle) {
  const re = /^[A-Za-z_$][\w$]*$/.test(needle)
    ? new RegExp(`(?<![\\w$])${needle.replace(/[$]/g, '\\$')}(?![\\w$])`, 'g')
    : new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
  let n = 0;
  for (const l of lines) n += (l.match(re) || []).length;
  return n;
}

// token di un hunk: identificatori, con la riga (per l'adiacenza) — 0.6-w
const TOKEN = /[A-Za-z_$][\w$]*/g;
const MAX_LCS = 250000;

/** token cambiati di un hunk (diff a livello di token): per lato, l'insieme degli indici non in comune */
function tokenDiff(h) {
  if (h._td) return h._td;
  const a = h.minus.flatMap((l) => l.match(TOKEN) || []);
  const b = h.plus.flatMap((l) => l.match(TOKEN) || []);
  let ca = new Set(a.map((_, i) => i));
  let cb = new Set(b.map((_, i) => i));
  if (a.length && b.length && a.length * b.length <= MAX_LCS) {
    const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    ca = new Set(); cb = new Set();
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ca.add(i++);
      else cb.add(j++);
    }
    while (i < a.length) ca.add(i++);
    while (j < b.length) cb.add(j++);
  }
  h._td = { a, b, ca, cb };
  return h._td;
}

/**
 * Il nome cambia nel diff? (0.6-w, diff a livello di token) Conta se in un hunk:
 *   - compare un numero diverso di volte tra righe tolte e aggiunte (aggiunto, tolto), oppure
 *   - sta subito accanto a un token cambiato (stessa espressione: «where stato = 'eccezione' and
 *     aggiornata_il < …» → «where aggiornata_il < …» cambia il senso di aggiornata_il).
 * Un nome in una riga lunga cambiata altrove («const DEAL_PROPS = [ …, 'fonte_vip', 'owner',
 * ...RATE_PROPS]») non conta. Per stringhe non identificatori (endpoint, tabelle) vale il conteggio.
 */
export function nameChanged(f, needle) {
  if (!f.hunks?.length) return f.text.some((l) => countIn([l], needle) > 0);
  const ident = /^[A-Za-z_$][\w$]*$/.test(needle);
  return f.hunks.some((h) => {
    if (countIn(h.plus, needle) !== countIn(h.minus, needle)) return true;
    if (!ident) return false;
    const { a, b, ca, cb } = tokenDiff(h);
    const near = (seq, changed) => seq.some((t, i) => t === needle && (changed.has(i - 1) || changed.has(i + 1)));
    return near(a, ca) || near(b, cb);
  });
}

/** diff del bersaglio nel repo del codice */
export function targetDiff(repo, target) {
  if (target.staged) return { diff: repo.git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff']), newRev: ':' };
  if (target.range) {
    const [a, b] = target.range.split('..');
    return { diff: repo.git(['diff', '-U0', '--no-color', '--no-ext-diff', a, b || 'HEAD']), newRev: b || 'HEAD' };
  }
  if (target.commit) return { diff: repo.git(['show', '--format=', '-U0', '--no-color', '--no-ext-diff', target.commit]), newRev: target.commit };
  return null;
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

/**
 * Il path di un link o di un claim indica il file toccato?
 * Link (code_refs): path, glob o cartella. Claim: solo file, per evitare rumore — niente
 * prefissi di cartella, e un nome di file senza cartella solo se è unico nel repo.
 */
function pathMatches(key, touchedPath, repoName, { claim = false, basenameCount = null } = {}) {
  const isDir = key.endsWith('/');
  let k = key.replace(/^\.\//, '').replace(/\/+$/, '');
  const segs = k.split('/');
  const at = segs.lastIndexOf(repoName);
  if (at >= 0 && at < segs.length - 1) k = segs.slice(at + 1).join('/');
  if (k.includes('*')) return globToRegex(k).test(touchedPath);
  if (touchedPath === k) return true;
  if (claim) {
    if (isDir || !/\.[A-Za-z0-9]+$/.test(k)) return false;
    if (!k.includes('/')) return touchedPath.endsWith('/' + k) && basenameCount?.(k) === 1;
    return touchedPath.endsWith('/' + k);
  }
  return touchedPath.endsWith('/' + k) || touchedPath.startsWith(k + '/');
}

function overlaps(ranges, start, end) {
  return ranges.some(([a, b]) => a <= end && b >= start);
}

/**
 * Doc impattati.
 * @param {import('./repo.mjs').RepoView} docRepo
 * @param {string[]} docRels
 * @param {import('./repo.mjs').RepoView} codeRepo
 * @param {Map} touched - da parseDiff, oppure un path solo (file intero)
 * @param {string} newRev - rev da cui leggere il contenuto nuovo (':' = indice)
 */
/**
 * @param {object[]} [rules] - regole di mr.claims.ignore del repo dei doc: storico:<glob> marca i doc
 *        storici come nel giro e in scan (0.6-u)
 */
export function findImpacted(docRepo, docRels, codeRepo, touched, newRev, rules = []) {
  const repoName = codeRepo.root.split('/').pop();
  const sameRepo = docRepo.root === codeRepo.root;
  const out = [];
  const contentCache = new Map();
  const newContent = (p) => {
    if (!contentCache.has(p)) {
      let t = null;
      try {
        // newRev ':' = indice (staged): si legge con `git show :path`
        t = newRev === null ? codeRepo.readFile(p) : codeRepo.git(['show', newRev === ':' ? `:${p}` : `${newRev}:${p}`]);
      } catch {
        t = null;
      }
      contentCache.set(p, t);
    }
    return contentCache.get(p);
  };
  const touchedList = [...touched.values()];
  const allText = touchedList.map((f) => f.text.join('\n')).join('\n');
  let baseCounts = null;
  const basenameCount = (name) => {
    if (!baseCounts) {
      baseCounts = new Map();
      for (const f of codeRepo.listFiles()) {
        const b = f.split('/').pop();
        baseCounts.set(b, (baseCounts.get(b) || 0) + 1);
      }
    }
    return baseCounts.get(name) || 0;
  };

  for (const doc of docRels) {
    if (sameRepo && touched.has(doc)) continue; // il doc stesso cambiato non conta
    const text = docRepo.readFile(doc);
    const historical = historicalReason(doc, readFrontmatter(text), rules);
    const docLines = text.split('\n');
    // testo della riga del doc (0.6-u): accorciato, con la redazione di verify (segreti, email, telefoni)
    const push = (rec) => out.push({ doc, ...rec, text: lineText(docLines[rec.line - 1]), ...(historical ? { historical } : {}) });

    for (const ref of readCodeRefs(text).refs) {
      if (ref.repo && !sameRepo && !ref.repo.toLowerCase().endsWith('/' + repoName.toLowerCase())) continue;
      for (const f of touchedList) {
        if (!pathMatches(ref.path, f.path, repoName)) continue;
        let reason = f.deleted ? 'file del link cancellato' : 'file del link toccato';
        if (ref.symbol && !f.deleted) {
          const content = newContent(f.path);
          const sym = content === null ? null : findSymbol(content, ref.symbol, f.path);
          if (!sym) reason = 'simbolo del link non più trovato';
          // simbolo trovato come occorrenze (nessuna definizione): contano le sue righe, non
          // l'intervallo dalla prima all'ultima (0.6-o: altrimenti un cambio vicino a un altro nome
          // «tocca» tutti i nomi che compaiono sopra e sotto, mentre scan li dà ok)
          else if (f.whole || (sym.lines ? sym.lines.some((l) => overlaps(f.ranges, l, l)) : overlaps(f.ranges, sym.start, sym.end))) reason = 'simbolo del link toccato';
          else reason = 'file del link toccato (simbolo no)';
        }
        push({ line: ref.line, section: ref.section, via: ref.source === 'anchor' ? 'ancora' : 'code_refs', ref: ref.symbol ? `${ref.path}#${ref.symbol}` : ref.path, touched: f.path, reason });
      }
    }

    for (const c of extractClaims(text)) {
      let hit = null;
      if (c.kind === 'path') {
        const f = touchedList.find((t) => pathMatches(c.key, t.path, repoName, { claim: true, basenameCount }));
        if (f) hit = { touched: f.path, reason: f.deleted ? 'path citato: file cancellato' : 'path citato: file toccato' };
      } else if (c.kind === 'env' || c.kind === 'symbol' || c.kind === 'identifier') {
        const f = touchedList.find((t) => t.tokens.has(c.key) && nameChanged(t, c.key));
        if (f) hit = { touched: f.path, reason: 'nome citato nelle righe cambiate' };
      } else if (c.kind === 'table') {
        // testo esatto nelle righe cambiate, oppure l'ultima parte in un file di schema
        const last = c.parts[c.parts.length - 1];
        const f = touchedList.find((t) => t.text.some((l) => l.includes(c.key)) && nameChanged(t, c.key))
          || touchedList.find((t) => isSchemaFile(t.path) && t.tokens.has(last) && nameChanged(t, last));
        if (f) hit = { touched: f.path, reason: 'tabella/colonna citata nelle righe cambiate' };
      } else if (c.kind === 'endpoint') {
        const pref = endpointPrefixes(c.key).prefixes[0];
        const ep = pref ? '/' + pref.join('/') : null;
        if (ep && allText.includes(ep)) {
          const f = touchedList.find((t) => t.text.join('\n').includes(ep) && nameChanged(t, ep));
          if (f) hit = { touched: f.path, reason: 'endpoint citato nelle righe cambiate' };
        }
      }
      if (hit) push({ line: c.line, section: c.section, via: `claim ${c.kind}`, ref: c.text, ...hit });
    }

    // path dentro un comando tra backtick (0.6-u, rigioco di onboarding-c): «`ops/ci-command.sh
    // deploy <ver>`», «`scp ops/ci-command.sh …`» non sono claim, ma citano un file del repo
    const seen = new Set(out.filter((i) => i.doc === doc).map((i) => `${i.line}|${i.touched}`));
    let fence = false;
    let section = '';
    docLines.forEach((l, k) => {
      if (/^\s*(```|~~~)/.test(l)) fence = !fence;
      const h = !fence && l.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (h) section = `${h[1]} ${h[2]}`;
      if (/<!--\s*mr:ignore-claim\s*-->/.test(l)) return;
      // solo code span in linea: nei blocchi ci sono alberi di file ed esempi (i comandi dei blocchi
      // shell li legge già l'estrattore dei claim)
      if (fence) return;
      const spans = [...l.matchAll(/`([^`]*\s[^`]*)`/g)].map((m) => m[1]);
      for (const sp of spans) {
        for (const tok of sp.split(/[\s'"=:]+/)) {
          if (!/^[\w.@~-]*\/[\w./-]*\.[A-Za-z0-9]{1,5}$/.test(tok) || tok.includes('://')) continue;
          const f = touchedList.find((t) => pathMatches(tok, t.path, repoName, { claim: true, basenameCount }));
          if (!f || seen.has(`${k + 1}|${f.path}`)) continue;
          seen.add(`${k + 1}|${f.path}`);
          push({ line: k + 1, section, via: 'claim path', ref: tok, touched: f.path, reason: f.deleted ? 'path citato in un comando: file cancellato' : 'path citato in un comando: file toccato' });
        }
      }
    });
  }
  return out;
}
