/**
 * date.mjs — date del frontmatter da git, saltando i commit di sola redazione (0.6-z).
 *
 * Una riscrittura per privacy (es. 03/10 in app-web e nel monorepo) tocca decine di doc senza rileggerli: con
 * `git log -1` sembrano aggiornati quel giorno. I commit di sola redazione si dichiarano nel file
 * `mr.redazioni` del repo dei doc (o con --redazioni <f>), una regola per riga:
 *   <sha>                  hash, intero o abbreviato (almeno 7 caratteri)
 *   messaggio: <testo>     commit il cui oggetto contiene <testo> (maiuscole indifferenti)
 *   import: <sha>          (0.6-z2) commit d'importazione: un repo nato copiando doc scritti prima
 *                          (es. portale-b, 03/09). Per i doc creati in quel commit la data di git
 *                          non dice niente: si legge quella dichiarata nel testo (dataNelTesto)
 * `# ` (cancelletto e spazio) a inizio riga, o dopo uno spazio, apre un commento: `#2` resta testo.
 *
 * created = data del commit che ha aggiunto il file (si segue il rename);
 * last_updated = data dell'ultimo commit che ne cambia il contenuto. Si saltano:
 *   - i commit di redazione (regole sopra);
 *   - i commit che lasciano il testo invariato: cambiano solo il frontmatter (il tag stesso,
 *     `mr rivisto`, uno status) o spostano il file (rename, archiviazione). Il testo dopo il
 *     frontmatter è uguale a quello del commit prima.
 * Se dopo la creazione ci sono solo commit saltati, last_updated = created.
 * Doc creati in un commit `import:`: created = data nel testo («Data:»…); last_updated = quella di
 * un commit successivo che cambia il testo, se c'è, altrimenti la data nel testo («Last updated:»,
 * o la stessa «Data:»). Senza data nel testo le due date restano sconosciute (null), e il confronto
 * col frontmatter non segna «diverso».
 *
 * Sola lettura: `git log`, niente checkout.
 */

import { execFileSync } from 'node:child_process';

export const REDAZIONI_FILE = 'mr.redazioni';

/** @returns {{ sha: string[], messaggi: string[], import: string[], errori: string[] }} */
export function parseRedazioni(text) {
  const out = { sha: [], messaggi: [], import: [], errori: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.replace(/(^|\s)#(\s.*)?$/, '').trim();
    if (!l) return;
    const m = l.match(/^messaggio\s*:\s*(.+)$/i);
    const imp = l.match(/^import\s*:\s*(\S+)$/i);
    if (imp && /^[0-9a-f]{7,40}$/i.test(imp[1])) out.import.push(imp[1].toLowerCase());
    else if (imp) out.errori.push(`riga ${i + 1}: «import:» vuole uno sha (7-40 caratteri esadecimali): ${l}`);
    else if (m) out.messaggi.push(m[1].trim().toLowerCase());
    else if (/^[0-9a-f]{7,40}$/i.test(l)) out.sha.push(l.toLowerCase());
    else out.errori.push(`riga ${i + 1}: né uno sha (7-40 caratteri esadecimali), né «messaggio: <testo>», né «import: <sha>»: ${l}`);
  });
  return out;
}

/** il commit è di sola redazione per le regole date? */
export function diRedazione(commit, regole) {
  const h = commit.hash.toLowerCase();
  if (regole.sha.some((s) => h.startsWith(s))) return true;
  const s = commit.subject.toLowerCase();
  return regole.messaggi.some((m) => s.includes(m));
}

