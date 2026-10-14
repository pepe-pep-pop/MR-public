/**
 * suggest.mjs — proposta deterministica di link doc → codice (PRD v0.6 R8, nota A12).
 *
 * Parte dai claim `found` di R5 e propone, sezione per sezione, ancore
 * `<!-- mr:code path=… symbol=… -->` da inserire subito sotto il titolo della sezione.
 *
 * Ancoraggio di default alla FUNZIONE (A12):
 *   - simbolo citato e definito → path del file che lo definisce + symbol;
 *   - tabella, endpoint, variabile d'ambiente → file + symbol (tabella, "METODO /path", nome);
 *   - file citato → un simbolo della stessa sezione che si risolve in quel file;
 *     se nessuno si risolve, il file intero, e l'ancora lo dice: `livello=file`.
 *   - soggetto del titolo: un nome tra backtick nel titolo della sezione che corrisponde a
 *     una cartella o a un file del repo (es. `create-cc-booking`) → il suo file d'ingresso.
 *     Eccezione A13: se il file È quella funzione (index di una funzione serverless, o file
 *     con una sola funzione esportata) il link è al file intero, dichiarato come tale;
 *     altrimenti si ancora a un simbolo che si risolve (Deno.serve, …);
 *   - README nella cartella di una funzione (functions/<nome>/README.md, nota A19) → l'index
 *     di quella cartella, sotto il titolo principale (file intero: il file è la funzione);
 *   - nomi in maiuscolo (variabili d'ambiente, codici): solo se compaiono in un file solo o
 *     dentro la cartella del soggetto del titolo, altrimenti il link sarebbe a caso.
 * Niente `verified`: il link proposto non è una verifica (la fa `mr verify`, R7).
 * Non si propongono link già presenti (stessa sezione, path e simbolo), né nei doc storici.
 */

import { readCodeRefs } from './coderefs.mjs';
import { findSymbol } from './symbols.mjs';
import { remoteSlug } from './drift.mjs';

