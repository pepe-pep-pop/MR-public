/**
 * indicedoc.mjs — indice dei doc di GL e ricerca per parole (0.6-z17, `mr indice` e `mr trova`).
 *
 * Proposta di arch (`_arch/tool/valutazioni/mr-performance-2026-10-18.md` §12, ok di il maintainer del
 * 19/10): MR come «mappa» per gli agenti. L'indice è un TSV in `~/.mr/indice/INDICE_DOC.tsv`
 * (`MR_INDICE_DIR` per un'altra cartella), una riga per doc: id, titolo, type, owner, status,
 * last_updated, percorso assoluto, prima riga del corpo, vivo/storico, workspace, repo.
 *
 * Quali doc: i `.md` dei workspace attivi dell'indice di arch (gli stessi del giro), letti dal working
 * tree, perché il percorso deve aprire il file che l'agente ha sul disco. Fuori:
 *   - tutto ciò che il giro esclude: file di segreti, cartelle `codice:` e regole `doc:` (repo e
 *     allow-list centrale), fixture di test, workspace in archivio, cartelle nascoste e generate;
 *   - le cartelle con dati personali: nomi in CARTELLE_PERSONALI, più le regole `personali:<glob>`
 *     del `mr.claims.ignore` o dell'allow-list centrale;
 *   - mai CSV o export: si leggono solo i `.md`.
 * Il riassunto (prima riga del corpo) e il titolo si scartano se contengono un'email, un telefono,
 * un codice fiscale, un IBAN o una forma di segreto. L'indice è un dato: non si esegue, e i caratteri
 * di controllo si tolgono sia scrivendolo sia stampandolo (niente sequenze del terminale dai doc).
 *
 * `mr trova` è in prova (il maintainer, 20/10): solo testo, nessun modello. Una ricerca semantica (qmd) si
 * valuta solo se questa non basta. Dalla 0.6-z23 cerca anche nel corpo dei doc (cercaNelTesto), quando
 * l'indice non dà un doc con tutte le parole, o con una frase esatta, o con --testo.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { RepoView, isSecretPath } from './repo.mjs';
import { hasExcludedSegment } from '../../lib/discover.mjs';
import { loadIgnore, parseIgnore, IGNORE_FILE } from './claims.mjs';
import { readFrontmatter, historicalReason } from './frontmatter.mjs';
import { nonVivo, isFixture } from './vivi.mjs';
import { redactLine } from './drift.mjs';

export const INDICE_FILE = 'INDICE_DOC.tsv';
export const COLONNE = ['id', 'titolo', 'type', 'owner', 'status', 'last_updated', 'percorso', 'riassunto', 'stato', 'workspace', 'repo'];
const RIASSUNTO_MAX = 160;
const TITOLO_MAX = 120;

/** cartella dell'indice: MR_INDICE_DIR, altrimenti ~/.mr/indice */
export function cartellaIndice(env = process.env) {
  return env.MR_INDICE_DIR ? resolve(env.MR_INDICE_DIR) : join(homedir(), '.mr', 'indice');
}

// cartelle che di solito contengono dati di persone (studenti, lead, candidati, contatti) o export
export const CARTELLE_PERSONALI = new Set([
  'candidati', 'candidature', 'studenti', 'lead', 'leads', 'contatti', 'contacts', 'anagrafica',
  'anagrafiche', 'persone', 'people', 'export', 'exports', 'dump', 'dumps', 'dati-personali',
  'dati_personali', 'personal-data', 'pii', 'gdpr-richieste', 'crawl',
]);

