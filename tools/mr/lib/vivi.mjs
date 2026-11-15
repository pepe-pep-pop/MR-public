/**
 * vivi.mjs — quali doc di un repo sono «vivi» per il giro (0.6-z4).
 *
 * Un doc è vivo se non è:
 *   - un file di segreti (SECRET/SEGRETI nel nome): non si legge;
 *   - dentro una cartella `codice:<glob>` dell'allow-list (copia di un altro progetto, 0.6-m);
 *   - storico per path (isGiroHistorical: hof-*, piani, report, cartelle datate, fixture…, 0.6-g);
 *   - escluso da una regola `doc:<glob>` (descrive un altro repo) o `storico:<glob>` dell'allow-list
 *     del repo o centrale (0.6-z4: prima il giro li contava nella «Salute dei doc»).
 * Dalla 0.6-z37 (D, C) uno storico per path torna vivo se il frontmatter dice status active o draft
 * (come nell'indice dei doc, F3), o, per i soli doc datati, se il testo ha in testa «Stato: da inviare,
 * aperta, in corso» (vivoDichiarato). Serve il testo: nonVivo(rel, rules, leggi).
 * Dalla 0.6-z38: un hof che ha uno status active ma non è l'ultimo del suo agente è superato (hofSuperati,
 * motivo «hof superato da hof-x-N»), e un doc con `generato_da: <chi>` nel frontmatter (log automatico di un
 * cron, monitor o script) non è vivo (gruppo `generato`): resta nell'indice e in `trova`, non nel giro.
 * Lo usano il giro e `mr vivi`: la stessa lista, così il conteggio dell'agente coincide con quello
 * del giro.
 */

import { isSecretPath } from './repo.mjs';
import { readFrontmatter } from './frontmatter.mjs';

// doc storici o di lavoro (decisione 1 della 0.6-g): fuori dal giro, non una riga informativa
export const HIST_TOKENS = new Set([
  'piano', 'piani', 'plan', 'plans', 'planning', 'roadmap', 'roadmaps', 'proposta', 'proposte',
  'proposal', 'proposals', 'ricerca', 'ricerche', 'research', 'spike', 'spikes', 'log', 'logs',
  'changelog', 'report', 'reports', 'incidente', 'incidenti', 'incident', 'incidents', 'postmortem',
  'archive', 'archivio', 'archived', 'archiviati', 'handoff', 'handoffs', 'hof', 'daily', 'diario',
  'audit', 'release', 'releases', // 0.6-i: fotografie di un momento (giro 2: audit e note di release)
  'delta', 'design', 'recon', 'ricognizione', // 0.6-j: confronti col legacy, design, ricognizioni (giro 3)
  // fixture di test (aggiunta dell'agente: doc sbagliati apposta)
  'fixtures', 'fixture',
]);

/** motivo di isGiroHistorical che indica una fixture di test (doc sbagliati apposta): fuori anche dalle ancore */
export function isFixture(reason) {
  return reason === 'fixture di test' || /^«fixtures?» nel path$/.test(reason || '');
}

/** il doc (path relativo al repo) è storico per il giro? ritorna il motivo o null */
export function isGiroHistorical(rel) {
  const low = rel.toLowerCase();
  const segs = low.split('/');
  const base = segs[segs.length - 1];
  if (base.startsWith('hof-')) return 'hof-*';
  if (low.includes('docs/superpowers/')) return 'docs/superpowers/';
  if (segs.some((sg) => sg === '_out' || sg.startsWith('_output'))) return '_out/, _output*/ (generati)';
  // cartelle o file datati (14-04-26/, emergenza-2026-08/, 2026-09-10_x.md): note del giorno
  if (segs.some((sg) => /(^|[^\d])(\d{4}-\d{2}(-\d{2})?|\d{2}-\d{2}-\d{2,4})([^\d]|$)/.test(sg))) return 'datato';
  // 0.6-z37: data compatta nelle cartelle (esito-20261012/): AAAAMMGG con mese e giorno validi
  if (segs.slice(0, -1).some((sg) => /(^|[^\d])20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])([^\d]|$)/.test(sg))) return 'datato';
  if (segs.includes('test-files')) return 'fixture di test';
  // pacchetti di modifica numerati (app-web/code/136_griglia_20_minuti/) e runbook di applicazione (0.6-j)
  if (segs.slice(0, -1).some((sg) => /^\d{2,4}_[a-z0-9]/.test(sg))) return 'pacchetto di modifica';
  if (/^runbook[_-]apply/.test(base)) return 'runbook di applicazione';
  // note datate anche senza anno (24-07-pm.md, 0.6-j)
  if (/^\d{2}-\d{2}([-_.]|$)/.test(base)) return 'datato';
  // versione nel nome del file (rework-ui-0.7.0.md): nota di una release, storica
  if (/(^|[^\d])\d+\.\d+\.\d+([^\d]|$)/.test(base)) return 'versione nel nome';
  if (low.includes('lovable') && /(^|[\/_. -])prompts?([\/_. -]|$)/.test(low)) return 'prompt Lovable';
  const tokens = segs.flatMap((sg) => sg.replace(/\.md$/, '').split(/[-_. ]+/)).filter(Boolean);
  const hit = tokens.find((t) => HIST_TOKENS.has(t));
  return hit ? `«${hit}» nel path` : null;
}

