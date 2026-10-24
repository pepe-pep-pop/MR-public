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
// 0.6-z34 (D): nomi che un file definisce (esportati, top-level in Python e Rust), rotte e variabili
// d'ambiente che legge. Un doc che li cita per nome è una pista in più.
const NOMI_GENERICI = new Set(['default', 'handler', 'main', 'config', 'index', 'router', 'app', 'server', 'client', 'types', 'props', 'utils', 'helpers', 'constants', 'state', 'error', 'result', 'value', 'data']);
export function nomiDefiniti(content) {
  const nomi = new Set();
  const rotte = new Set();
  const env = new Set();
  const add = (set, x) => { if (x && x.length >= 5 && !NOMI_GENERICI.has(x.toLowerCase())) set.add(x); };
  for (const m of content.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) add(nomi, m[1]);
  // funzioni dichiarate al primo livello, anche non esportate (scheduler.ts di onboarding-c)
  for (const m of content.matchAll(/^(?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)/gm)) add(nomi, m[1]);
  for (const m of content.matchAll(/^export\s*\{([^}]+)\}/gm)) for (const x of m[1].split(',')) add(nomi, x.trim().split(/\s+as\s+/).pop());
  for (const m of content.matchAll(/^(?:async\s+)?def\s+([A-Za-z_]\w*)|^class\s+([A-Za-z_]\w*)/gm)) if (!(m[1] || m[2]).startsWith('_')) add(nomi, m[1] || m[2]);
  for (const m of content.matchAll(/^\s*pub(?:\([^)]*\))?\s+(?:async\s+)?(?:fn|struct|enum|const|trait)\s+([A-Za-z_]\w*)/gm)) add(nomi, m[1]);
  for (const m of content.matchAll(/\.(?:get|post|put|patch|delete|all|use|route)\(\s*['"`](\/[^'"`\s]*)['"`]/g)) {
    // solo rotte di almeno due segmenti e senza *: `/admin`, `/health`, `/api/*` sono troppo comuni
    const r = m[1].replace(/\/+$/, '');
    if (!r.includes('*') && r.split('/').filter(Boolean).length >= 2) rotte.add(r);
  }
  for (const m of content.matchAll(/(?:process\.env\.|Deno\.env\.get\(\s*['"]|os\.environ(?:\.get)?\(?\[?\s*['"]|getenv\(\s*['"]|env::var\(\s*"|import\.meta\.env\.)([A-Z][A-Z0-9_]{3,})/g)) add(env, m[1]);
  return { nomi, rotte, env };
}

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

  // nomi definiti per file toccato (0.6-z34): con un diff solo quelli nelle righe cambiate
  const defCache = new Map();
  const definiti = (t) => {
    if (!defCache.has(t.path)) {
      const c = newContent(t.path);
      let d = null;
      if (c !== null) {
        d = nomiDefiniti(c);
        if (!t.whole) for (const k of ['nomi', 'rotte', 'env']) d[k] = new Set([...d[k]].filter((x) => t.tokens.has(x) || t.text.some((l) => l.includes(x))));
        if (!d.nomi.size && !d.rotte.size && !d.env.size) d = null;
      }
      defCache.set(t.path, d);
    }
    return defCache.get(t.path);
  };
  const sotto = new Map();
  const fileSotto = (dir) => {
    if (!sotto.has(dir)) sotto.set(dir, codeRepo.listFiles().filter((f) => f.startsWith(dir + '/')).length);
    return sotto.get(dir);
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

    // 0.6-z34 (D): nomi, rotte e variabili d'ambiente definiti o letti dal file toccato, citati nel doc.
    // Con un diff contano solo quelli che compaiono nelle righe cambiate; con un file intero, tutti.
    {
      let inBlocco = false;
      let sez = '';
      docLines.forEach((l, k) => {
        if (/^\s*(```|~~~)/.test(l)) { inBlocco = !inBlocco; return; }
        const hh = !inBlocco && l.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (hh) sez = `${hh[1]} ${hh[2]}`;
        if (inBlocco || /<!--\s*mr:ignore-claim\s*-->/.test(l)) return;
        const spans = [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
        for (const t of touchedList) {
          if (t.deleted || seen.has(`${k + 1}|${t.path}`)) continue;
          const d = definiti(t);
          if (!d) continue;
          let hit = null;
          for (const sp of spans) {
            const nome = sp.replace(/\(\)?$/, '').replace(/^.*\./, '');
            if (d.nomi.has(nome)) { hit = [sp, 'nome definito nel file citato']; break; }
            if (d.env.has(sp)) { hit = [sp, 'variabile d\'ambiente letta dal file citata']; break; }
          }
          if (!hit) for (const r of d.rotte) if (new RegExp(`(^|[\\s\`'"(])${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\\w+|\\\[[^\\]]+\\\]/g, '[^\\s/`]+')}(?=$|[\\s\`'")?/#,.:;])`).test(l)) { hit = [r, 'rotta definita nel file citata']; break; }
          if (!hit) continue;
          seen.add(`${k + 1}|${t.path}`);
          push({ line: k + 1, section: sez, via: 'riferimento', ref: hit[0], touched: t.path, reason: hit[1] });
        }
      });
    }

    // 0.6-z30 (F6): altri modi di citare un file, dalla prova degli strumenti: `percorso:riga`, link
    // markdown, percorsi nei blocchi di codice, cartella che contiene il file, nome del file da solo
    // (unico nel repo), cartella di un index.*. Il motivo dice quale, perché valga come pista.
    fence = false;
    section = '';
    const docDir = doc.includes('/') ? doc.slice(0, doc.lastIndexOf('/')) : '';
    docLines.forEach((l, k) => {
      if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
      const h = !fence && l.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (h) section = `${h[1]} ${h[2]}`;
      if (/<!--\s*mr:ignore-claim\s*-->/.test(l)) return;
      const cand = [];
      if (fence) {
        // solo righe a forma di comando (`python3 tools/x.py`): un path come prima parola è un albero di
        // file o un elenco (0.6-u), e non conta
        const toks = l.replace(/^[\s│├└─|*+-]+/, '').split(/[\s'"=,;()<>`|]+/).filter(Boolean);
        toks.slice(1).forEach((tok) => { if (/^[\w.@~-]*\/[\w./-]*\.[A-Za-z0-9]{1,5}$/.test(tok) && !tok.includes('://') && !tok.startsWith('#')) cand.push([tok, 'path in un comando di un blocco di codice']); });
      } else {
        for (const m of l.matchAll(/`([^`\s]+)`/g)) {
          const t = m[1];
          const conRiga = t.match(/^(.+?\.[A-Za-z0-9]{1,5})(?::\d+(?:[-:]\d+)?|#L\d+(?:-L?\d+)?)$/);
          if (conRiga) cand.push([conRiga[1], 'path:riga citato']);
          else if (/\/$/.test(t) || (t.includes('/') && !/\.[A-Za-z0-9]{1,5}$/.test(t))) cand.push([t, 'cartella citata: contiene il file']);
          else if (!t.includes('/') && /\.[A-Za-z0-9]{1,5}$/.test(t)) cand.push([t, 'nome del file citato']);
          else if (/^[a-z0-9][\w-]*[a-z0-9]$/i.test(t) && t.includes('-')) cand.push([t, 'cartella di un index.* citata']);
        }
        for (const m of l.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
          const t = m[1];
          if (/^[a-z]+:/i.test(t)) continue;
          const parti = [];
          for (const sg of (t.startsWith('/') ? t.slice(1) : (docDir ? docDir + '/' : '') + t).split('/')) {
            if (sg === '..') parti.pop(); else if (sg && sg !== '.') parti.push(sg);
          }
          cand.push([parti.join('/'), 'link markdown al file']);
        }
      }
      for (const [tok, motivo] of cand) {
        const f = touchedList.find((t) => {
          if (motivo === 'cartella citata: contiene il file') {
            const d = tok.replace(/^\.\//, '').replace(/\/+$/, '');
            if (d.split('/').filter(Boolean).length < 2 || !(t.path.startsWith(d + '/') || t.path.includes('/' + d + '/'))) return false;
            // solo una cartella piccola (al più 30 file): `supabase/functions/` in 90 doc è rumore
            return fileSotto(t.path.slice(0, t.path.indexOf(d) + d.length)) <= 30;
          }
          if (motivo === 'cartella di un index.* citata') return /(^|\/)index\.[a-z]+$/.test(t.path) && t.path.split('/').slice(-2)[0] === tok;
          if (motivo === 'nome del file citato') {
            if (/^(index|main|mod|lib|utils?|readme|package|config|setup)\./i.test(tok) || t.path.split('/').pop() !== tok) return false;
            // nome unico nel repo, oppure doc nella cartella del file o sopra (procedura.md accanto a raccogli.py)
            return basenameCount(tok) === 1 || (sameRepo && docDir !== '' && t.path.startsWith(docDir + '/'));
          }
          if (motivo === 'link markdown al file') return sameRepo ? t.path === tok : pathMatches(tok, t.path, repoName, { claim: true, basenameCount });
          return pathMatches(tok, t.path, repoName, { claim: true, basenameCount });
        });
        if (!f || seen.has(`${k + 1}|${f.path}`)) continue;
        seen.add(`${k + 1}|${f.path}`);
        push({ line: k + 1, section, via: 'riferimento', ref: tok, touched: f.path, reason: f.deleted ? `${motivo} (file cancellato)` : motivo });
      }
    });
  }
  return out;
}
