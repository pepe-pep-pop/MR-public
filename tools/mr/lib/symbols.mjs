/**
 * symbols.mjs — risoluzione di un simbolo in un file (PRD v0.6 R4, livelli 2 e 3).
 *
 *   livello 2 «regex»: riga di definizione trovata con euristiche (function X, const X =,
 *     def X, class X, CREATE TABLE/FUNCTION/VIEW X, route app.get('/x'), Deno.serve) e
 *     fine del blocco per graffe (JS/TS/Swift/Go/SQL), indentazione (Python) o
 *     `;` / `$$` (SQL);
 *   livello 2 «occorrenze»: nessuna definizione, ma il nome compare (es. una variabile
 *     d'ambiente): il «corpo» sono le righe in cui compare;
 *   livello 3 «file»: il simbolo non c'è; chi chiama decide (missing o file intero).
 *
 * Il livello usato va sempre nel report. Funzioni pure: nessun I/O.
 */

import { definitionRegexes, escapeRe } from './lookup.mjs';

const MAX_LINES = 400;

function sqlRegexes(name) {
  const n = escapeRe(name);
  return [
    new RegExp(`create\\s+(?:or\\s+replace\\s+)?(?:table|view|materialized\\s+view|function|procedure|type|trigger|policy|index)\\s+(?:if\\s+not\\s+exists\\s+)?(?:[\\w"]+\\.)?"?${n}"?(?![\\w$])`, 'i'),
    new RegExp(`alter\\s+table\\s+(?:only\\s+)?(?:[\\w"]+\\.)?"?${n}"?(?![\\w$])`, 'i'),
  ];
}

