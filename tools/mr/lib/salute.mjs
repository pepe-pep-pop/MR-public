/**
 * salute.mjs — salute della documentazione di un repo per il giro (0.6-x).
 *
 * Il frontmatter MR come «health check» dei doc: quanti doc vivi lo hanno, e per quelli che lo hanno
 * i problemi del profilo light (matrix.md §1.8) che il giro può vedere senza il validatore:
 *   - campi obbligatori mancanti;
 *   - id duplicati nel repo;
 *   - `status: superseded` senza `superseded_by`; `superseded_by` e `depends_on` tornano come
 *     riferimenti, che il giro risolve contro gli id di tutti i repo;
 *   - doc vecchi: `last_updated` (o `created`) oltre la soglia del tipo, per i doc non storici, con
 *     l'azione accanto (0.6-y): rileggi; se è ancora vero `mr rivisto <doc> --write`.
 * In più (0.6-z) i doc «da aggiornare»: `review_needed: "<motivo>"`, validi ma con parti non più vere.
 * Non sono problemi del frontmatter: hanno un conteggio e una lista a parte.
 * Doc `status: paused` (0.6-z5, progetti sospesi come app-sospesa): non sono vecchi né da aggiornare,
 * si contano a parte come «sospesi».
 * Un frontmatter con `mr_version` che il parser non legge (0.6-z3, es. `title: A: b` senza virgolette)
 * conta tra i doc con frontmatter, con il problema «frontmatter non leggibile»: non sparisce dal conto.
 * Le soglie sono quelle di mr-validate (STALENESS_DEFAULTS); se cambiano lì, vanno cambiate qui.
 *
 * Funzione pura sul testo dei doc: nessun I/O, nessuna scrittura.
 */

import { readFrontmatter, erroreFrontmatter } from './frontmatter.mjs';
import { bloccoMr, testoIlleggibile } from '../../lib/illeggibile.mjs';
import { vociFerme, sogliaBacklog, descriviFerme } from '../../lib/backlog.mjs';

export const LIGHT_REQUIRED = ['mr_version', 'id', 'title', 'type', 'owner', 'status', 'created', 'last_updated'];

// stesse soglie di tools/mr-validate/mr-validate.mjs (giorni; Infinity = mai vecchio)
const STALENESS_DEFAULTS = {
  guide: 60, 'how-to': 60, reference: 30, explanation: 180,
  spec: 90, roadmap: 30, report: Infinity, log: Infinity, ppd: Infinity,
  capsule: 30, cross_cutting_doc: 60, portfolio_view: 14, html_mirror: 30, index: 60,
};
const STORICI = new Set(['superseded', 'deprecated', 'done', 'archived', 'closed']);

function soglia(fm) {
  const t = fm.staleness_threshold;
  if (t === 'never' || t === null) return Infinity;
  const m = typeof t === 'string' ? t.match(/^(\d+)\s*d?$/) : typeof t === 'number' ? [null, String(t)] : null;
  if (m) return Number(m[1]);
  return STALENESS_DEFAULTS[fm.type] ?? 90;
}

function giorni(da, oggi) {
  if (!da) return null;
  const d = da instanceof Date ? da : new Date(String(da));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((new Date(oggi).getTime() - d.getTime()) / 86400000);
}

/**
 * @param {Array<{doc: string, text: string}>} docs - doc vivi del repo (non storici per il giro)
 * @param {string} oggi - data del giro (YYYY-MM-DD)
 * @param {Array<{doc: string, text: string}>} [storici] - doc storici per path: solo id e problemi
 * @returns {{ vivi: number, taggati: number, senza: string[], vecchi: number, problemi: Array<{doc: string, problema: string}>,
 *            daAggiornare: Array<{doc: string, motivo: string}>,
 *            ids: string[], riferimenti: Array<{doc: string, campo: string, id: string}> }}
 */
