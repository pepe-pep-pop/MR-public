#!/usr/bin/env node
/**
 * mr-scanner.mjs — Scanner per Metadati Relazionali (MR) v0.5.1
 *
 * Scansiona i file MR-taggati di un progetto e:
 *   1. Calcola _content_hash sul body markdown only (regola M12, body-only)
 *   2. Calcola i campi computed _computed_staleness_days, _computed_status, _last_scanned
 *   3. Calcola la propagazione di staleness via propagate_staleness_to (single-hop)
 *   4. Rigenera il registry di matrix.md §4.1 (sostituzione integrale tra marker)
 *   5. Calcola required_by come inverso dei depends_on (solo in mr-status.json)
 *   6. Scrive mr-status.json come output strutturato
 *
 * MODALITÀ (v0.5.1): SOLA LETTURA DI DEFAULT.
 *   - senza --write: calcola tutto e stampa il report, non modifica nessun file
 *     (--dry-run è accettato ed equivale al default);
 *   - con --write: scrive i campi _* nei file MR scansionati, _propagated_from sui
 *     target, il registry in matrix.md e mr-status.json;
 *   - con --write --profile light: NON tocca i doc; scrive solo il registry in
 *     matrix.md e mr-status.json (che contiene anche i campi computed e required_by).
 *
 * matrix.md si cerca risalendo dalla cartella del primo file scansionato, fermandosi
 * alla root del repo git che lo contiene (fuori da un repo: solo quella cartella).
 *
 * Le directory si scandiscono con le esclusioni di default (../lib/discover.mjs):
 * node_modules, .git, dist, build, cartelle nascoste, repo annidati, .gitignore,
 * più le cartelle `test-files` (fixture con id duplicati di proposito).
 *
 * DECISIONI DI SCOPE (Spike 6, report/spike-6-scanner.md):
 *   D3 hashing: gray-matter + normalizzazione esplicita
 *   D3.1 normalizzazione: line endings → LF, encoding → UTF-8, trim trailing newline EOF
 *                        NO trim trailing whitespace di riga, NO conversione tab/spaces
 *   D4 sync registry: sostituzione integrale tra marker MR-REGISTRY-START/END
 *   D5 propagazione: _propagated_from in-file + report aggregato in mr-status.json
 *   D5.1 vincoli propagazione: NO last_updated, NO ricorsiva, NO prima scansione
 *
 * VINCOLI OPERATIVI:
 *   - Non rompere retrocompatibilita validator (file senza campi _* devono restare validi)
 *   - Hashing body-only (mai sull'intero file)
 *   - Propagazione single-hop, no ricorsiva
 *   - Mai modificare last_updated dei target propagati
 *   - Mai propagare alla prima scansione (nessun hash di confronto)
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, relative, basename, extname, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';
import { findRepoRoot, listMarkdownFiles, collectMarkdownArgs } from '../lib/discover.mjs';
import { bloccoMr, testoIlleggibile } from '../lib/illeggibile.mjs';
import { vociFerme, sogliaBacklog } from '../lib/backlog.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// CONFIG E COSTANTI
// =============================================================================

const SCANNER_VERSION = '0.5.1';
const MR_STATUS_VERSION = '0.2';
const MR_STATUS_FILENAME = 'mr-status.json';
const REGISTRY_MARKER_START = '<!-- MR-REGISTRY-START -->';
const REGISTRY_MARKER_END = '<!-- MR-REGISTRY-END -->';
const PROFILES = ['full', 'light'];
// Cartelle saltate dallo scanner oltre alle esclusioni di default
const SCANNER_EXCLUDED_DIRS = ['test-files'];

// Default thresholds per type, ereditati da matrix.md §1.1.
// Lo scanner non valida lo schema, ma usa questi default per calcolare _computed_status
// quando staleness_threshold non è dichiarato esplicitamente nel file.
const TYPE_DEFAULT_THRESHOLDS = {
  guide: '60d',
  'how-to': '60d',
  reference: '30d',
  explanation: '180d',
  spec: '90d',
  roadmap: '30d',
  report: 'never',
  log: 'never',
  ppd: 'never',
  // v0.4 brain-extended (post field test 2026-04-26)
  capsule: '30d',
  cross_cutting_doc: '60d',
  portfolio_view: '14d',
  html_mirror: '30d',
  index: '60d',
};

// =============================================================================
// SOTTOPROBLEMA 1 — BODY-ONLY HASHING (D3 + D3.1)
// =============================================================================

/**
 * Normalizza il body markdown prima del calcolo hash, secondo D3.1.
 * Le normalizzazioni sono solo cosmetiche universali, mai semantiche.
 *
 * @param {string} bodyRaw - body markdown grezzo come ritornato da gray-matter
 * @returns {string} body normalizzato pronto per sha256
 */
export function normalizeBodyForHash(bodyRaw) {
  let body = bodyRaw;

  // D3.1.a: line endings CRLF/CR → LF (sempre)
  body = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // v0.6 (nota A2 del PRD): le ancore <!-- mr:code ... --> non contano per l'hash, così
  // aggiornare verified= non fa scattare la propagazione. Identico a mr-validate.
  body = body.replace(/^[ \t]*<!--\s*mr:code\b[^>]*-->[ \t]*\n/gm, '').replace(/<!--\s*mr:code\b[^>]*-->/g, '');

  // D3.1.c: trailing newline di fine file (collassa multi a singolo, poi rimuovi)
  body = body.replace(/\n+$/g, '');

  // D3.1.b: encoding UTF-8 — già garantito perché readFile è chiamato con encoding 'utf-8'
  // (vedi computeContentHash)

  // D3.1.d: trailing whitespace di riga → NON modificato (potenzialmente semantico)
  // D3.1.e: tab vs spaces → NON modificato (potenzialmente semantico)

  return body;
}