function quoteAttr(v) {
  return /[\s"'<>]/.test(v) ? `"${v.replace(/"/g, "'")}"` : v;
}

export function anchorFor(p) {
  const attrs = [`path=${quoteAttr(p.path)}`];
  if (p.symbol) attrs.push(`symbol=${quoteAttr(p.symbol)}`);
  if (p.repo) attrs.push(`repo=${p.repo}`);
  if (p.level === 'file' || p.level === 'file-funzione') attrs.push('livello=file');
  return `<!-- mr:code ${attrs.join(' ')} -->`;
}

function normSection(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

/** identificatori citati da soli tra backtick (`calcolaQuota`, `syncCalendar()`), per sezione */
export function sectionIdentifiers(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out = new Map();
  let section = '';
  let inFence = false;
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) section = normSection(`${h[1]} ${h[2]}`);
    for (const m of lines[i].matchAll(/`([A-Za-z_$][\w$]{2,})(?:\(\))?`/g)) {
      if (!out.has(section)) out.set(section, new Set());
      out.get(section).add(m[1]);
    }
  }
  return out;
}

const ENTRY_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.mjs', 'mod.ts', 'main.ts', 'main.py', '__init__.py'];

/** nomi tra backtick nel titolo della sezione */
function headingSubjects(section) {
  return [...String(section).matchAll(/`([A-Za-z0-9_.$-]{3,})`/g)].map((m) => m[1].replace(/\(\)$/, ''));
}

const FUNCTION_DIRS = new Set(['functions', 'edge-functions', 'api', 'handlers', 'lambdas']);

/**
 * Il file È la funzione (nota A13)? Sì se è l'index di una cartella-funzione dentro una
 * cartella di funzioni (supabase/functions/<nome>/index.ts, netlify/functions/<nome>/…), o se
 * esporta una sola funzione.
 */
export function fileIsTheFunction(path, text) {
  const segs = path.split('/');
  if (segs.length >= 3 && /^index\.[cm]?[jt]sx?$/.test(segs[segs.length - 1]) && FUNCTION_DIRS.has(segs[segs.length - 3])) return 'index di una funzione';
  if (text) {
    const fnExports = (text.match(/^export\s+(?:default\s+)?(?:async\s+)?function\b|^export\s+const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>|^export\s+default\s+(?:async\s*)?\(/gm) || []).length;
    if (fnExports === 1) return 'una sola funzione esportata';
  }
  return null;
}

/** file d'ingresso per un soggetto: cartella con quel nome (index.*), o file con quel nome */
function subjectTargets(repo, name) {
  const files = repo.listFiles();
  const dirs = [...repo.listDirs()].filter((d) => d.split('/').pop() === name);
  const out = [];
  for (const d of dirs) {
    const entry = ENTRY_FILES.map((f) => `${d}/${f}`).find((f) => files.includes(f));
    if (entry) out.push({ path: entry, dir: d });
  }
  for (const f of files) {
    const base = f.split('/').pop();
    if (base.replace(/\.[^.]+$/, '') === name && !/\.mdx?$/i.test(base)) out.push({ path: f, dir: f.split('/').slice(0, -1).join('/') });
  }
  return out.length <= 2 ? out : []; // troppi omonimi: nessuna proposta
}

/**
 * Proposte per un doc.
 * @param {string} text - contenuto del doc
 * @param {Array<object>} records - record di checkDocs per questo doc
 * @param {(name: string) => object|null} repoByName - RepoView dal nome (code_repo dei record)
 * @param {object} defaultRepo - primo repo del codice per il doc
 * @returns {Array<{section: string, path: string, symbol?: string, repo?: string, level: string, reason: string, from: string}>}
 */
/**
 * README dentro la cartella di una funzione (nota A19): ritorna il file d'ingresso della
 * cartella, se la cartella sta dentro una cartella di funzioni e l'index esiste.
 */
export function readmeFunctionTarget(docRel, repo) {
  if (!docRel) return null;
  const segs = docRel.split('/');
  if (!/^readme\.md$/i.test(segs[segs.length - 1]) || segs.length < 3) return null;
  if (!FUNCTION_DIRS.has(segs[segs.length - 3])) return null;
  const dir = segs.slice(0, -1).join('/');
  const files = repo.listFiles();
  const entry = ENTRY_FILES.map((f) => `${dir}/${f}`).find((f) => files.includes(f));
  return entry ? { path: entry, name: segs[segs.length - 2] } : null;
}

/** sezione del titolo principale (primo # di livello 1), o '' se non c'è */
function mainSection(text) {
  const m = text.replace(/\r\n?/g, '\n').match(/^#\s+(.+?)\s*#*\s*$/m);
  return m ? normSection(`# ${m[1]}`) : '';
}

export function proposeLinks(text, records, repoByName, defaultRepo, docRel = null) {
  const existing = readCodeRefs(text).refs.map((r) => `${normSection(r.section)}|${r.path}|${r.symbol || ''}`);
  const bySection = new Map();
  for (const r of records) {
    if (r.status !== 'found' || r.historical) continue;
    // link solo verso il codice: i legami doc ↔ doc sono di mr-scanner
    if (r.evidence?.[0]?.path && /\.mdx?$/i.test(r.evidence[0].path)) continue;
    const s = normSection(r.section);
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s).push(r);
  }

  const contentCache = new Map();
  const content = (repo, path) => {
    const k = `${repo.root}|${path}`;
    if (!contentCache.has(k)) {
      let t = null;
      try {
        t = repo.git(['show', `${repo.rev || 'HEAD'}:${path}`]);
      } catch {
        t = null;
      }
      contentCache.set(k, t);
    }
    return contentCache.get(k);
  };
  const resolves = (repo, path, symbol, allowOccurrences = false) => {
    const t = content(repo, path);
    if (t === null) return false;
    const s = findSymbol(t, symbol, path);
    return !!s && (s.level === 'regex' || allowOccurrences);
  };

  const idents = sectionIdentifiers(text);
  // anche le sezioni senza claim trovati, se il titolo nomina un soggetto (`create-cc-booking`)
  for (const m of text.replace(/\r\n?/g, '\n').matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)) {
    const sec = normSection(`${m[1]} ${m[2]}`);
    if (headingSubjects(sec).length && !bySection.has(sec)) bySection.set(sec, []);
  }
  const out = [];
  // README nella cartella di una funzione (A19): link al suo index, sotto il titolo principale
  const readme = readmeFunctionTarget(docRel, defaultRepo);
  if (readme) {
    const sec = mainSection(text);
    const key = `${sec}|${readme.path}|`;
    if (!existing.includes(key) && !existing.some((e) => e.split('|')[1] === readme.path)) {
      out.push({ section: sec, path: readme.path, level: 'file-funzione', reason: `README nella cartella della funzione \`${readme.name}\`: il file è la funzione (nota A19)`, from: 'posizione del README' });
    }
  }
  for (const [section, recs] of bySection) {
    const proposals = [];
    // candidati per ancorare un file alla funzione: simboli e variabili citati nella sezione,
    // più gli identificatori citati da soli tra backtick (mai pezzi di path)
    const candidates = [...new Set([
      ...recs.filter((r) => r.kind === 'symbol' || r.kind === 'env').map((r) => r.key),
      ...(idents.get(section) || []),
    ])];

    // soggetto del titolo → file d'ingresso
    const subjectDirs = [];
    for (const name of headingSubjects(section)) {
      for (const t of subjectTargets(defaultRepo, name)) {
        subjectDirs.push(t.dir);
        const isFn = fileIsTheFunction(t.path, content(defaultRepo, t.path));
        if (isFn) {
          proposals.push({ section, path: t.path, level: 'file-funzione', reason: `il file è la funzione \`${name}\` (${isFn}): file intero, eccezione A13`, from: 'titolo' });
          continue;
        }
        const sym = ['Deno.serve', ...candidates].find((id) => resolves(defaultRepo, t.path, id));
        proposals.push(sym
          ? { section, path: t.path, symbol: sym, level: 'funzione', reason: `titolo della sezione: \`${name}\``, from: `titolo` }
          : { section, path: t.path, level: 'file', reason: `file intero: titolo della sezione \`${name}\`, nessun simbolo si risolve`, from: 'titolo' });
      }
    }

    for (const r of recs) {
      const repo = (r.code_repo && repoByName(r.code_repo)) || defaultRepo;
      const repoAttr = repo !== defaultRepo ? remoteSlug(repo) || undefined : undefined;
      const ev = r.evidence?.[0];
      if (!ev) continue;
      const push = (p) => proposals.push({ section, ...(repoAttr ? { repo: repoAttr } : {}), from: `${r.kind} \`${r.claim}\` (riga ${r.line})`, ...p });

      if (r.kind === 'symbol' && ev.line) {
        push({ path: ev.path, symbol: r.key, level: 'funzione', reason: 'simbolo citato, definizione trovata' });
      } else if (r.kind === 'env' && ev.line) {
        // solo se il file è uno solo, o sta nella cartella del soggetto del titolo
        const code = r.evidence.filter((e) => !/\.env\.(example|sample|template)$/.test(e.path));
        const inSubject = code.find((e) => subjectDirs.some((d) => e.path.startsWith(d + '/')));
        const files = new Set(code.map((e) => e.path));
        const pick = inSubject || (files.size === 1 ? code[0] : null);
        if (pick) push({ path: pick.path, symbol: r.key, level: 'funzione', reason: 'nome in maiuscolo: righe in cui compare' });
      } else if (r.kind === 'table' && ev.line) {
        const sym = [...r.key.split('.')].reverse().find((part) => resolves(repo, ev.path, part));
        if (sym) push({ path: ev.path, symbol: sym, level: 'funzione', reason: 'tabella/colonna, definizione trovata' });
        else push({ path: ev.path, level: 'file', reason: 'file intero: la tabella non si risolve come definizione' });
      } else if (r.kind === 'endpoint' && ev.line) {
        const sym = r.claim.replace(/\s+/g, ' ');
        if (resolves(repo, ev.path, sym)) push({ path: ev.path, symbol: sym, level: 'funzione', reason: 'route trovata' });
        else push({ path: ev.path, level: 'file', reason: 'file intero: la route non si risolve come blocco' });
      } else if (r.kind === 'path' && ev.path && !ev.path.endsWith('/')) {
        const sym = candidates.find((id) => resolves(repo, ev.path, id));
        if (sym) push({ path: ev.path, symbol: sym, level: 'funzione', reason: `file citato, ancorato a ${sym} citato nella sezione` });
        else push({ path: ev.path, level: 'file', reason: 'file intero: nessun simbolo della sezione si risolve in questo file' });
      }
    }

    // dedup: stessa coppia path/simbolo una volta; il file intero cade se c'è già un simbolo dello stesso file
    const seen = new Set();
    const symbolPaths = new Set(proposals.filter((p) => p.symbol).map((p) => p.path));
    for (const p of proposals) {
      const key = `${section}|${p.path}|${p.symbol || ''}`;
      if (seen.has(key) || existing.includes(key)) continue;
      if (!p.symbol && (symbolPaths.has(p.path) || existing.some((e) => e.startsWith(`${section}|${p.path}|`)))) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out;
}

/** testo del doc con le ancore proposte inserite sotto il titolo di ogni sezione */
export function insertAnchors(text, proposals) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let bodyStart = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) bodyStart = end + 1;
  }
  const bySection = new Map();
  for (const p of proposals) {
    if (!bySection.has(p.section)) bySection.set(p.section, []);
    bySection.get(p.section).push(anchorFor(p));
  }
  // posizione di inserimento: dopo la riga del titolo (fuori dai blocchi di codice)
  const inserts = new Map();
  let inFence = false;
  for (let i = bodyStart; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h = lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      const sec = normSection(`${h[1]} ${h[2]}`);
      if (bySection.has(sec) && !inserts.has(sec)) inserts.set(sec, i);
    }
  }
  const out = [];
  if (bySection.has('')) {
    out.push(...lines.slice(0, bodyStart), ...bySection.get(''));
  } else {
    out.push(...lines.slice(0, bodyStart));
  }
  const at = new Map([...inserts.entries()].map(([sec, i]) => [i, sec]));
  for (let i = bodyStart; i < lines.length; i++) {
    out.push(lines[i]);
    if (at.has(i)) out.push(...bySection.get(at.get(i)));
  }
  return out.join(eol);
}