/** il doc sta in una cartella con dati personali? ritorna il motivo o null */
export function cartellaPersonale(rel, rules = []) {
  const dirs = rel.toLowerCase().split('/').slice(0, -1);
  const d = dirs.find((x) => CARTELLE_PERSONALI.has(x));
  if (d) return `cartella ${d}/`;
  const r = (rules || []).find((x) => x.kind === 'personali' && x.re.test(rel));
  return r ? 'regola personali:' : null;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const TELEFONO = /(?:\+|00)\d[\d .-]{7,}\d|\b3\d{2}[ .-]?\d{3}[ .-]?\d{3,4}\b/;
const CODICE_FISCALE = /\b[A-Z]{6}\d{2}[A-EHLMPR-T]\d{2}[A-Z]\d{3}[A-Z]\b/i;
const IBAN = /\b[A-Z]{2}\d{2}[ ]?(?:[A-Z0-9]{4}[ ]?){3,7}[A-Z0-9]{1,4}\b/;

/** il testo contiene dati personali o un segreto? (allora non entra nell'indice) */
export function datiSensibili(t) {
  const s = String(t ?? '');
  if (EMAIL.test(s) || TELEFONO.test(s) || CODICE_FISCALE.test(s) || IBAN.test(s)) return true;
  return redactLine(' ' + s) !== ' ' + s;
}

/** testo su una riga, senza caratteri di controllo (tab, a capo, escape del terminale) */
export function pulito(t, max = Infinity) {
  // eslint-disable-next-line no-control-regex
  const s = String(t ?? '').replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** markdown in linea → testo (link, enfasi, codice) */
const STATUS_VIVI = new Set(['active', 'draft']);

function testoPiano(l) {
  return l
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*`]+/g, '')
    // il corsivo con _ si toglie, l'underscore dentro un nome resta (external_id, 0.6-z25)
    .replace(/(^|[^a-z0-9])_+|_+(?![a-z0-9])/gi, '$1')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*>\s?/, '');
}

/** corpo del doc dopo il frontmatter */
function corpo(text) {
  const t = text.replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) return t;
  const end = t.indexOf('\n---', 4);
  if (end < 0) return t;
  const nl = t.indexOf('\n', end + 4);
  return nl < 0 ? '' : t.slice(nl + 1);
}

/** titolo (title del frontmatter, primo «# », nome del file) e prima riga di testo del corpo */
export function titoloERiassunto(text, rel, fm = {}) {
  const righe = corpo(text).split('\n');
  let h1 = null;
  let riassunto = '';
  let fence = false;
  for (const raw of righe) {
    const l = raw.trim();
    if (/^(```|~~~)/.test(l)) { fence = !fence; continue; }
    if (fence || !l) continue;
    const h = l.match(/^#\s+(.+)$/);
    if (h) { h1 ??= h[1]; continue; }
    if (/^#{2,6}\s/.test(l) || /^<!--/.test(l) || /^\|/.test(l) || /^[-=*_]{3,}$/.test(l) || /^\*\*[^*]+:\*\*\s*$/.test(l)) continue;
    const p = pulito(testoPiano(l));
    if (p.length < 3) continue;
    riassunto = p;
    break;
  }
  const nome = basename(rel, '.md');
  let titolo = pulito(testoPiano(typeof fm.title === 'string' && fm.title.trim() ? fm.title : h1 || nome), TITOLO_MAX);
  if (datiSensibili(titolo)) titolo = nome;
  riassunto = datiSensibili(riassunto) ? '' : pulito(riassunto, RIASSUNTO_MAX);
  return { titolo, riassunto };
}

/**
 * voci dell'indice per i doc di un repo sotto una cartella
 * @param {RepoView} view - working tree
 * @param {string} prefix - cartella relativa al repo ('.' = tutto)
 * @param {{workspace: string, regole: Array}} o
 * @returns {{voci: object[], esclusi: Record<string, number>}}
 */
export function vociRepo(view, prefix, { workspace, regole = [] }) {
  const voci = [];
  const esclusi = {};
  const conta = (g) => { esclusi[g] = (esclusi[g] || 0) + 1; };
  const repo = view.root.split('/').pop();
  for (const rel of view.listMarkdownUnder(prefix)) {
    if (isSecretPath(rel)) { conta('segreti'); continue; }
    if (cartellaPersonale(rel, regole)) { conta('dati personali'); continue; }
    const nv = nonVivo(rel, regole);
    if (nv && (nv.gruppo === 'codice' || nv.gruppo === 'segreti')) { conta(nv.gruppo); continue; }
    if (nv && nv.gruppo === 'regola' && nv.motivo === 'regola doc:') { conta('altro repo (doc:)'); continue; }
    if (nv && nv.gruppo === 'storico' && isFixture(nv.motivo)) { conta('fixture'); continue; }
    // 0.6-z29 (F5): _out/ e _output*/ sono copie generate di doc che stanno altrove: fuori dall'indice
    if (nv && nv.gruppo === 'storico' && nv.motivo.startsWith('_out/')) { conta('generati (_out/)'); continue; }
    let text;
    try {
      text = view.readFile(rel);
    } catch {
      conta('non leggibile');
      continue;
    }
    const fm = readFrontmatter(text);
    // 0.6-z27 (F3): status active o draft nel frontmatter prevale sulle regole di percorso (hof-*, proposte/,
    // cartelle datate…): l'autore ha detto che il doc è vivo. Restano storici i generati (_out/), le regole
    // storico: dell'allow-list e gli status di fine vita. Solo nell'indice: il giro non cambia.
    const percorsoSolo = (m) => m && m !== 'regola storico:' && m !== 'regola storico: dell\'allow-list' && !m.startsWith('_out/') && !m.startsWith('status:');
    const dichiaratoVivo = typeof fm.status === 'string' && STATUS_VIVI.has(fm.status.toLowerCase());
    const motivo = nv ? nv.motivo : historicalReason(rel, fm, regole);
    const storico = motivo && !(dichiaratoVivo && percorsoSolo(motivo));
    const { titolo, riassunto } = titoloERiassunto(text, rel, fm);
    const s = (k) => (typeof fm[k] === 'string' ? pulito(fm[k], 80) : '');
    voci.push({
      id: s('id'), titolo, type: s('type'), owner: s('owner'), status: s('status'), last_updated: s('last_updated'),
      percorso: join(view.root, rel), riassunto, stato: storico ? 'storico' : 'vivo', workspace, repo,
    });
  }
  // 0.6-z29 (F5): registri .tsv, solo se una regola `registro:<glob>` (del repo o dell'allow-list
  // centrale) li nomina: un .tsv qualunque può essere un export con dati personali. Titolo dal nome del
  // file, riassunto dalle colonne dell'intestazione; il testo si cerca come per i doc (riga, mai il testo).
  const registri = (regole || []).filter((r) => r.kind === 'registro');
  if (registri.length) {
    const clean = prefix.replace(/\/+$/, '');
    for (const rel of view.listFiles()) {
      if (!rel.endsWith('.tsv') || hasExcludedSegment(rel) || !registri.some((r) => r.re.test(rel))) continue;
      if (clean && clean !== '.' && !rel.startsWith(clean + '/')) continue;
      if (isSecretPath(rel) || cartellaPersonale(rel, regole)) continue;
      let testa = '';
      try { testa = view.readFile(rel).split('\n')[0] || ''; } catch { conta('non leggibile'); continue; }
      const colonne = pulito(testa.split('\t').map((c) => c.trim()).filter(Boolean).join(', '), RIASSUNTO_MAX - 20);
      voci.push({
        id: '', titolo: basename(rel), type: 'registro', owner: '', status: '', last_updated: '',
        percorso: join(view.root, rel), riassunto: datiSensibili(colonne) ? '' : `colonne: ${colonne}`, stato: 'vivo', workspace, repo,
      });
    }
  }
  return { voci, esclusi };
}

/**
 * indice di tutti i workspace attivi
 * @param {Array<{slug, path, attivo}>} workspace - da parseIndice
 * @param {{ignoreDir?: string, workspaceRepos: Function}} o
 */
export function costruisciIndice(workspace, { ignoreDir = null, workspaceRepos }) {
  const voci = [];
  const esclusi = {};
  const note = [];
  const visti = new Set();
  let nWs = 0;
  for (const w of workspace.filter((x) => x.attivo)) {
    const repos = workspaceRepos(w.path);
    if (!repos.length) { note.push(`${w.slug}: ${existsSync(w.path) ? 'nessun repo git' : 'cartella non trovata'}`); continue; }
    nWs++;
    let central = [];
    if (ignoreDir) {
      const f = join(ignoreDir, `${w.slug}.ignore`);
      if (existsSync(f)) central = parseIgnore(readFileSync(f, 'utf-8'));
    }
    for (const r of repos) {
      const view = new RepoView(r.root, null);
      const prefix = relative(r.root, r.dir) || '.';
      let regole;
      try {
        regole = [...(view.hasFile(IGNORE_FILE) ? loadIgnore(view) : []), ...central];
        const res = vociRepo(view, prefix, { workspace: w.slug, regole });
        for (const v of res.voci) {
          if (visti.has(v.percorso)) continue;
          visti.add(v.percorso);
          voci.push(v);
        }
        for (const [k, n] of Object.entries(res.esclusi)) esclusi[k] = (esclusi[k] || 0) + n;
      } catch (err) {
        note.push(`${w.slug} / ${r.root.split('/').pop()}: non letto (${String(err.message).split('\n')[0]})`);
      }
    }
  }
  voci.sort((a, b) => a.percorso.localeCompare(b.percorso));
  return { voci, esclusi, note, workspace: nWs };
}

export function toTsv(voci) {
  const cella = (x) => pulito(x);
  return [COLONNE.join('\t'), ...voci.map((v) => COLONNE.map((c) => cella(v[c])).join('\t'))].join('\n') + '\n';
}

export function fromTsv(text) {
  const righe = text.split('\n').filter((l) => l && !l.startsWith('#'));
  const head = (righe.shift() || '').split('\t');
  if (head.join('\t') !== COLONNE.join('\t')) throw new Error(`intestazione dell'indice inattesa (rigeneralo con \`mr indice --write\`)`);
  return righe.map((l) => {
    const c = l.split('\t');
    return Object.fromEntries(COLONNE.map((k, i) => [k, c[i] ?? '']));
  });
}

/** scrive l'indice (file temporaneo e rename, permessi solo dell'utente); ritorna il path */
export function scriviIndice(voci, dir = cartellaIndice()) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, INDICE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, toTsv(voci), { encoding: 'utf-8', mode: 0o600 });
  renameSync(tmp, file);
  try { chmodSync(file, 0o600); } catch { /* file system senza permessi posix */ }
  return file;
}

