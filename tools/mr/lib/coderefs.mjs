/**
 * coderefs.mjs — link doc → codice: `code_refs` nel frontmatter (R1) e ancore nel corpo (R2).
 *
 *   code_refs:
 *     - path: supabase/functions/sync-gcal/index.ts   # glob ammessi
 *       symbol: syncCalendar
 *       repo: acme/app-web
 *       section: "## Sincronizzazione"
 *       verified: { commit: 3f2a91c }                  # date opzionale (nota A3)
 *
 *   <!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=3f2a91c date=2026-10-03 -->
 *
 * Regola R2: se una sezione ha almeno un'ancora valgono le ancore; i code_refs del
 * frontmatter con `section` uguale a quella sezione non si usano. Gli altri code_refs
 * (senza section, o di sezioni senza ancore) valgono per il doc o per la loro sezione.
 *
 * Funzione pura: nessun I/O.
 */

import { readFrontmatter } from './frontmatter.mjs';

const ANCHOR = /<!--\s*mr:code\b([^>]*)-->/g;
const ATTR = /([a-z_]+)=("([^"]*)"|'([^']*)'|(\S+))/g;

/**
 * intervalli [inizio, fine) dei code span in linea della riga (`…`, ``…``): un'ancora lì dentro è
 * la sintassi citata in un testo, non un'ancora (0.6-w, giro 5: report/0.6-v/MR_scheda-tecnica.md:31)
 */
export function inlineCodeRanges(line) {
  const out = [];
  const re = /(`+)([\s\S]*?[^`])\1(?!`)/g;
  let m;
  while ((m = re.exec(line))) out.push([m.index, m.index + m[0].length]);
  return out;
}

function normSection(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

/** attributi di un'ancora: path, symbol, repo, verified */
export function parseAnchorAttrs(inner) {
  const out = {};
  for (const m of inner.matchAll(ATTR)) out[m[1]] = m[3] ?? m[4] ?? m[5];
  return out;
}

/**
 * Link effettivi di un doc.
 * @param {string} text - contenuto del doc
 * @returns {{ refs: Array<object>, errors: string[] }}
 */
export function readCodeRefs(text) {
  const errors = [];
  const fm = readFrontmatter(text);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // ancore, con riga e sezione
  const anchors = [];
  let section = '';
  let inFence = false;
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) section = `${h[1]} ${h[2]}`;
    const code = inlineCodeRanges(line);
    for (const m of line.matchAll(ANCHOR)) {
      if (code.some(([a, b]) => m.index >= a && m.index < b)) continue; // citata tra backtick
      const a = parseAnchorAttrs(m[1]);
      if (!a.path) {
        errors.push(`riga ${i + 1}: ancora mr:code senza path`);
        continue;
      }
      anchors.push({
        source: 'anchor',
        line: i + 1,
        section,
        path: a.path,
        ...(a.symbol ? { symbol: a.symbol } : {}),
        ...(a.repo ? { repo: a.repo } : {}),
        ...(a.verified ? { verified: { commit: a.verified, ...(a.date ? { date: a.date } : {}) } } : {}),
      });
    }
  }
  const anchoredSections = new Set(anchors.map((a) => normSection(a.section)));

  // code_refs del frontmatter
  const fmLine = Math.max(1, lines.findIndex((l) => /^code_refs\s*:/.test(l)) + 1);
  const fmRefs = [];
  if (fm.code_refs !== undefined && !Array.isArray(fm.code_refs)) errors.push('code_refs non è una lista');
  for (const [i, r] of (Array.isArray(fm.code_refs) ? fm.code_refs : []).entries()) {
    if (!r || typeof r !== 'object' || !r.path) {
      errors.push(`code_refs[${i}] senza path`);
      continue;
    }
    if (r.section && anchoredSections.has(normSection(r.section))) continue; // vale l'ancora
    const verified = r.verified && r.verified.commit ? { commit: String(r.verified.commit), ...(r.verified.date ? { date: String(r.verified.date) } : {}) } : undefined;
    fmRefs.push({
      source: 'frontmatter',
      index: i,
      line: fmLine,
      section: r.section ? normSection(r.section) : '',
      path: String(r.path),
      ...(r.symbol ? { symbol: String(r.symbol) } : {}),
      ...(r.repo ? { repo: String(r.repo) } : {}),
      ...(verified ? { verified } : {}),
    });
  }
  return { refs: [...fmRefs, ...anchors], errors, frontmatter: fm };
}