/**
 * Calcola sha256 del body markdown (post-frontmatter, post-normalizzazione).
 * Implementazione di M12 (regola cristallizzata in formato_MR_v0.3).
 *
 * @param {string} filePath - path assoluto al file MR
 * @returns {Promise<{ hashFull: string, hashShort: string, body: string, frontmatter: object | null }>}
 */
export async function computeContentHash(filePath) {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  const bodyNormalized = normalizeBodyForHash(parsed.content);

  const hashFull = createHash('sha256').update(bodyNormalized, 'utf-8').digest('hex');
  const hashShort = `sha256:${hashFull.substring(0, 12)}`;

  return {
    hashFull: `sha256:${hashFull}`,
    hashShort,
    body: bodyNormalized,
    frontmatter: parsed.data && Object.keys(parsed.data).length > 0 ? parsed.data : null,
  };
}

// =============================================================================
// SOTTOPROBLEMA 2 — SYNC matrix.md §4.1 (D4 + D4.1) — Step C.2
// =============================================================================

/**
 * Trova matrix.md partendo dai file scansionati. Ordine di ricerca:
 *   1. Uno degli scannedFiles è già matrix.md → lo usa
 *   2. Risale dalla cartella del primo scannedFile fino alla root del repo git
 *      che lo contiene (inclusa), mai oltre
 *   3. Fuori da un repo git: controlla solo la cartella del primo scannedFile
 *   4. Null se non trovato
 *
 * Il limite alla root del repo evita di riscrivere un matrix.md che sta in una
 * cartella superiore (un altro progetto) — rilievo S4 della valutazione v0.5.
 *
 * @param {Array<{path: string}>} scannedFiles
 * @returns {string|null}
 */
