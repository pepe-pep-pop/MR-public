/**
 * frontmatter.mjs — frontmatter YAML e classificazione dei doc storici (PRD v0.6, nota A7).
 */

import { parse as parseYaml } from 'yaml';

/**
 * frontmatter YAML iniziale come oggetto ({} se assente o non valido).
 * Schema `failsafe`: ogni scalare resta una stringa così com'è scritta. Serve per gli hash
 * di commit: `0164750` letto come numero perderebbe lo zero, `3e45123` diventerebbe un float.
 */
export function readFrontmatter(text) {
  const t = text.replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) return {};
  const end = t.indexOf('\n---', 4);
  if (end < 0) return {};
  try {
    const data = parseYaml(t.slice(4, end), { schema: 'failsafe' });
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

/**
 * errore del parser se il frontmatter iniziale non si legge (0.6-z3), altrimenti null.
 * Stesso parser e stesso schema di readFrontmatter.
 */
export function erroreFrontmatter(text) {
  const t = text.replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) return null;
  const end = t.indexOf('\n---', 4);
  if (end < 0) return null;
  try {
    parseYaml(t.slice(4, end), { schema: 'failsafe' });
    return null;
  } catch (err) {
    return err;
  }
}

const HISTORICAL_STATUS = new Set(['superseded', 'deprecated', 'done', 'archived', 'closed', 'chiuso', 'archiviato']);
const HISTORICAL_DIR = /^_?(archive|archives|archived|archivio|archiviati|old|legacy|storico|storia|history|attic|ref)$/i;
const HISTORICAL_PREFIXES = ['docs/superpowers/plans/'];

/**
 * Motivo per cui un doc è storico, o null. Storico = piani chiusi, status di fine vita,
 * cartelle d'archivio. Regole in più dal file di allow-list: `storico:<glob>`.
 * @param {string} docRel
 * @param {object} fm - frontmatter
 * @param {Array<{kind: string|null, re: RegExp}>} rules
 */
export function historicalReason(docRel, fm, rules = []) {
  const status = typeof fm.status === 'string' ? fm.status.toLowerCase() : null;
  if (status && HISTORICAL_STATUS.has(status)) return `status: ${status}`;
  const dirs = docRel.split('/').slice(0, -1);
  const dir = dirs.find((d) => HISTORICAL_DIR.test(d));
  if (dir) return `cartella ${dir}/`;
  const prefix = HISTORICAL_PREFIXES.find((p) => docRel.startsWith(p) || docRel.includes('/' + p));
  if (prefix) return `piani chiusi (${prefix})`;
  const rule = rules.find((r) => r.kind === 'storico' && r.re.test(docRel));
  if (rule) return 'regola storico: dell\'allow-list';
  return null;
}
