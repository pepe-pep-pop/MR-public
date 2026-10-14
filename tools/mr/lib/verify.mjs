/**
 * verify.mjs — verifica dei link e aggiornamento di `verified` (PRD v0.6 R7).
 *
 * `mr verify <doc>[#sezione]` mostra, per ogni link, l'esito di R3, il codice attuale del
 * simbolo e il diff dal commit verificato. Con `--write` aggiorna `verified` al commit
 * corrente del repo del codice: è l'UNICO comando di MR che scrive in un doc, e scrive solo
 * in quel doc.
 *
 * Si verificano solo i link con esito ok, drift o unverified. Si rifiutano:
 *   - moved: prima va aggiornato il path (o il simbolo) nel doc;
 *   - missing, unresolvable: non c'è codice da verificare;
 *   - file con modifiche non committate nel repo del codice: il commit corrente non le contiene.
 *
 * Scrittura: frontmatter con l'API Document di `yaml` (commenti e stili conservati, hash
 * tra apici singoli), ancore modificate solo sulla loro riga. `date` = data del commit
 * verificato (nota A16: raccomandata, serve a rimappare dopo una riscrittura della storia),
 * non la data di oggi: è stabile. Il corpo del doc resta identico.
 */

import { parseDocument, Scalar, YAMLMap } from 'yaml';
import { readCodeRefs, inlineCodeRanges } from './coderefs.mjs';
import { evaluateRef, redactLine } from './drift.mjs';
import { findSymbol } from './symbols.mjs';

const MAX_CODE = 30;
const VERIFIABLE = new Set(['ok', 'drift', 'unverified']);