// ---------------------------------------------------------------------------------------------
// ricerca (mr trova)

/** minuscole, senza accenti */
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const PAROLE_VUOTE = new Set(['ai', 'ad', 'ed', 'ne', 'se', 'si', 'ci', 'vi', 'mi', 'ti', 'or', 'is', 'on', 'at', 'by', 'an', 'as', 'allo', 'alla', 'alle', 'agli', 'dal', 'dallo', 'dalla', 'dai', 'dalle', 'sul', 'sulla', 'sui', 'sulle', 'nei', 'negli', 'nelle', 'col', 'tra', 'fra', 'per', 'non', 'una', 'uno', 'gli', 'del', 'dei', 'fino', 'the', 'for', 'with', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'di', 'del', 'della', 'dei', 'delle', 'a', 'al', 'da', 'in', 'nel', 'nella', 'con', 'su', 'per', 'e', 'o', 'che', 'chi', 'come', 'dove', 'the', 'of', 'and', 'to']);

/** parole della ricerca: minuscole, senza accenti né parole vuote */
// 0.6-z22: un nome con underscore (pagamento_con_garanzia, DB_PASSWORD) resta una parola sola; le
// parole di una lettera non contano (le sigle di due, LW, DB, KB, restano: le parole vuote di due lettere sono in PAROLE_VUOTE)
// 0.6-z25: anche trattino e punto tra due lettere o cifre (learnworlds-proxy, sessioni.tsv, sql.sh)
const SEPARATORI = /[^a-z0-9_.-]+/;
const COMPOSTO = /[_.-]/;
const bordi = (t) => t.replace(/^[_.-]+|[_.-]+$/g, '');
export function parole(q) {
  return [...new Set(norm(q).split(SEPARATORI).map(bordi).filter((t) => t.length > 1 && !PAROLE_VUOTE.has(t)))];
}