export function saluteDocs(docs, oggi, storici = []) {
  const tag = [];
  const senza = [];
  const problemi = [];
  let rottiVivi = 0;
  const rotto = (doc, text) => {
    const err = bloccoMr(text) && erroreFrontmatter(text);
    if (err) problemi.push({ doc, illeggibile: true, problema: testoIlleggibile(err, true) });
    return !!err;
  };
  for (const { doc, text } of docs) {
    const fm = readFrontmatter(text);
    if (fm && fm.id) tag.push({ doc, fm, text });
    else if (rotto(doc, text)) rottiVivi++;
    else senza.push(doc);
  }
  const taggatiVivi = tag.length + rottiVivi;
  // doc storici per path (hof-*, piani…): non contano nella copertura, ma se hanno il frontmatter i
  // loro id servono ai riferimenti e i loro problemi si vedono
  for (const { doc, text } of storici) {
    const fm = readFrontmatter(text);
    if (fm && fm.id) tag.push({ doc, fm, text });
    else rotto(doc, text);
  }
  const ids = new Map();
  for (const { doc, fm } of tag) {
    const id = String(fm.id);
    if (ids.has(id)) problemi.push({ doc, problema: `id \`${id}\` già usato da \`${ids.get(id)}\`` });
    else ids.set(id, doc);
  }
  let vecchi = 0;
  const riferimenti = [];
  const daAggiornare = [];
  let sospesi = 0;
  const viviSet = new Set(docs.map((d) => d.doc));
  const vivo = (d) => viviSet.has(d);
  for (const { doc, fm, text } of tag) {
    const mancanti = LIGHT_REQUIRED.filter((k) => fm[k] === undefined || fm[k] === null || fm[k] === '');
    if (mancanti.length) problemi.push({ doc, problema: `campi mancanti: ${mancanti.join(', ')}` });
    const status = String(fm.status || '').toLowerCase();
    if (status === 'superseded' && !fm.superseded_by) problemi.push({ doc, problema: '`status: superseded` senza `superseded_by`' });
    // riferimenti ad altri doc: si risolvono alla fine del giro, contro gli id di tutti i repo
    if (fm.superseded_by) riferimenti.push({ doc, campo: 'superseded_by', id: String(fm.superseded_by) });
    for (const dep of Array.isArray(fm.depends_on) ? fm.depends_on : []) {
      const d = dep && typeof dep === 'object' ? dep.id : dep;
      if (d) riferimenti.push({ doc, campo: 'depends_on', id: String(d) });
    }
    const motivo = typeof fm.review_needed === 'string' ? fm.review_needed.trim() : '';
    if (status === 'paused') {
      if (vivo(doc)) sospesi++;
      continue;
    }
    if (motivo && !STORICI.has(status)) daAggiornare.push({ doc, motivo });
    if (!STORICI.has(status) && fm.type === 'backlog') {
      // backlog (0.6-z6): vecchio se una voce «In corso» è ferma oltre la soglia, non per la data del file
      const soglia = sogliaBacklog(fm.staleness_threshold);
      const r = soglia === Infinity ? null : vociFerme(text, oggi, soglia);
      if (r && r.ferme.length) {
        vecchi++;
        problemi.push({ doc, vecchio: true, problema: `backlog: ${descriviFerme(r, soglia)} → aggiorna quelle righe (stato o «Aggiornato»)` });
      }
    } else if (!STORICI.has(status)) {
      const g = giorni(fm.last_updated || fm.created, oggi);
      const s = soglia(fm);
      if (g !== null && s !== Infinity && g >= s) {
        vecchi++;
        // l'azione da fare (0.6-y, regola di freschezza del 13/10)
        problemi.push({ doc, vecchio: true, problema: `vecchio: ${g} giorni dall'ultimo aggiornamento (soglia ${s} per \`${fm.type}\`) → rileggi; se è ancora vero \`mr rivisto ${doc} --write\`, altrimenti correggilo` });
      }
    }
  }
  return { vivi: docs.length, taggati: taggatiVivi, taggatiStorici: tag.length + rottiVivi - taggatiVivi, senza, vecchi, sospesi, problemi, daAggiornare, ids: [...ids.keys()], riferimenti };
}