function routeRegexes(symbol) {
  // "GET /api/x", "/api/x", "Deno.serve"
  const m = symbol.match(/^(?:(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+)?(\/\S*)$/i);
  if (m) {
    const method = m[1] ? m[1].toLowerCase() : '(?:get|post|put|patch|delete|head|options|all|use|route)';
    const p = escapeRe(m[2]);
    return [new RegExp(`\\.${method}\\s*\\(\\s*['"\`]${p}['"\`]`, 'i'), new RegExp(`['"\`]${p}['"\`]`)];
  }
  if (symbol === 'Deno.serve') return [/Deno\.serve\s*\(/];
  return [];
}

function lang(path) {
  const ext = (path.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
  if (ext === 'py') return 'python';
  if (ext === 'sql') return 'sql';
  return 'brace';
}

/** fine del blocco che inizia a `start` (indice 0-based), per graffe */
function braceEnd(lines, start) {
  let depth = 0;
  let opened = false;
  let inBlockComment = false;
  // prima che il corpo si apra, le graffe dentro () (parametri destrutturati) e dentro <> (tipi
  // come Promise<{ email: string }>) non sono il corpo (0.6-q: verificaIdToken finiva alla firma)
  let paren = 0;
  let angle = 0;
  // tipo di ritorno a oggetto dopo i parametri (0.6-u): «): { scelto: X; trovato: boolean } {» — una
  // graffa dopo «:», «|», «&», «,», «(», «<» o «=» (non «=>») è un tipo; il corpo è la graffa dopo
  // un nome, «)», «]», «>» o «}» chiuso
  let sawParams = false;
  let retType = false;
  let typeDepth = 0;
  let lastSig = '';
  for (let i = start; i < Math.min(lines.length, start + MAX_LINES); i++) {
    const line = lines[i];
    let quote = null;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      const next = line[j + 1];
      if (inBlockComment) {
        if (c === '*' && next === '/') { inBlockComment = false; j++; }
        continue;
      }
      if (quote) {
        if (c === '\\') { j++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === '/' && next === '/') break;
      if (c === '/' && next === '*') { inBlockComment = true; j++; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (!opened) {
        const prev = lastSig;
        if (!/\s/.test(c)) lastSig = c;
        if (c === '(') { paren++; continue; }
        if (c === ')') { paren = Math.max(0, paren - 1); if (paren === 0) sawParams = true; continue; }
        if (c === ':' && sawParams && paren === 0 && angle === 0 && typeDepth === 0) retType = true;
        if (retType && paren === 0 && angle === 0) {
          if (c === '{' && (typeDepth > 0 || /[:|&,(<]/.test(prev) || (prev === '=' && line[j - 1] !== '>'))) { typeDepth++; continue; }
          if (c === '}' && typeDepth > 0) { typeDepth--; lastSig = '}'; continue; }
          if (typeDepth > 0) continue;
        }
        if (c === '<' && /[\w$]/.test(line[j - 1] || '')) { angle++; continue; }
        if (c === '>' && angle > 0 && line[j - 1] !== '=') { angle--; continue; }
        // il corpo di una freccia passata come argomento: `.server(async ({ next }) => {`
        const dopoFreccia = c === '{' && /=>\s*$/.test(line.slice(0, j));
        if (c === '{' && (paren > 0 || angle > 0) && !dopoFreccia) continue;
        if (c === '}' && (paren > 0 || angle > 0)) continue;
      }
      if (c === '{') { depth++; opened = true; }
      else if (c === '}') {
        depth--;
        if (opened && depth <= 0) return i;
      }
    }
    // dichiarazione su una riga senza blocco (es. const X = 3;)
    if (!opened && i - start >= 15) return start;
    if (!opened && /;\s*$/.test(line)) return i;
  }
  return opened ? Math.min(lines.length, start + MAX_LINES) - 1 : start;
}

function pythonEnd(lines, start) {
  const indent = (lines[start].match(/^\s*/) || [''])[0].length;
  let end = start;
  for (let i = start + 1; i < Math.min(lines.length, start + MAX_LINES); i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if ((l.match(/^\s*/) || [''])[0].length <= indent) break;
    end = i;
  }
  return end;
}

function sqlEnd(lines, start) {
  let dollar = 0;
  for (let i = start; i < Math.min(lines.length, start + MAX_LINES); i++) {
    dollar += (lines[i].match(/\$[A-Za-z_]*\$/g) || []).length;
    if (dollar % 2 === 0 && /;\s*(--.*)?$/.test(lines[i])) return i;
  }
  return Math.min(lines.length, start + MAX_LINES) - 1;
}

/**
 * Trova il simbolo nel testo.
 * @returns {{ level: 'regex'|'occurrences', start: number, end: number, body: string, lines?: number[] } | null}
 *          start/end 1-based inclusivi
 */
export function findSymbol(text, symbol, path) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const isIdent = /^[A-Za-z_$][\w$]*$/.test(symbol);
  const kind = lang(path);
  const res = [
    ...(isIdent ? (kind === 'sql' ? sqlRegexes(symbol) : [...definitionRegexes(symbol), ...sqlRegexes(symbol)]) : []),
    ...routeRegexes(symbol),
  ];
  for (let i = 0; i < lines.length; i++) {
    if (!res.some((r) => r.test(lines[i]))) continue;
    const endIdx = kind === 'python' ? pythonEnd(lines, i) : kind === 'sql' ? sqlEnd(lines, i) : braceEnd(lines, i);
    return { level: 'regex', start: i + 1, end: endIdx + 1, body: lines.slice(i, endIdx + 1).join('\n') };
  }
  // nessuna definizione: righe in cui il nome compare come parola
  if (isIdent) {
    const word = new RegExp(`(?:^|[^\\w$])${escapeRe(symbol)}(?![\\w$])`);
    const idx = lines.map((l, i) => (word.test(l) ? i : -1)).filter((i) => i >= 0);
    if (idx.length) {
      return {
        level: 'occurrences',
        start: idx[0] + 1,
        end: idx[idx.length - 1] + 1,
        lines: idx.map((i) => i + 1),
        body: idx.map((i) => lines[i]).join('\n'),
      };
    }
  }
  return null;
}

/** corpo normalizzato per il confronto: spazi di fine riga e righe vuote ininfluenti */
export function normalizeBody(body) {
  return body
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .join('\n');
}