// nei campi un nome composto vale sia intero sia per le sue parti
const tokens = (s) => norm(s).split(SEPARATORI).map(bordi).flatMap((t) => (COMPOSTO.test(t) ? [t, ...t.split(COMPOSTO)] : [t])).filter(Boolean);

// peso di ogni campo: una parola nel titolo o nell'id conta più di una nel riassunto
const PESI = [['titolo', 4], ['id', 3], ['nome', 3], ['type', 2], ['owner', 2], ['workspace', 2], ['repo', 1], ['percorso', 1], ['riassunto', 1]];

/**
 * punteggio di una voce: per ogni parola il campo migliore (parola intera: peso pieno; prefisso di
 * almeno 4 lettere, es. «token» → «tokens», o una parte di una parola composta: metà)
 */
export function punteggio(v, ps) {
  const campi = PESI.map(([k, w]) => [k === 'nome' ? tokens(basename(v.percorso || '', '.md')) : tokens(v[k]), w]);
  let score = 0;
  let trovate = 0;
  let intere = 0;
  for (const p of ps) {
    let best = 0;
    let intera = false;
    for (const [tk, w] of campi) {
      if (tk.includes(p)) { best = Math.max(best, w); intera = true; }
      // un nome composto si cerca intero: «pagamento» non basta per «pagamento_con_garanzia» (0.6-z22)
      else if (p.length >= 4 && tk.some((t) => t.startsWith(p) || (!COMPOSTO.test(p) && t.length >= 5 && p.startsWith(t)))) best = Math.max(best, w / 2);
      else if (p.length >= 5 && tk.some((t) => t.includes(p))) best = Math.max(best, w / 3);
    }
    if (best) { trovate++; score += best; }
    if (intera) intere++;
  }
  // intere (0.6-z26): parole trovate come parola intera, non come prefisso o parte («update» per «updateexisting»)
  return { score, trovate, intere };
}