// status che dicono «doc vivo» (0.6-z27, F3 dell'indice; dalla 0.6-z37 anche in `mr vivi` e nel giro)
export const STATUS_VIVI = new Set(['active', 'draft']);
// «Stato: da inviare | aperta | in corso» in testa al testo (0.6-z37, C): una richiesta o una nota datata
// ancora aperta, anche senza frontmatter
const STATO_APERTO = /^\s*(?:[-*>]\s*)*(?:\*\*|__)?\s*stato\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*(da inviare|aperta|aperto|in corso)\b/i;
const RIGHE_IN_TESTA = 15;

/**
 * il doc si dichiara vivo? (0.6-z37, D e C)
 *   - status active o draft nel frontmatter: prevale su qualunque regola di percorso (hof-*, piani,
 *     proposte, cartelle datate), come nell'indice dei doc (F3, 0.6-z27);
 *   - solo per i doc datati: «Stato: da inviare|aperta|in corso» tra le prime righe del corpo.
 * Mai per le fixture, le copie generate (_out/), le regole dell'allow-list e gli status di fine vita.
 * @param {string} motivo - motivo di isGiroHistorical
 * @param {string} text - testo del doc
 * @returns {string|null} perché è vivo, o null
 */
export function vivoDichiarato(motivo, text) {
  if (!motivo || isFixture(motivo) || motivo.startsWith('_out/')) return null;
  const fm = readFrontmatter(text || '');
  if (typeof fm.status === 'string' && STATUS_VIVI.has(fm.status.toLowerCase())) return `status: ${fm.status.toLowerCase()}`;
  if (motivo !== 'datato') return null;
  let corpo = String(text || '').replace(/\r\n?/g, '\n');
  if (corpo.startsWith('---\n')) {
    const end = corpo.indexOf('\n---', 4);
    if (end > 0) corpo = corpo.slice(end + 4);
  }
  const righe = corpo.split('\n').filter((l) => l.trim()).slice(0, RIGHE_IN_TESTA);
  const m = righe.map((l) => l.match(STATO_APERTO)).find(Boolean);
  return m ? `Stato: ${m[1].toLowerCase()}` : null;
}

/**
 * hof `hof-<nome>-<N>.md` / `hof_<nome>_<N>.md` (o `hof-<nome>.md` senza numero): { nome, n } o null.
 * N è l'ultimo numero dopo un separatore, con una lettera davanti o dietro (hof-app-web-6B, hof_arch_X18);
 * «hof-zeta-mc-1» è l'agente `zeta-mc`, distinto da `zeta`. Un nome senza numero finale è un agente a sé.
 */
export function parseHof(rel) {
  const base = rel.split('/').pop().replace(/\.md$/i, '');
  const m = base.match(/^hof[-_](.+)$/i);
  if (!m) return null;
  const mn = m[1].match(/^(.+?)[-_][A-Za-z]?(\d+)[A-Za-z]?$/);
  return mn ? { nome: mn[1].toLowerCase(), n: Number(mn[2]) } : { nome: m[1].toLowerCase(), n: null };
}