/** commit che toccano il file, dal più recente: [{ hash, date, subject, path }] (path a quel commit) */
export function commitsDelFile(root, rev, rel) {
  const out = execFileSync('git', ['-C', root, 'log', rev || 'HEAD', '--follow', '--format=%x00%H%x09%as%x09%s', '--name-only', '--', rel], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter((b) => b.trim()).map((b) => {
    const [head, ...files] = b.split('\n').filter(Boolean);
    const [hash, date, ...s] = head.split('\t');
    return { hash, date, subject: s.join('\t'), path: files[files.length - 1] || rel };
  });
}

/**
 * testo dopo il frontmatter (il frontmatter è il blocco iniziale tra `---`), senza le righe vuote
 * iniziali: il tag aggiunge di solito una riga vuota tra il frontmatter e il titolo
 */
export function corpo(text) {
  const t = text.replace(/\r\n?/g, '\n');
  const senzaVuote = (x) => x.replace(/^([ \t]*\n)+/, '');
  if (!t.startsWith('---\n')) return senzaVuote(t);
  const end = t.indexOf('\n---', 4);
  if (end < 0) return senzaVuote(t);
  const nl = t.indexOf('\n', end + 4);
  return nl < 0 ? '' : senzaVuote(t.slice(nl + 1));
}

/**
 * predicato «il commit i lascia il testo invariato» (solo frontmatter, o solo spostamento) sulla lista di commitsDelFile: confronta il corpo
 * al commit con quello al commit precedente del file (stesso path seguito dal rename)
 */
export function soloFrontmatterGit(root, commits) {
  const show = (c, path) => {
    try {
      return execFileSync('git', ['-C', root, 'show', `${c}:${path}`], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
  };
  return (i) => {
    const c = commits[i];
    const prima = commits[i + 1];
    if (!prima) return false;
    const a = show(c.hash, c.path);
    const b = show(`${c.hash}^`, prima.path);
    return a !== null && b !== null && corpo(a) === corpo(b);
  };
}

/**
 * @param {Array<{hash: string, date: string, subject: string}>} commits - dal più recente
 * @param {(i: number) => boolean} [soloFrontmatter] - il commit i lascia il testo invariato?
 * @returns {{ created: string|null, ultimo: string|null, last_updated: string|null, saltati: Array<object>, tutti_saltati: boolean }}
 */
export function dateDaCommit(commits, regole, soloFrontmatter = () => false) {
  if (!commits.length) return { created: null, ultimo: null, last_updated: null, saltati: [], tutti_saltati: false };
  const created = commits[commits.length - 1].date;
  const saltati = [];
  let last = null;
  // il commit di creazione conta sempre: il file nasce lì, anche se nasce in un commit di redazione
  for (const [i, c] of commits.entries()) {
    if (i < commits.length - 1) {
      if (diRedazione(c, regole)) { saltati.push({ ...c, motivo: 'redazione' }); continue; }
      if (soloFrontmatter(i)) { saltati.push({ ...c, motivo: 'testo invariato' }); continue; }
    }
    last = c.date;
    break;
  }
  return { created, ultimo: commits[0].date, last_updated: last, saltati, tutti_saltati: saltati.length === commits.length - 1 && saltati.length > 0 };
}

// etichette di data nelle prime righe del testo (0.6-z2): «Data: 2026-05-12», «**Last updated:** 12/05/2026 ore ~10:00»
const ETICHETTA_CREATA = /^(data(?: sessione| creazione)?|date|created|(?:creat|scritt|generat)[oa](?: il)?)$/i;
const ETICHETTA_AGGIORNATA = /^(last updated|updated|ultimo aggiornamento|aggiornat[oa](?: il)?)$/i;
const RIGA_DATA = /^[\s>*_-]*(?:\*\*|__)?([A-Za-zÀ-ÿ ]{3,25}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/;

function isoValida(s) {
  let y, mo, d;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) [, y, mo, d] = iso.map(Number);
  else {
    const it = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!it) return null;
    [, d, mo, y] = it.map(Number);
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/**
 * date dichiarate nelle prime righe del testo (dopo il frontmatter): la prima «Data:» (o Date, Creato,
 * Scritto, Generato, Data sessione)
 * e la prima «Last updated:» (o Ultimo aggiornamento, Aggiornato). Formati 2026-05-12 e 12/05/2026.
 * @returns {{ creata: string|null, aggiornata: string|null }}
 */
export function dataNelTesto(text, righe = 40) {
  const out = { creata: null, aggiornata: null };
  for (const l of corpo(text).split('\n').slice(0, righe)) {
    const m = l.match(RIGA_DATA);
    if (!m) continue;
    const label = m[1].trim();
    const data = isoValida(m[2]);
    if (!data) continue;
    if (!out.creata && ETICHETTA_CREATA.test(label)) out.creata = data;
    else if (!out.aggiornata && ETICHETTA_AGGIORNATA.test(label)) out.aggiornata = data;
  }
  return out;
}

/**
 * doc creato in un commit `import:` (0.6-z2): le date di git dell'import si sostituiscono con quelle
 * del testo. `d` è il risultato di dateDaCommit; `commits` la lista dal più recente.
 */
export function dateImport(d, commits, regole, text) {
  const nascita = commits[commits.length - 1];
  const imp = nascita && regole.import.find((s) => nascita.hash.toLowerCase().startsWith(s));
  if (!imp) return { ...d, fonte: 'git' };
  const t = dataNelTesto(text);
  const created = t.creata ?? t.aggiornata ?? null;
  // last_updated dall'import (nessun commit dopo che cambi il testo): conta il testo
  const daImport = d.last_updated === nascita.date && (commits.length === 1 || d.tutti_saltati);
  const last = daImport ? (t.aggiornata ?? t.creata ?? null) : d.last_updated;
  let fonte;
  if (daImport) fonte = created ? 'testo' : 'import, nessuna data nel testo';
  else fonte = created ? 'testo + git' : 'git, creazione sconosciuta';
  return { ...d, created, last_updated: last, import: imp, fonte };
}


// ── a lotti (0.6-z4): un solo git log per repo e un cat-file --batch per giro di controllo ──

/**
 * commit che toccano ciascun doc, dal più recente, con un solo `git log --name-status -M` sul repo
 * (oggi un `git log --follow` per doc: 49 s su 611 doc). Il rename si segue come con --follow: dal
 * commit del rename in giù il doc si cerca col nome vecchio; il commit che lo crea chiude la lista.
 * @returns {Map<string, Array<{hash, date, subject, path}>>}
 */
export function commitsDiTutti(root, rev, rels) {
  const out = execFileSync('git', ['-C', root, 'log', rev || 'HEAD', '-M', '--format=%x00%H%x09%as%x09%s', '--name-status'], { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 1024 });
  const lists = new Map(rels.map((r) => [r, []]));
  const tracked = new Map(rels.map((r) => [r, r])); // path a quel punto della storia → doc
  for (const b of out.split('\0')) {
    if (!b.trim()) continue;
    const [head, ...lines] = b.split('\n');
    const [hash, date, ...s] = head.split('\t');
    const commit = { hash, date, subject: s.join('\t') };
    for (const l of lines) {
      if (!l) continue;
      const [st, a, bb] = l.split('\t');
      if (st.startsWith('R') && bb !== undefined) {
        const doc = tracked.get(bb);
        if (doc === undefined) continue;
        lists.get(doc).push({ ...commit, path: bb });
        tracked.delete(bb);
        tracked.set(a, doc);
      } else {
        const doc = tracked.get(a);
        if (doc === undefined) continue;
        lists.get(doc).push({ ...commit, path: a });
        if (st === 'A') tracked.delete(a);
      }
    }
    if (!tracked.size) break;
  }
  return lists;
}

/** contenuto di molti `<rev>:<path>` con un solo `git cat-file --batch`: null se l'oggetto non c'è */
export function leggiBlob(root, richieste) {
  if (!richieste.length) return [];
  const raw = execFileSync('git', ['-C', root, 'cat-file', '--batch'], { input: richieste.map((r) => r.replace(/\n/g, '')).join('\n') + '\n', maxBuffer: 1024 * 1024 * 1024 });
  const out = [];
  let i = 0;
  while (out.length < richieste.length && i < raw.length) {
    const nl = raw.indexOf(10, i);
    const header = raw.subarray(i, nl).toString('utf-8');
    i = nl + 1;
    if (/ missing$| ambiguous$/.test(header)) { out.push(null); continue; }
    const size = Number(header.split(' ')[2]);
    out.push(raw.subarray(i, i + size).toString('utf-8'));
    i += size + 1;
  }
  return out;
}

/**
 * dateDaCommit per molti doc: stessi risultati, ma il controllo «testo invariato» si fa a giri, con
 * un solo cat-file per giro su tutti i doc che ne hanno bisogno.
 * @param {Map<string, Array>} liste - da commitsDiTutti
 * @returns {Map<string, ReturnType<typeof dateDaCommit>>}
 */
export function dateDiTutti(root, liste, regole) {
  const stato = new Map();
  for (const [doc, commits] of liste) stato.set(doc, { commits, i: 0, saltati: [], fatto: !commits.length });
  for (;;) {
    const attesa = [];
    for (const [doc, st] of stato) {
      if (st.fatto) continue;
      const { commits } = st;
      // i commit di redazione si saltano senza leggere nulla; il commit di creazione conta sempre
      while (st.i < commits.length - 1 && diRedazione(commits[st.i], regole)) { st.saltati.push({ ...commits[st.i], motivo: 'redazione' }); st.i++; }
      if (st.i >= commits.length - 1) { st.fatto = true; continue; }
      attesa.push(doc);
    }
    if (!attesa.length) break;
    const req = attesa.flatMap((doc) => {
      const { commits, i } = stato.get(doc);
      return [`${commits[i].hash}:${commits[i].path}`, `${commits[i].hash}^:${commits[i + 1].path}`];
    });
    const blob = leggiBlob(root, req);
    attesa.forEach((doc, k) => {
      const st = stato.get(doc);
      const a = blob[2 * k];
      const b = blob[2 * k + 1];
      if (a !== null && b !== null && corpo(a) === corpo(b)) { st.saltati.push({ ...st.commits[st.i], motivo: 'testo invariato' }); st.i++; } else st.fatto = true;
    });
  }
  const out = new Map();
  for (const [doc, st] of stato) {
    const { commits, saltati } = st;
    if (!commits.length) { out.set(doc, { created: null, ultimo: null, last_updated: null, saltati: [], tutti_saltati: false }); continue; }
    out.set(doc, { created: commits[commits.length - 1].date, ultimo: commits[0].date, last_updated: commits[st.i].date, saltati, tutti_saltati: saltati.length === commits.length - 1 && saltati.length > 0 });
  }
  return out;
}