/**
 * i doc più pertinenti: prima quelli che contengono più parole della ricerca, a parità i vivi prima
 * degli storici, poi il punteggio e la data di aggiornamento
 * @param {object[]} voci
 * @param {string} q
 * @param {{owner?: string, type?: string, repo?: string, max?: number}} f
 */
export function trova(voci, q, f = {}) {
  const ps = parole(q);
  const has = (campo, x) => !x || norm(campo).includes(norm(x));
  const filtrate = voci.filter((v) => has(v.owner, f.owner) && (!f.type || norm(v.type) === norm(f.type)) && (!f.repo || has(v.repo, f.repo) || has(v.workspace, f.repo)));
  const scored = [];
  for (const v of filtrate) {
    if (!ps.length) { scored.push({ v, score: 0, trovate: 0 }); continue; }
    const s = punteggio(v, ps);
    if (s.trovate) scored.push({ v, ...s });
  }
  scored.sort((a, b) => b.trovate - a.trovate
    || (a.v.stato === 'vivo' ? 0 : 1) - (b.v.stato === 'vivo' ? 0 : 1)
    || b.score - a.score
    || String(b.v.last_updated).localeCompare(String(a.v.last_updated))
    || a.v.percorso.localeCompare(b.v.percorso));
  return { parole: ps, totale: scored.length, risultati: scored.slice(0, f.max ?? 10).map(({ v, score, trovate, intere }) => ({ ...v, punteggio: score, parole_trovate: trovate, parole_intere: intere ?? 0 })) };
}