/**
 * hof superati (0.6-z38): nella stessa cartella, tra i file dello stesso agente l'ultimo è quello con N
 * massimo; a parità o se uno non ha numero, il più recente per data di commit (dataFn(rel) → numero,
 * chiamata solo quando serve). Gli altri sono superati.
 * @param {string[]} rels - path relativi dei doc del repo
 * @param {Function} [dataFn] - rel → data dell'ultimo commit (secondi)
 * @returns {Map<string,string>} rel → «hof superato da hof-x-N.md»
 */
export function hofSuperati(rels, dataFn = () => 0) {
  const gruppi = new Map();
  for (const rel of rels) {
    const p = parseHof(rel);
    if (!p) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const k = `${dir}\0${p.nome}`;
    if (!gruppi.has(k)) gruppi.set(k, []);
    gruppi.get(k).push({ rel, n: p.n });
  }
  const cache = new Map();
  const data = (rel) => {
    if (!cache.has(rel)) cache.set(rel, Number(dataFn(rel)) || 0);
    return cache.get(rel);
  };
  const out = new Map();
  for (const items of gruppi.values()) {
    if (items.length < 2) continue;
    const numerati = items.every((i) => i.n !== null);
    items.sort((a, b) => (numerati && b.n !== a.n ? b.n - a.n : data(b.rel) - data(a.rel) || (b.n ?? -1) - (a.n ?? -1) || (a.rel < b.rel ? -1 : 1)));
    const ultimo = items[0].rel.split('/').pop();
    for (const i of items.slice(1)) out.set(i.rel, `hof superato da ${ultimo}`);
  }
  return out;
}

/** data (secondi) dell'ultimo commit che ha toccato il file, alla versione letta dalla vista; 0 se non si sa */
export function dataUltimoCommit(view, rel) {
  try {
    return Number(String(view.git(['log', '-1', '--format=%ct', view.rev || 'HEAD', '--', rel])).trim()) || 0;
  } catch {
    return 0;
  }
}

/** valore di `generato_da` nel frontmatter (qualunque stringa non vuota: cron, monitor, script…), o null */
export function generatoDa(text) {
  const v = readFrontmatter(text || '').generato_da;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** regola `doc:` o `storico:` (repo o allow-list centrale) che esclude il doc, o null */
export function esclusoDaRegola(rel, rules) {
  const r = (rules || []).find((x) => (x.kind === 'doc' || x.kind === 'storico') && x.re.test(rel));
  return r ? `regola ${r.kind}:` : null;
}

function leggiSicuro(leggi, rel) {
  try {
    return leggi(rel);
  } catch {
    return '';
  }
}

/**
 * motivo per cui il doc non è vivo, o null se è vivo
 * @param {Function|null} leggi - rel → testo; senza, solo il path (come fino alla 0.6-z36)
 * @param {Map<string,string>|null} superati - hofSuperati del repo (0.6-z38)
 * @returns {{ motivo: string, gruppo: 'segreti'|'codice'|'storico'|'regola'|'generato', ancore: boolean } | null}
 *   ancore: le sue ancore si leggono lo stesso nel giro (storici per path, non fixture)
 */
export function nonVivo(rel, rules = [], leggi = null, superati = null) {
  if (isSecretPath(rel)) return { motivo: 'segreti nel nome', gruppo: 'segreti', ancore: false };
  const codice = (rules || []).find((r) => r.kind === 'codice' && r.re.test(rel));
  if (codice) return { motivo: 'regola codice:', gruppo: 'codice', ancore: false };
  const hist = isGiroHistorical(rel);
  // 0.6-z37 (D): con il testo (leggi(rel)), status active/draft o «Stato: aperta» prevalgono sul path
  if (hist && !(leggi && vivoDichiarato(hist, leggiSicuro(leggi, rel)))) return { motivo: hist, gruppo: 'storico', ancore: !isFixture(hist) };
  // 0.6-z38: un hof active che non è l'ultimo del suo agente è superato di fatto
  const sup = superati && superati.get(rel);
  if (sup) return { motivo: sup, gruppo: 'storico', ancore: true };
  // 0.6-z38: log automatico (generato_da nel frontmatter): resta nell'indice, non è un doc vivo
  const gen = leggi ? generatoDa(leggiSicuro(leggi, rel)) : null;
  if (gen) return { motivo: `generato_da: ${gen}`, gruppo: 'generato', ancore: false };
  const regola = esclusoDaRegola(rel, rules);
  if (regola) return { motivo: regola, gruppo: 'regola', ancore: regola === 'regola storico:' };
  return null;
}