export function findMatrixPath(scannedFiles) {
  for (const f of scannedFiles) {
    if (basename(f.path) === 'matrix.md') return f.path;
  }
  if (scannedFiles.length === 0) return null;
  const startDir = dirname(scannedFiles[0].path);
  const repoRoot = findRepoRoot(startDir);
  let current = startDir;
  while (true) {
    const candidate = join(current, 'matrix.md');
    if (existsSync(candidate)) return candidate;
    if (!repoRoot || current === repoRoot) return null;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Scansione ricorsiva di baseDir per tutti i file .md con header MR.
 *
 * Esclusioni: quelle di default di ../lib/discover.mjs più le cartelle
 * `test-files`, che contengono fixture con id deliberatamente duplicati
 * (es. `mr/ppd-00` finto per il validatore) e non devono finire nel registry.
 *
 * Per ogni file ritorna il path assoluto e il frontmatter parsato.
 *
 * @param {string} baseDir
 * @returns {Promise<Array<{path: string, frontmatter: object}>>}
 */
export async function collectAllMrFiles(baseDir) {
  const allMd = listMarkdownFiles(baseDir, { extraExcludedDirs: SCANNER_EXCLUDED_DIRS });

  const mrFiles = [];
  for (const f of allMd) {
    try {
      const raw = await readFile(f, 'utf-8');
      const parsed = matter(raw);
      if (parsed.data && parsed.data.mr_version) {
        mrFiles.push({ path: f, frontmatter: parsed.data });
      }
    } catch {
      // parse error: skip, il validator li segnalerà
    }
  }
  return mrFiles;
}

/**
 * Formatta una data (stringa YYYY-MM-DD o Date object) in stringa ISO-date.
 * gray-matter parsa le date YAML come Date objects, serve normalizzazione.
 */
function formatDateForRegistry(d) {
  if (!d) return '?';
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d);
}

/**
 * Genera la tabella markdown del registry a partire dalla lista dei file MR.
 * Colonne: id, type, path (relativo a repoRoot), status, created, last_updated.
 * Ordinamento: per `id` ascending (garantisce determinismo e idempotenza).
 *
 * La colonna Note della tabella attuale viene INTENZIONALMENTE omessa: le
 * annotazioni umane vanno in §4.1.bis sotto i marker MR-REGISTRY-END,
 * fuori dal dominio dello scanner (vedi matrix.md §4 nota operativa).
 *
 * @param {Array<{path: string, frontmatter: object}>} mrFiles
 * @param {string} repoRoot - root del repo git (per path relativi)
 * @returns {string} tabella markdown pronta per essere inserita tra i marker
 */
function generateRegistryTable(mrFiles, repoRoot) {
  const sorted = [...mrFiles].sort((a, b) =>
    String(a.frontmatter.id || '').localeCompare(String(b.frontmatter.id || ''))
  );

  const header = '| `id` | `type` | Path (da repo root) | `status` | `created` | `last_updated` |';
  const sep = '|---|---|---|---|---|---|';

  const rows = sorted.map(({ path, frontmatter }) => {
    const relPath = repoRoot
      ? relative(repoRoot, path).split('\\').join('/')
      : basename(path);
    const id = frontmatter.id || '?';
    const type = frontmatter.type || '?';
    const status = frontmatter.status || 'active';
    const created = formatDateForRegistry(frontmatter.created);
    const lastUpdated = formatDateForRegistry(frontmatter.last_updated || frontmatter.created);
    return `| \`${id}\` | \`${type}\` | \`${relPath}\` | \`${status}\` | \`${created}\` | \`${lastUpdated}\` |`;
  });

  return [header, sep, ...rows].join('\n');
}

/**
 * Sincronizza il registry §4.1 di matrix.md: sostituisce integralmente il
 * contenuto tra i marker MR-REGISTRY-START/END con una tabella rigenerata
 * dai file MR effettivamente presenti nella directory di matrix.md.
 *
 * Decisione D4: sostituzione integrale (scanner = autorità sul registry).
 * Decisione D4.1: delimitazione via marker HTML comment espliciti.
 *
 * IDEMPOTENZA: se il contenuto nuovo è identico al precedente, no-op.
 *
 * In Step C.2 NON scrive su disco: calcola e ritorna newContent, il main
 * decide cosa farne (in dry-run stampa diff, in C.4 scriverà il file).
 *
 * @param {Array<{path: string}>} scannedFiles - file passati in CLI (usati per trovare matrix.md)
 * @returns {Promise<{
 *   updated: boolean,
 *   reason?: string,
 *   matrixPath?: string,
 *   prevContent?: string,
 *   newContent?: string,
 *   newTable?: string,
 *   mrFilesCount?: number,
 *   lostNotes?: boolean,
 * }>}
 */
export async function syncRegistry(scannedFiles) {
  const matrixPath = findMatrixPath(scannedFiles);
  if (!matrixPath) {
    return { updated: false, reason: 'matrix.md non trovato nello scope' };
  }

  const matrixDir = dirname(matrixPath);
  const repoRoot = findRepoRoot(matrixDir) || matrixDir;

  // Dominio del registry = tutti i file MR nella dir di matrix.md,
  // indipendentemente da scannedFiles (invariante: registry = stato filesystem)
  const mrFiles = await collectAllMrFiles(matrixDir);

  const newTable = generateRegistryTable(mrFiles, repoRoot);

  const matrixContent = await readFile(matrixPath, 'utf-8');

  const startIdx = matrixContent.indexOf(REGISTRY_MARKER_START);
  const endIdx = matrixContent.indexOf(REGISTRY_MARKER_END);

  if (startIdx === -1 || endIdx === -1) {
    return {
      updated: false,
      reason: `marker MR-REGISTRY-START/END non trovati in ${matrixPath}`,
      matrixPath,
    };
  }
  if (endIdx < startIdx) {
    return {
      updated: false,
      reason: `marker MR-REGISTRY-START/END in ordine invertito`,
      matrixPath,
    };
  }

  const beforeMarkers = matrixContent.slice(0, startIdx + REGISTRY_MARKER_START.length);
  const betweenMarkers = matrixContent.slice(startIdx + REGISTRY_MARKER_START.length, endIdx);
  const afterMarkers = matrixContent.slice(endIdx);

  const newBetween = `\n\n${newTable}\n\n`;

  // Rileva se tra i marker correnti ci sono note umane che andranno perse
  // (pattern: colonna "Note" nell'header della tabella attuale)
  const lostNotes = /\bNote\b\s*\|/i.test(betweenMarkers);

  if (betweenMarkers === newBetween) {
    return {
      updated: false,
      reason: 'tabella già aggiornata (idempotenza)',
      matrixPath,
      newTable,
      mrFilesCount: mrFiles.length,
    };
  }

  const newContent = beforeMarkers + newBetween + afterMarkers;

  return {
    updated: true,
    matrixPath,
    prevContent: matrixContent,
    newContent,
    newTable,
    mrFilesCount: mrFiles.length,
    lostNotes,
  };
}

// =============================================================================
// SOTTOPROBLEMA 3 — PROPAGAZIONE STALENESS (D5 + D5.1) — Step C.3
// =============================================================================

/**
 * Calcola gli eventi di propagazione staleness per la run corrente.
 *
 * **Funzione pura**: zero side effects, zero I/O, zero modifiche a file.
 * Ritorna solo una lista di eventi descrittivi. La scrittura effettiva di
 * `_propagated_from` nei file target e di `propagation_events` in mr-status.json
 * avviene in Step C.4 dal caller (main), applicando gli eventi ritornati.
 *
 * **Vincoli D5.1** (enforced by design):
 *   - D5.1.a NON modifica `last_updated` dei target → la funzione non scrive nulla
 *   - D5.1.b NON propaga ricorsivamente (single-hop) → itera solo scannedFiles,
 *            non segue i target attraverso catene transitive
 *   - D5.1.c NON propaga alla prima scansione → se previousState è null o non
 *            contiene un hash previo per il file sorgente, no propagazione
 *
 * Algoritmo:
 *   1. Se previousState è null → ritorna [] (prima scansione)
 *   2. Per ogni file in scannedFiles con frontmatter valido:
 *      a. Se il file non aveva hash previo in previousState → skip (prima scan)
 *      b. Se l'hash corrente è uguale al previo → skip (no change)
 *      c. Altrimenti per ogni target in frontmatter.propagate_staleness_to
 *         emette un evento {source, target, date, reason}
 *   3. Ritorna la lista degli eventi (ordine: come in scannedFiles)
 *
 * @param {Array<{path: string, frontmatter: object, _content_hash: string}>} scannedFiles
 * @param {Map<string, string>|null} previousState - Map<id, previousHash> o null (prima scansione)
 * @param {Date} [today] - data corrente (default: new Date()) — iniettabile per test
 * @returns {Array<{source: string, target: string, date: string, reason: string}>}
 */
export function propagateStaleness(scannedFiles, previousState, today = new Date()) {
  // D5.1.c: nessuna propagazione alla prima scansione
  if (!previousState) return [];

  const todayStr = today.toISOString().slice(0, 10);
  const events = [];

  for (const file of scannedFiles) {
    const fm = file.frontmatter;
    if (!fm || !fm.id) continue;

    const sourceId = fm.id;
    const prevHash = previousState.get(sourceId);

    // D5.1.c: se il file non era in previousState, è la sua prima scansione
    if (!prevHash) continue;

    const currentHash = file._content_hash;
    if (!currentHash) continue;

    // Nessuna modifica sostanziale: no propagazione
    if (prevHash === currentHash) continue;

    // Hash cambiato: emetti eventi per ogni target (single-hop, D5.1.b garantito
    // dal fatto che iteriamo solo scannedFiles, senza seguire la catena dei target)
    const targets = Array.isArray(fm.propagate_staleness_to) ? fm.propagate_staleness_to : [];
    for (const t of targets) {
      if (!t || !t.id) continue;
      events.push({
        source: sourceId,
        target: t.id,
        date: todayStr,
        reason: t.reason || '',
      });
    }
  }

  return events;
}

// =============================================================================
// SOTTOPROBLEMA 4a — I/O mr-status.json + write helpers (Step C.4)
// =============================================================================

/**
 * Schema di mr-status.json (v0.2 — v0.5.1 aggiunge computed_* e required_by per file):
 *
 * {
 *   "version": "0.1",                    // schema version, bumpabile
 *   "scanner_version": "0.1.0-...",      // versione dello scanner che ha scritto
 *   "last_scan_date": "2026-04-12",      // data della run (ISO date)
 *   "files": {                           // stato per file, chiave = id MR
 *     "mr/ppd-00": {
 *       "path": "PPD_00.md",                   // relativo a repo root
 *       "content_hash": "sha256:abc123...",   // _content_hash body-only
 *       "computed_staleness_days": 12,
 *       "computed_status": "fresh",
 *       "required_by": ["mr/prd-v01"],         // inverso dei depends_on (calcolato)
 *       "last_scanned": "2026-04-12"
 *     }
 *   },
 *   "propagation_events": [              // eventi della run corrente (NON cumulativi)
 *     { "source": "mr/ppd-00", "target": "mr/prd-v01", "date": "2026-04-12", "reason": "..." }
 *   ]
 * }
 *
 * Invariante: propagation_events contiene solo gli eventi di QUESTA run.
 * Lo storico non viene conservato (se serve, emergerà in v0.2 dello scanner).
 */

/**
 * Legge mr-status.json (se esiste) e ritorna una Map<id, prevContentHash>
 * utilizzabile da propagateStaleness come previousState.
 *
 * Ritorna:
 *   - null se il file non esiste (prima scansione, vincolo D5.1.c)
 *   - null se il file è malformato (warning su stderr, run procede come prima scansione)
 *   - Map<id, hash> altrimenti
 *
 * @param {string} matrixDir - directory dove cercare mr-status.json
 * @returns {Promise<Map<string, string>|null>}
 */
export async function readPreviousState(matrixDir) {
  const statusPath = join(matrixDir, MR_STATUS_FILENAME);
  if (!existsSync(statusPath)) return null;
  try {
    const raw = await readFile(statusPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.files) {
      console.error(`⚠️  mr-status.json malformato (missing "files"): trattato come prima scansione`);
      return null;
    }
    const map = new Map();
    for (const [id, entry] of Object.entries(parsed.files)) {
      if (entry && typeof entry.content_hash === 'string') {
        map.set(id, entry.content_hash);
      }
    }
    return map;
  } catch (err) {
    console.error(`⚠️  Errore lettura mr-status.json: ${err.message} — trattato come prima scansione`);
    return null;
  }
}

/**
 * Calcola required_by come inverso dei depends_on dei file scansionati.
 * È la fonte di required_by nel profilo light: non si scrive nei doc degli altri.
 *
 * @param {Array<{frontmatter: object}>} scannedFiles
 * @returns {Map<string, string[]>} id target → id sorgenti (ordinati)
 */
export function computeRequiredBy(scannedFiles) {
  const map = new Map();
  for (const f of scannedFiles) {
    const sourceId = f.frontmatter?.id;
    if (!sourceId) continue;
    const deps = Array.isArray(f.frontmatter.depends_on) ? f.frontmatter.depends_on : [];
    for (const d of deps) {
      if (!d || !d.id) continue;
      if (!map.has(d.id)) map.set(d.id, []);
      if (!map.get(d.id).includes(sourceId)) map.get(d.id).push(sourceId);
    }
  }
  for (const list of map.values()) list.sort();
  return map;
}

/**
 * Scrive mr-status.json con lo stato della run corrente.
 * Path di output: ${matrixDir}/mr-status.json.
 *
 * @param {string} matrixDir - directory dove scrivere (tipicamente parent di matrix.md)
 * @param {string} repoRoot - per calcolare i path relativi dei file
 * @param {Array<object>} scannedFiles - file con frontmatter + _content_hash + _last_scanned
 * @param {Array<object>} propagationEvents - eventi emessi dalla run
 * @param {Date} today
 * @returns {Promise<{path: string}>}
 */
export async function writeMrStatus(matrixDir, repoRoot, scannedFiles, propagationEvents, today) {
  const todayStr = today.toISOString().slice(0, 10);
  const requiredBy = computeRequiredBy(scannedFiles);
  const filesObj = {};
  for (const f of scannedFiles) {
    const id = f.frontmatter?.id;
    if (!id) continue;
    const relPath = repoRoot
      ? relative(repoRoot, f.path).split('\\').join('/')
      : basename(f.path);
    filesObj[id] = {
      path: relPath,
      content_hash: f._content_hash,
      computed_staleness_days: f._computed_staleness_days,
      computed_status: f._computed_status,
      required_by: requiredBy.get(id) || [],
      last_scanned: f._last_scanned || todayStr,
    };
  }

  const status = {
    version: MR_STATUS_VERSION,
    scanner_version: SCANNER_VERSION,
    last_scan_date: todayStr,
    files: filesObj,
    propagation_events: propagationEvents.map((ev) => ({
      source: ev.source,
      target: ev.target,
      date: ev.date,
      reason: ev.reason,
    })),
  };

  const outPath = join(matrixDir, MR_STATUS_FILENAME);
  await writeFile(outPath, JSON.stringify(status, null, 2) + '\n', 'utf-8');
  return { path: outPath };
}

/**
 * Normalizza i valori Date a stringhe YYYY-MM-DD prima della serializzazione YAML.
 * Necessario perché gray-matter parsa le date YAML come Date objects, e
 * js-yaml (usato internamente) riserializzerebbe i Date come ISO datetime
 * completi (`2026-02-28T00:00:00.000Z`) invece di stringhe-data semplici.
 *
 * Agisce su:
 *   - Campi diretti: `created`, `last_updated`, `_last_scanned`
 *   - Array di oggetti: `_propagated_from[i].date`
 *
 * @param {object} data - oggetto frontmatter merged
 * @returns {object} nuovo oggetto con Date normalizzate (non muta l'input)
 */
function normalizeDatesForStringify(data) {
  const toIsoDate = (v) => {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return v;
  };
  const out = { ...data };
  for (const key of ['created', 'last_updated', '_last_scanned']) {
    if (key in out) out[key] = toIsoDate(out[key]);
  }
  if (Array.isArray(out._propagated_from)) {
    out._propagated_from = out._propagated_from.map((entry) => ({
      ...entry,
      date: toIsoDate(entry.date),
    }));
  }
  return out;
}

/**
 * Scrive in-place i campi `_*` (e altri updates) nel frontmatter di un file MR,
 * preservando il body markdown originale.
 *
 * Strategia: usa gray-matter per parsare, merge degli updates nel frontmatter,
 * normalizza le Date a stringhe YYYY-MM-DD (altrimenti js-yaml le riserializza
 * come ISO datetime completi), poi matter.stringify per ricostruire il file.
 *
 * NB: gray-matter.stringify può normalizzare altra sintassi YAML (virgolette
 * singole vs doppie, array inline → block notation). È accettabile perché
 * `_content_hash` è body-only (M12) — variazioni cosmetiche del frontmatter
 * non fanno scattare propagazione. Caveat noto in formato_MR_v0.3 §12.
 *
 * @param {string} filePath - path assoluto al file
 * @param {object} updates - campi da aggiungere/aggiornare nel frontmatter
 * @returns {Promise<void>}
 */
export async function writeFileUpdates(filePath, updates) {
  const raw = await readFile(filePath, 'utf-8');
  const parsed = matter(raw);
  const merged = normalizeDatesForStringify({ ...parsed.data, ...updates });
  const newContent = matter.stringify(parsed.content, merged);
  await writeFile(filePath, newContent, 'utf-8');
}

/**
 * Applica una lista di updates a un singolo file, fondendoli con gli updates
 * già presenti. Usato per combinare campi `_*` + `_propagated_from` in una
 * singola scrittura (evita race e doppi write sullo stesso file).
 *
 * @param {Map<string, object>} fileUpdatesMap - Map<path, mergedUpdates>
 * @param {string} filePath
 * @param {object} patch
 */
function mergeFileUpdates(fileUpdatesMap, filePath, patch) {
  const existing = fileUpdatesMap.get(filePath) || {};
  // Merge speciale per _propagated_from: array, concat invece di overwrite
  const merged = { ...existing, ...patch };
  if (existing._propagated_from && patch._propagated_from) {
    merged._propagated_from = [...existing._propagated_from, ...patch._propagated_from];
  }
  fileUpdatesMap.set(filePath, merged);
}

/**
 * Converte una lista di eventi di propagazione in patch per i file target,
 * aggiornando `_propagated_from`. Se un file target ha già entries in
 * `_propagated_from` precedenti (dalla run precedente), vengono preservate
 * salvo per lo stesso `source` (che viene sostituito con la nuova date).
 *
 * Cerca i path dei file target via lookup in scannedFiles (matching per id).
 * Se un target non è nello scan corrente → warning su stderr, evento ignorato.
 *
 * @param {Array<object>} propagationEvents
 * @param {Array<object>} scannedFiles
 * @returns {Map<string, object>} - Map<targetPath, patch>
 */
function buildPropagationPatches(propagationEvents, scannedFiles) {
  const byId = new Map();
  for (const f of scannedFiles) {
    if (f.frontmatter?.id) byId.set(f.frontmatter.id, f);
  }

  const patches = new Map();
  for (const ev of propagationEvents) {
    const targetFile = byId.get(ev.target);
    if (!targetFile) {
      console.error(`⚠️  Target di propagazione non trovato in scan: ${ev.target} (source: ${ev.source})`);
      continue;
    }
    const existing = Array.isArray(targetFile.frontmatter?._propagated_from)
      ? targetFile.frontmatter._propagated_from
      : [];
    // Preserva entries da altri source, sostituisci quelle dello stesso source
    const preserved = existing.filter((e) => e && e.id !== ev.source);
    const newEntry = { id: ev.source, date: ev.date };
    const merged = [...preserved, newEntry];

    mergeFileUpdates(patches, targetFile.path, { _propagated_from: merged });
  }
  return patches;
}

// =============================================================================
// SOTTOPROBLEMA 4 — POPULATE COMPUTED FIELDS + CLI + OUTPUT
// =============================================================================

/**
 * Calcola i campi computed _computed_staleness_days, _computed_status, _last_scanned
 * per un file, dato il suo content_hash e il suo header MR.
 *
 * Funzione pura: ritorna i valori calcolati, la scrittura la decide main().
 *
 * @param {object} frontmatter - header MR letto da gray-matter
 * @param {string} contentHashShort - hash short corrente (sha256:abcdef123456)
 * @param {Date} today - data corrente (default: new Date())
 * @returns {object} oggetto coi campi _* calcolati
 */
export function populateComputedFields(frontmatter, contentHashShort, today = new Date(), corpo = null) {
  const todayStr = today.toISOString().split('T')[0];

  // last_updated come stringa o oggetto Date (gray-matter parsa le date YAML come Date)
  const lastUpdatedRaw = frontmatter?.last_updated;
  let lastUpdatedDate = null;
  if (lastUpdatedRaw instanceof Date) {
    lastUpdatedDate = lastUpdatedRaw;
  } else if (typeof lastUpdatedRaw === 'string') {
    lastUpdatedDate = new Date(lastUpdatedRaw);
  } else if (frontmatter?.created) {
    // Fallback su created se last_updated mancante (matrix.md §3.5)
    const createdRaw = frontmatter.created;
    lastUpdatedDate = createdRaw instanceof Date ? createdRaw : new Date(createdRaw);
  }

  let computedStalenessDays = 0;
  if (lastUpdatedDate) {
    const diffMs = today.getTime() - lastUpdatedDate.getTime();
    computedStalenessDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  // staleness_threshold: ereditato da type se non dichiarato (matrix.md §1.1). Un tipo senza
  // default nella tabella (handoff, runbook…) vale 90d, come in mr-validate (0.6-n: prima qui
  // era «never» e i due strumenti davano freshness diverse sullo stesso doc)
  const explicitThreshold = frontmatter?.staleness_threshold;
  const typeDefault = frontmatter?.type ? TYPE_DEFAULT_THRESHOLDS[frontmatter.type] : null;
  const threshold = explicitThreshold || typeDefault || '90d';

  // _computed_status: fresh / warning / stale (matrix.md §3.5); retired per i doc superati o
  // dismessi, che non invecchiano (come mr-validate dalla 0.6-l)
  let computedStatus = 'fresh';
  if (frontmatter?.status === 'superseded' || frontmatter?.status === 'deprecated') {
    computedStatus = 'retired';
  } else if (frontmatter?.status === 'paused') {
    // progetto sospeso (0.6-z5, come mr-validate): non invecchia
    computedStatus = 'paused';
  } else if (frontmatter?.type === 'backlog' && corpo !== null) {
    // backlog (0.6-z6, come mr-validate): stale se una voce «In corso» è ferma oltre la soglia
    const soglia = sogliaBacklog(explicitThreshold);
    const r = soglia === Infinity ? { ferme: [] } : vociFerme(corpo, today, soglia);
    computedStatus = r.ferme.length ? 'stale' : 'fresh';
    computedStalenessDays = r.ferme.reduce((m, f) => Math.max(m, f.giorni), 0);
  } else if (threshold !== 'never') {
    const thresholdDays = parseInt(threshold.replace('d', ''), 10);
    if (computedStalenessDays > thresholdDays) {
      computedStatus = 'stale';
    } else if (computedStalenessDays > thresholdDays * 0.7) {
      computedStatus = 'warning';
    }
  }

  return {
    _content_hash: contentHashShort,
    _computed_staleness_days: computedStalenessDays,
    _computed_status: computedStatus,
    _last_scanned: todayStr,
  };
}

// =============================================================================
// MAIN CLI
// =============================================================================

/**
 * Parsing degli argomenti CLI. Esportato per i test.
 * @param {string[]} args
 * @returns {{ write: boolean, profile: string, help: boolean, pathArgs: string[], error?: string }}
 */
export function parseArgs(args) {
  const out = { write: false, profile: 'full', help: false, pathArgs: [] };
  let dryRunFlag = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--write') out.write = true;
    else if (a === '--dry-run') dryRunFlag = true;
    else if (a === '--profile') out.profile = args[++i];
    else if (a.startsWith('--profile=')) out.profile = a.slice('--profile='.length);
    else if (a.startsWith('-')) out.error = `Flag sconosciuto: ${a}`;
    else out.pathArgs.push(a);
  }
  if (out.write && dryRunFlag) out.error = '--write e --dry-run sono in conflitto';
  if (!PROFILES.includes(out.profile)) {
    out.error = `Profilo sconosciuto: "${out.profile}" (ammessi: ${PROFILES.join(', ')})`;
  }
  return out;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help || opts.pathArgs.length === 0) {
    console.log(`
mr-scanner v${SCANNER_VERSION}

USAGE:
  node mr-scanner.mjs <path1> [path2 ...] [flags]

ARGS:
  path  File .md singolo oppure directory (scan ricorsivo dei .md, con le
        esclusioni di default: node_modules, .git, dist, build, cartelle
        nascoste, repo annidati, .gitignore, test-files)

FLAGS:
  --help, -h         Mostra questo messaggio
  --write            Scrive su disco. SENZA questo flag lo scanner è in sola
                     lettura: calcola e stampa, non modifica nessun file.
  --dry-run          Equivale al default (accettato per compatibilità)
  --profile light    Con --write: non tocca i doc, scrive solo il registry di
                     matrix.md e mr-status.json. Default: full

CON --write (profilo full) lo scanner:
    1. Legge mr-status.json (se esiste) per ottenere gli hash della run precedente
    2. Scansiona i file .md, calcola _content_hash body-only + _computed_*
    3. Calcola gli eventi di propagazione staleness (vincoli D5.1)
    4. Scrive in-place i campi _* nei file MR scansionati
    5. Applica _propagated_from ai target degli eventi di propagazione
    6. Rigenera la tabella registry in matrix.md §4.1 (tra i marker)
    7. Scrive/aggiorna mr-status.json accanto a matrix.md (con required_by calcolato)
  Con --write --profile light salta i punti 4 e 5.

  matrix.md si cerca risalendo dalla cartella del primo file, fino alla root del
  repo git che lo contiene (mai oltre).

Exit code: 0 ok, 1 nessun file trovato o errore di scrittura, 2 uso scorretto.
`);
    process.exit(opts.help ? 0 : 2);
  }
  if (opts.error) {
    console.error(opts.error);
    process.exit(2);
  }

  const dryRun = !opts.write;
  const writeDocs = opts.write && opts.profile === 'full';

  console.log(`mr-scanner v${SCANNER_VERSION} ${dryRun ? '[DRY-RUN]' : '[WRITE]'} [profilo ${opts.profile}]`);
  console.log('━'.repeat(60));

  const files = collectMarkdownArgs(opts.pathArgs, {
    extraExcludedDirs: SCANNER_EXCLUDED_DIRS,
    onMissing: (arg) => console.error(`⚠️  Path non trovato: ${arg}`),
  });
  if (files.length === 0) {
    console.error('Nessun file .md trovato negli argomenti');
    process.exit(1);
  }

  console.log(`File .md raccolti: ${files.length}`);
  console.log('');

  const today = new Date();
  const scannedFiles = [];
  let withMrHeader = 0;
  let withoutMrHeader = 0;
  const illeggibili = []; // 0.6-z3: frontmatter che il parser non legge

  for (const filePath of files) {
    try {
      const { hashShort, frontmatter, body } = await computeContentHash(filePath);

      if (!frontmatter || !frontmatter.mr_version) {
        withoutMrHeader++;
        continue;
      }
      withMrHeader++;

      const computed = populateComputedFields(frontmatter, hashShort, today, body);
      const relPath = relative(process.cwd(), filePath);

      scannedFiles.push({
        path: filePath,
        relPath,
        id: frontmatter.id,
        type: frontmatter.type,
        frontmatter, // completo: serve a propagateStaleness per leggere propagate_staleness_to
        ...computed,
      });

      console.log(`📄 ${relPath}`);
      console.log(`   id:                       ${frontmatter.id}`);
      console.log(`   type:                     ${frontmatter.type}`);
      console.log(`   _content_hash:            ${computed._content_hash}`);
      console.log(`   _computed_staleness_days: ${computed._computed_staleness_days}`);
      console.log(`   _computed_status:         ${computed._computed_status}`);
      console.log(`   _last_scanned:            ${computed._last_scanned}`);
      console.log('');
    } catch (err) {
      const raw = await readFile(filePath, 'utf-8').catch(() => '');
      const rel = relative(process.cwd(), filePath);
      if (err.name === 'YAMLException' || err.mark) {
        const mr = bloccoMr(raw);
        illeggibili.push({ rel, mr });
        console.error(`${mr ? '❌' : '⚠️ '} ${rel}: ${testoIlleggibile(err, mr)}`);
      } else {
        console.error(`❌ Errore su ${filePath}: ${err.message}`);
      }
    }
  }

  // ── Sync registry (auto-discovery matrix.md) ──
  const syncResult = await syncRegistry(scannedFiles);

  // ── Leggi previousState da mr-status.json se matrix.md è stato trovato ──
  let previousState = null;
  let matrixDir = null;
  let repoRoot = null;
  if (syncResult.matrixPath) {
    matrixDir = dirname(syncResult.matrixPath);
    repoRoot = findRepoRoot(matrixDir) || matrixDir;
    previousState = await readPreviousState(matrixDir);
  }

  const propagationEvents = propagateStaleness(scannedFiles, previousState, today);

  // ── Report sync registry ──
  console.log('━'.repeat(60));
  console.log('SYNC REGISTRY §4.1 (matrix.md):');
  if (!syncResult.matrixPath) {
    console.log(`  ⚠️  ${syncResult.reason}`);
  } else {
    const relMatrix = relative(process.cwd(), syncResult.matrixPath);
    console.log(`  matrix.md:        ${relMatrix}`);
    console.log(`  File MR trovati:  ${syncResult.mrFilesCount}`);
    if (syncResult.updated) {
      console.log(`  Stato:            ${dryRun ? '🟡 WOULD UPDATE (dry-run)' : '✏️  UPDATED'}`);
      if (syncResult.lostNotes) {
        console.log(`  ⚠️  ATTENZIONE: il contenuto attuale tra i marker contiene una`);
        console.log(`      colonna "Note" con annotazioni umane. La rigenerazione la`);
        console.log(`      eliminerà. Prima di lanciare con --write, sposta le note`);
        console.log(`      in una sezione §4.1.bis sotto i marker MR-REGISTRY-END.`);
      }
      console.log(`\n  ── Nuova tabella (anteprima) ──`);
      for (const line of syncResult.newTable.split('\n')) {
        console.log(`  ${line}`);
      }
    } else {
      console.log(`  Stato:            🟢 no-op (${syncResult.reason})`);
    }
  }

  // ── Report propagazione staleness ──
  console.log('━'.repeat(60));
  console.log('PROPAGAZIONE STALENESS (D5 + D5.1):');
  if (previousState === null) {
    console.log(`  previousState:    null (mr-status.json assente — prima scansione)`);
    console.log(`  Eventi emessi:    0 (vincolo D5.1.c: no propagazione alla prima scansione)`);
  } else if (propagationEvents.length === 0) {
    console.log(`  previousState:    presente (${previousState.size} hash precedenti)`);
    console.log(`  Eventi emessi:    0 (nessun file con propagate_staleness_to ha cambiato hash)`);
  } else {
    console.log(`  previousState:    presente (${previousState.size} hash precedenti)`);
    console.log(`  Eventi emessi:    ${propagationEvents.length}`);
    for (const ev of propagationEvents) {
      console.log(`    • ${ev.source} → ${ev.target}  (${ev.date})`);
      if (ev.reason) console.log(`      reason: ${ev.reason}`);
    }
  }

  // ── Fase di scrittura (Step C.4): solo se !dryRun ──
  console.log('━'.repeat(60));
  console.log(`SCRITTURA FILE (mode: ${dryRun ? 'DRY-RUN — nessuna modifica' : 'WRITE — attiva'}):`);

  let filesWritten = 0;
  let writeErrors = 0;
  let mrStatusWritten = false;
  let registryWritten = false;

  if (!dryRun) {
    if (!writeDocs) {
      console.log(`  (profilo light: i doc non vengono toccati)`);
    }
    // 1. Costruisci le patch di propagazione (aggiornamento _propagated_from sui target)
    const propagationPatches = writeDocs
      ? buildPropagationPatches(propagationEvents, scannedFiles)
      : new Map();

    // 2. Costruisci le patch per i campi _* di ogni file scansionato
    //    (merge con eventuali patch di propagazione se il file è anche target)
    const fileUpdatesMap = new Map();
    for (const [targetPath, patch] of propagationPatches) {
      mergeFileUpdates(fileUpdatesMap, targetPath, patch);
    }
    for (const f of writeDocs ? scannedFiles : []) {
      const computedPatch = {
        _content_hash: f._content_hash,
        _computed_staleness_days: f._computed_staleness_days,
        _computed_status: f._computed_status,
        _last_scanned: f._last_scanned,
      };
      mergeFileUpdates(fileUpdatesMap, f.path, computedPatch);
    }

    // 3. Applica tutte le patch (una writeFile per file)
    for (const [filePath, updates] of fileUpdatesMap) {
      try {
        await writeFileUpdates(filePath, updates);
        filesWritten++;
        const rel = relative(process.cwd(), filePath);
        console.log(`  ✏️  ${rel}`);
      } catch (err) {
        writeErrors++;
        console.error(`  ❌ Errore scrittura ${filePath}: ${err.message}`);
      }
    }

    // 4. Scrivi matrix.md se il registry è cambiato
    if (syncResult.updated && syncResult.matrixPath && syncResult.newContent) {
      await writeFile(syncResult.matrixPath, syncResult.newContent, 'utf-8');
      registryWritten = true;
      const rel = relative(process.cwd(), syncResult.matrixPath);
      console.log(`  ✏️  ${rel} (registry §4.1 rigenerato)`);
    }

    // 5. Scrivi mr-status.json
    if (matrixDir) {
      const { path: statusPath } = await writeMrStatus(
        matrixDir,
        repoRoot,
        scannedFiles,
        propagationEvents,
        today
      );
      mrStatusWritten = true;
      const rel = relative(process.cwd(), statusPath);
      console.log(`  ✏️  ${rel} (${propagationEvents.length} propagation events)`);
    } else {
      console.log(`  ⚠️  matrix.md non trovato: mr-status.json non scritto`);
    }
  } else {
    console.log(`  (sola lettura: nessun file modificato. Con --write sarebbero scritti`);
    console.log(`   ${opts.profile === 'full' ? `${scannedFiles.length} file MR + ` : ''}matrix.md se cambiato + mr-status.json)`);
  }

  console.log('━'.repeat(60));
  console.log(`Riepilogo:`);
  console.log(`  File scansionati:                 ${files.length}`);
  console.log(`  File con header MR:               ${withMrHeader}`);
  console.log(`  File senza header MR (skippati):  ${withoutMrHeader}`);
  console.log(`  Frontmatter non leggibile:        ${illeggibili.length} (di doc MR: ${illeggibili.filter((x) => x.mr).length}; saltati, non nel registry)`);
  console.log(`  Sync registry §4.1:               ${syncResult.updated ? (dryRun ? 'would update' : 'updated') : 'no-op'}`);
  console.log(`  Eventi di propagazione:           ${propagationEvents.length}`);
  if (!dryRun) {
    console.log(`  File modificati:                  ${filesWritten}`);
    console.log(`  matrix.md §4.1 riscritto:         ${registryWritten ? 'sì' : 'no'}`);
    console.log(`  mr-status.json scritto:           ${mrStatusWritten ? 'sì' : 'no'}`);
  }
  console.log('━'.repeat(60));
  console.log(`✅ ${dryRun ? 'sola lettura (nessuna modifica)' : `scrittura attiva (${filesWritten} file MR, registry ${registryWritten ? 'riscritto' : 'invariato'}, mr-status.json ${mrStatusWritten ? 'scritto' : 'non scritto'})`}`);

  // un doc MR con il frontmatter rotto non entra nel registry: exit 1, come un errore di scrittura
  process.exit(writeErrors > 0 || illeggibili.some((x) => x.mr) ? 1 : 0);
}

// Guard: esegui main() solo se il file è invocato direttamente dalla CLI,
// non quando è importato come modulo (es. dal test script test-propagate-staleness.mjs).
// Usa fileURLToPath per normalizzare entrambi i lati su Windows/Unix.
const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = resolve(fileURLToPath(import.meta.url));
const invokedDirectly = entryPath === selfPath;

if (invokedDirectly) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