function normSection(s) {
  return String(s || '').replace(/^#+\s*/, '').trim().toLowerCase();
}

function headShort(repo) {
  return repo.git(['rev-parse', '--short', repo.rev || 'HEAD']).trim();
}

/** data (YYYY-MM-DD) del commit, dall'author date */
export function commitDate(repo, commit) {
  return repo.git(['show', '-s', '--format=%as', commit]).trim();
}

function dirtyFile(repo, path) {
  if (repo.rev) return false;
  return repo.git(['status', '--porcelain', '--', path]).trim() !== '';
}

/** codice attuale del simbolo (troncato, oscurato) */
function currentCode(repo, ref, res) {
  if (!ref.symbol || !['ok', 'drift', 'unverified'].includes(res.status)) return null;
  let text;
  try {
    text = repo.git(['show', `${repo.rev || 'HEAD'}:${ref.path}`]);
  } catch {
    return null;
  }
  const sym = findSymbol(text, ref.symbol, ref.path);
  if (!sym) return null;
  const lines = sym.body.split('\n').map(redactLine);
  return lines.length > MAX_CODE ? [...lines.slice(0, MAX_CODE), `… (${lines.length - MAX_CODE} righe omesse)`] : lines;
}

/**
 * Valuta i link di un doc (eventualmente di una sola sezione) e prepara gli aggiornamenti.
 * @returns {{ items: Array<object>, newText: string|null, changes: number }}
 */
export function planVerify(text, ctx, section = null) {
  const { refs } = readCodeRefs(text);
  const selected = section ? refs.filter((r) => normSection(r.section) === normSection(section)) : refs;
  const items = [];
  for (const ref of selected) {
    const repo = ctx.repoFor(ref);
    const res = evaluateRef(ref, ctx);
    const item = { ref, res, code: repo ? currentCode(repo, ref, res) : null };
    if (!repo) item.blocked = 'repo non disponibile';
    else if (!VERIFIABLE.has(res.status)) {
      item.blocked = res.status === 'moved'
        ? `aggiorna prima il link: ora è in ${res.moved_to}`
        : `esito ${res.status}: niente da verificare`;
    } else if (dirtyFile(repo, ref.path)) {
      item.blocked = 'modifiche non committate sul file nel repo del codice';
    } else {
      item.newCommit = headShort(repo);
      item.newDate = commitDate(repo, item.newCommit);
      if (ref.verified?.commit === item.newCommit && ref.verified?.date === item.newDate) item.unchanged = true;
    }
    items.push(item);
  }
  const updates = items.filter((i) => i.newCommit && !i.unchanged);
  return { items, newText: updates.length ? applyUpdates(text, updates) : null, changes: updates.length };
}

/** applica gli aggiornamenti di verified al testo del doc */
export function applyUpdates(text, updates) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  let t = text.replace(/\r\n/g, '\n');

  // ancore: solo la riga dell'ancora cambia
  const lines = t.split('\n');
  for (const u of updates.filter((x) => x.ref.source === 'anchor')) {
    const i = u.ref.line - 1;
    const line = lines[i];
    const code = inlineCodeRanges(line);
    lines[i] = line.replace(/<!--\s*mr:code\b([^>]*)-->/g, (whole, inner, offset) => {
      // un'ancora citata tra backtick sulla stessa riga resta com'è (0.6-w)
      if (code.some(([a, b]) => offset >= a && offset < b)) return whole;
      // più ancore sulla stessa riga: si aggiorna quella con lo stesso path e simbolo
      if (!new RegExp(`\\bpath=["']?${u.ref.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?(\\s|$)`).test(inner)) return whole;
      if (u.ref.symbol && !new RegExp(`\\bsymbol=["']?${u.ref.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?(\\s|$)`).test(inner)) return whole;
      let updated = /\bverified=\S+/.test(inner)
        ? inner.replace(/\bverified=("[^"]*"|'[^']*'|\S+)/, `verified=${u.newCommit}`)
        : `${inner.replace(/\s*$/, '')} verified=${u.newCommit} `;
      if (u.newDate) {
        updated = /\bdate=\S+/.test(updated)
          ? updated.replace(/\bdate=("[^"]*"|'[^']*'|\S+)/, `date=${u.newDate}`)
          : updated.replace(/(\bverified=\S+)/, `$1 date=${u.newDate}`);
      }
      return `<!-- mr:code${updated.startsWith(' ') ? '' : ' '}${updated}-->`;
    });
  }
  t = lines.join('\n');

  // frontmatter: Document API di yaml
  const fmUpdates = updates.filter((x) => x.ref.source === 'frontmatter');
  if (fmUpdates.length) {
    const end = t.indexOf('\n---', 4);
    const fmText = t.slice(4, end + 1);
    const doc = parseDocument(fmText);
    for (const u of fmUpdates) {
      const entry = doc.getIn(['code_refs', u.ref.index], true);
      if (!(entry instanceof YAMLMap)) continue;
      const commit = new Scalar(u.newCommit);
      commit.type = Scalar.QUOTE_SINGLE;
      const date = u.newDate ? new Scalar(u.newDate) : null;
      if (date) date.type = Scalar.QUOTE_SINGLE;
      const existing = entry.get('verified', true);
      if (existing instanceof YAMLMap) {
        existing.set('commit', commit);
        if (date) existing.set('date', date);
      } else {
        const v = new YAMLMap();
        v.flow = true;
        v.set('commit', commit);
        if (date) v.set('date', date);
        entry.set('verified', v);
      }
    }
    const newFm = keepOriginalLines(fmText, doc.toString({ lineWidth: 0 }));
    t = '---\n' + newFm + t.slice(end + 1);
  }
  return eol === '\n' ? t : t.replace(/\n/g, '\r\n');
}

/**
 * La riserializzazione di yaml normalizza spazi (es. prima di un commento in linea). Qui si
 * allineano le righe vecchie e nuove (LCS su righe a spazi compressi) e, per ogni riga uguale
 * a parte gli spazi, si tiene l'originale: cambiano solo le righe toccate davvero.
 */
export function keepOriginalLines(oldText, newText) {
  const x = oldText.split('\n');
  const y = newText.split('\n');
  const norm = (l) => l.replace(/\s+/g, ' ').trim();
  const xn = x.map(norm);
  const yn = y.map(norm);
  const dp = Array.from({ length: x.length + 1 }, () => new Array(y.length + 1).fill(0));
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      dp[i][j] = xn[i] === yn[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (j < y.length) {
    if (i < x.length && xn[i] === yn[j]) { out.push(x[i]); i++; j++; }
    else if (i < x.length && dp[i + 1][j] >= dp[i][j + 1]) i++;
    else { out.push(y[j]); j++; }
  }
  return out.join('\n');
}

/** diff a righe tra due testi (solo le righe cambiate, con numero) */
export function textChanges(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const out = [];
  // i cambi sono sostituzioni di righe o righe inserite nel frontmatter: confronto allineato
  let i = 0;
  let j = 0;
  while (i < x.length || j < y.length) {
    if (x[i] === y[j]) { i++; j++; continue; }
    // cerca il prossimo punto di riallineamento
    let k = j;
    while (k < y.length && y[k] !== x[i]) k++;
    if (k < y.length && k - j <= 5) {
      for (; j < k; j++) out.push(`+${j + 1}: ${y[j]}`);
      continue;
    }
    if (i < x.length) out.push(`-${i + 1}: ${x[i]}`);
    if (j < y.length) out.push(`+${j + 1}: ${y[j]}`);
    i++;
    j++;
  }
  return out;
}