/** l'indice dal disco, con la data del file */
export function leggiIndice(file) {
  return fromTsv(readFileSync(file, 'utf-8'));
}


// ---------------------------------------------------------------------------------------------
// ricerca nel testo (0.6-z23): quando titolo, id e prima riga non bastano

/**
 * cerca nel corpo dei doc dell'indice: le frasi esatte (minuscole, senza accenti) e, se non ci sono
 * frasi, tutte le parole nello stesso doc. Ritorna per ogni doc la prima riga che corrisponde (la
 * riga con più parole) e la sezione che la contiene: mai il testo della riga, che può contenere
 * dati personali. Legge solo i file dell'indice, quindi con le sue esclusioni.
 * @param {object[]} voci
 * @param {{frasi: string[], parole: string[]}} q
 * @param {{max?: number, leggi?: Function}} o
 */
export function cercaNelTesto(voci, { frasi = [], parole: ps = [] }, { max = 10, leggi = (p) => readFileSync(p, 'utf-8') } = {}) {
  const fr = frasi.map((f) => norm(f).replace(/\s+/g, ' ').trim()).filter(Boolean);
  if (!fr.length && !ps.length) return { totale: 0, risultati: [] };
  const trovati = [];
  for (const v of voci) {
    let testo;
    try { testo = leggi(v.percorso); } catch { continue; }
    const n = norm(testo);
    // 0.6-z32 (F): senza frasi, conta quante parole ci sono nel doc; bastano tutte o almeno 2 (con 1
    // parola sola, quella). Più parole trovate = più in alto.
    const presenti = fr.length ? 0 : ps.filter((p) => n.includes(p)).length;
    if (fr.length ? !fr.every((f) => n.replace(/\s+/g, ' ').includes(f)) : presenti < Math.min(ps.length, 2)) continue;
    const righe = n.split('\n');
    let riga = -1;
    let meglio = 0;
    for (let i = 0; i < righe.length; i++) {
      const l = righe[i].replace(/\s+/g, ' ');
      const k = fr.length ? fr.filter((f) => l.includes(f)).length : ps.filter((p) => l.includes(p)).length;
      if (k > meglio) { meglio = k; riga = i; }
    }
    // una frase che va a capo: nessuna riga la contiene intera, si indica la prima parola
    if (riga < 0) riga = righe.findIndex((l) => (fr[0] || ps[0]).split(' ').some((w) => w.length > 2 && l.includes(w)));
    let sezione = '';
    const originali = testo.replace(/\r\n?/g, '\n').split('\n');
    for (let i = riga; i >= 0; i--) {
      const h = (originali[i] || '').match(/^#{1,6}\s+(.+)$/);
      if (h) { sezione = pulito(testoPiano(h[1]), 80); break; }
    }
    if (datiSensibili(sezione)) sezione = '';
    const occorrenze = fr.length ? fr.reduce((a, f) => a + n.replace(/\s+/g, ' ').split(f).length - 1, 0) : ps.reduce((a, p) => a + n.split(p).length - 1, 0);
    trovati.push({ ...v, riga: riga + 1, sezione, occorrenze, parole_nel_testo: fr.length ? null : presenti });
  }
  trovati.sort((a, b) => (b.parole_nel_testo ?? 0) - (a.parole_nel_testo ?? 0) || (a.stato === 'vivo' ? 0 : 1) - (b.stato === 'vivo' ? 0 : 1) || b.occorrenze - a.occorrenze || String(b.last_updated).localeCompare(String(a.last_updated)) || a.percorso.localeCompare(b.percorso));
  return { totale: trovati.length, completi: fr.length ? trovati.length : trovati.filter((t) => t.parole_nel_testo === ps.length).length, risultati: trovati.slice(0, max) };
}
