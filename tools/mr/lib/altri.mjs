/**
 * altri.mjs — nomi che vivono in un altro repo dell'indice (0.6-z37, fix 1 e 2 del giro 7).
 *
 * Due classi di falsi positivi del giro 7 hanno la stessa causa: il doc parla di un nome che sta in un
 * repo diverso da quello del codice mappato (doc di arch o di hubspot che descrivono il codice di
 * un prodotto; codice spostato in un repo fuori dalla mappa). Prima di dichiarare deriva («causato da»), il
 * giro cerca il nome negli altri repo dell'indice dei workspace attivi, alla loro versione GitHub
 * (origin/<default>, HEAD se non hanno remote): se c'è, l'esito è `external`, come con
 * `--external-repo` o `esterni:` in mr.repos.yaml.
 *
 * Quali repo, per un doc:
 *   - doc di un repo contenitore (il monorepo per arch, hubspot, …: la cartella del workspace sta dentro un repo
 *     più grande): tutti gli altri repo dell'indice;
 *   - altri doc: solo i repo dell'indice che il doc nomina (nome della cartella del repo, parola intera,
 *     almeno 4 caratteri, senza distinguere maiuscole): un doc che parla di più repo li cita.
 * Cosa conta come trovato (solo `found`, mai `ambiguous`):
 *   - env, identifier, symbol, table: le stesse regole del claim check, ma solo nei file di codice
 *     (fuori doc, dati .tsv/.csv/.txt, test, fixture, report, archivi, copie generate);
 *   - path con «/»: il file o la cartella (anche per suffisso); un nome di file da solo solo per i doc
 *     di un repo contenitore; mai un .md;
 *   - comandi (script di package.json, target make, task deno) solo per i doc di un repo contenitore:
 *     GL non ha quasi script, quindi un comando citato da arch descrive un altro repo.
 * endpoint no: `/api/health` esiste quasi ovunque.
 *
 * Costo (limite): solo i claim che hanno già una causa verificata; una ricerca in blocco per repo e
 * per chiamata (git grep -F -w su un ref), viste e ricerche ricordate per repo.
 */

import { RepoView } from './repo.mjs';
import { checkClaim, prefetchClaims } from './check.mjs';
import { classifySpan } from './extract.mjs';
import { TEST_FILE } from './cause.mjs';

export const NON_CODICE = /\.(mdx?|tsv|csv|txt|log|lock|svg|xml|ipynb)$|(^|\/)(tests?|__tests__|fixtures?|__fixtures__|__mocks__|spec|reports?|prova-strumenti|_out|_output[^/]*|_?archivio|_?archive|archived|handoff|hof)\//i;

const KINDS = new Set(['env', 'identifier', 'symbol', 'table', 'path', 'command']);

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class AltriRepo {
  /**
   * @param {string[]} roots - root dei repo dell'indice
   * @param {(root: string) => string|null} revDi - versione da leggere (origin/<default>), null = working tree
   */
  constructor(roots, revDi) {
    this.roots = [...new Set(roots)];
    this.revDi = revDi;
    this.viste = new Map(); // root → { view, cache } | null
  }

  vista(root) {
    if (!this.viste.has(root)) {
      try {
        const view = new RepoView(root, this.revDi(root)).excludeCode([NON_CODICE, TEST_FILE]);
        this.viste.set(root, { view, cache: {} });
      } catch {
        this.viste.set(root, null);
      }
    }
    return this.viste.get(root);
  }

  /**
   * repo in cui cercare per un doc
   * @param {{ escludi: string[], contenitore: boolean, testo: string }} d
   * @returns {string[]} root
   */
  perDoc({ escludi = [], contenitore = false, testo = '' }) {
    const fuori = new Set(escludi);
    return this.roots.filter((root) => {
      if (fuori.has(root)) return false;
      if (contenitore) return true;
      const nome = root.split('/').pop();
      return nome.length >= 4 && new RegExp(`(^|[^\\w-])${escRe(nome)}($|[^\\w-])`, 'i').test(testo);
    });
  }

  /**
   * @param {Array<{ kind: string, key: string, claim: string, doc: string, roots: string[], contenitore: boolean }>} items
   * @returns {Array<string|null>} per item: il nome del repo in cui il nome c'è, o null
   */
  risolvi(items) {
    const claims = items.map((it) => claimDi(it));
    const perRepo = new Map(); // root → claim da cercare
    items.forEach((it, i) => {
      if (!claims[i]) return;
      for (const root of it.roots) {
        if (!perRepo.has(root)) perRepo.set(root, []);
        perRepo.get(root).push(claims[i]);
      }
    });
    for (const [root, cs] of perRepo) {
      const v = this.vista(root);
      if (!v) continue;
      try {
        prefetchClaims(v.view, cs, v.cache);
      } catch {
        this.viste.set(root, null);
      }
    }
    return items.map((it, i) => {
      const c = claims[i];
      if (!c) return null;
      for (const root of it.roots) {
        const v = this.vista(root);
        if (!v) continue;
        try {
          const res = checkClaim(v.view, c, it.doc, v.cache, false);
          if (res.status === 'found') return root.split('/').pop();
        } catch {
          // repo non leggibile a quella versione: si salta
        }
      }
      return null;
    });
  }
}

/** claim da cercare in un altro repo, o null se il tipo o il nome non si prestano */
function claimDi(it) {
  if (!KINDS.has(it.kind)) return null;
  if (it.kind === 'path') {
    const k = it.key.replace(/^\.\//, '').replace(/\/+$/, '');
    if (/\.mdx?$/i.test(k)) return null;
    if (!k.includes('/') && !it.contenitore) return null;
    return { kind: 'path', text: it.claim, key: it.key };
  }
  if (it.kind === 'command') {
    if (!it.contenitore) return null;
    const c = classifySpan(it.claim || '');
    return c && c.kind === 'command' ? c : null;
  }
  const c = classifySpan(it.claim || '');
  if (c && c.kind === it.kind) return c;
  if (it.kind === 'table') return { kind: 'table', text: it.claim, key: it.key, parts: it.key.split('.') };
  return { kind: it.kind, text: it.claim, key: it.key };
}
