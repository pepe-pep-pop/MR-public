#!/usr/bin/env node
/**
 * mr-validate — Validatore Metadati Relazionali (MR) v0.5.1
 * Accetta file con mr_version 0.2, 0.3, 0.4, 0.5. Sola lettura: non scrive mai su disco.
 *
 * Livelli di validazione:
 *   1. Schema (JSON Schema via ajv)
 *   2. Integrità referenziale (tutti gli ID referenziati esistono)
 *   3. Simmetria del grafo (depends_on ↔ required_by)
 *   4. Vincoli di tipo (regole Diátaxis-derived + brain-extended v0.4)
 *   5. Vincoli di status (strong ref verso deprecated/superseded/paused)
 *   6. Freshness (staleness calcolato)
 *
 * Uso:
 *   node mr-validate.mjs                       → cwd come directory
 *   node mr-validate.mjs <dir>                 → directory ricorsiva
 *   node mr-validate.mjs <file.md>             → singolo file
 *   node mr-validate.mjs <a.md> <b.md> <dir>   → multi-arg, accumula tutti i file
 *   node mr-validate.mjs --profile light <dir> → in più, vincoli del profilo light
 *
 * Le directory si scandiscono con le esclusioni di default (../lib/discover.mjs):
 * node_modules, .git, dist, build, cartelle nascoste, repo annidati, .gitignore.
 *
 * Profilo light (matrix.md §1.8):
 *   - obbligatori: id, title, type, owner, status, created, last_updated
 *   - ammessi in più: depends_on, propagate_staleness_to, superseded_by, staleness_threshold,
 *     code_refs (v0.6), review_needed (v0.6-z) (+ mr_version, campi _*)
 *   - required_by scritto nel file → errore (si calcola come inverso di depends_on)
 *   - altri campi MR (ai_summary, related_to…) → warning "fuori profilo"
 *   - chiavi che MR non conosce, scritte da altri strumenti nello stesso blocco (pdf_options di
 *     md-to-pdf, layout di Astro…) → warning "chiave di un altro strumento", non errore di schema
 *     (0.6-z1). Nel profilo full restano errore
 *   - la simmetria depends_on ↔ required_by (livello 3) non si controlla: l'inverso
 *     è calcolato, quindi è simmetrico per costruzione
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { collectMarkdownArgs } from '../lib/discover.mjs';
import { bloccoMr, testoIlleggibile } from '../lib/illeggibile.mjs';

// ── Config ──

const STALENESS_DEFAULTS = {
  guide: 60, 'how-to': 60, reference: 30, explanation: 180,
  spec: 90, roadmap: 30, report: Infinity, log: Infinity, ppd: Infinity,
  capsule: 30, cross_cutting_doc: 60, portfolio_view: 14, html_mirror: 30, index: 60,
};

// Profilo light (matrix.md §1.8)
const LIGHT_REQUIRED = ['id', 'title', 'type', 'owner', 'status', 'created', 'last_updated'];
const LIGHT_OPTIONAL = ['depends_on', 'propagate_staleness_to', 'superseded_by', 'staleness_threshold', 'code_refs', 'review_needed'];
const PROFILES = ['full', 'light'];
let SCHEMA_KEYS = new Set(); // chiavi di primo livello dello schema MR (le altre sono di altri strumenti)

// ── Helpers ──

/**
 * Nota A11 del PRD v0.6: nei code_refs del frontmatter `commit:` deve essere una stringa
 * tra apici. Senza apici YAML legge 0164750 come numero (js-yaml: ottale) e 3e45123 come
 * float. Il controllo è sul testo grezzo, perché il parser perde l'informazione sugli apici.
 * Le ancore <!-- mr:code verified=... --> sono esenti: non passano da YAML.
 * @returns {string[]} valori trovati senza apici
 */
function unquotedCommits(raw) {
  const t = raw.replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) return [];
  const end = t.indexOf('\n---', 4);
  const fm = end > 0 ? t.slice(4, end) : '';
  if (!/^code_refs\s*:/m.test(fm)) return [];
  const block = fm.slice(fm.search(/^code_refs\s*:/m)).split(/\n(?=[^\s#-])/)[0];
  const bad = [];
  for (const m of block.matchAll(/\bcommit\s*:\s*([^\s,}#][^,}\n#]*)/g)) {
    const v = m[1].trim();
    if (!/^['"]/.test(v)) bad.push(v);
  }
  return bad;
}

/**
 * Calcola sha256 short del body markdown post-normalizzazione.
 * Allineato alla decisione D3.1 di Spike 6 (vedi piano_spike6.md):
 * normalizza line endings CRLF→LF e trim trailing newline EOF, lascia
 * invariato whitespace di riga e tab/spaces (potenzialmente semantici).
 * Garantisce hash deterministici cross-platform e coerenza con mr-scanner.mjs.
 */
function computeContentHash(content) {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // ancore <!-- mr:code ... --> escluse dall'hash (nota A2 del PRD v0.6): righe che
    // contengono solo l'ancora spariscono, altrimenti si toglie solo il commento
    .replace(/^[ \t]*<!--\s*mr:code\b[^>]*-->[ \t]*\n/gm, '')
    .replace(/<!--\s*mr:code\b[^>]*-->/g, '')
    .replace(/\n+$/g, '');
  return 'sha256:' + createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 12);
}

function parseStalenessThreshold(threshold, type) {
  if (!threshold) return STALENESS_DEFAULTS[type] ?? 90;
  if (threshold === 'never') return Infinity;
  const match = threshold.match(/^(\d+)d$/);
  return match ? parseInt(match[1], 10) : 90;
}

function daysBetween(dateStr, now) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.floor((now - d) / (1000 * 60 * 60 * 24));
}

// ── Raccoglitore risultati ──

class ValidationReport {
  constructor() {
    this.errors = [];
    this.warnings = [];
    this.info = [];
    this.documents = [];
    this.saltati = 0; // frontmatter non leggibile (0.6-z3)
  }

  error(file, msg) { this.errors.push({ file, msg }); }
  warn(file, msg) { this.warnings.push({ file, msg }); }
  log(file, msg) { this.info.push({ file, msg }); }

  print() {
    const sep = '─'.repeat(60);
    console.log('\n' + sep);
    console.log('  MR-VALIDATE — Report di validazione');
    console.log(sep);

    console.log(`\n  Documenti analizzati: ${this.documents.length}`);
    console.log(`  File senza header MR: skippati`);
    console.log(`  File con frontmatter non leggibile (saltati): ${this.saltati}\n`);

    if (this.info.length > 0) {
      console.log('  ℹ️  INFO:');
      for (const { file, msg } of this.info) {
        console.log(`     ${file}: ${msg}`);
      }
      console.log();
    }

    if (this.warnings.length > 0) {
      console.log('  ⚠️  WARNING:');
      for (const { file, msg } of this.warnings) {
        console.log(`     ${file}: ${msg}`);
      }
      console.log();
    }

    if (this.errors.length > 0) {
      console.log('  ❌ ERRORI:');
      for (const { file, msg } of this.errors) {
        console.log(`     ${file}: ${msg}`);
      }
      console.log();
    }

    // ── Freshness table ──
    if (this.documents.length > 0) {
      console.log('  📊 FRESHNESS:');
      console.log('  ' + '-'.repeat(75));
      console.log(`  ${'ID'.padEnd(28)} ${'Tipo'.padEnd(12)} ${'Giorni'.padEnd(8)} ${'Soglia'.padEnd(8)} Stato`);
      console.log('  ' + '-'.repeat(75));
      for (const doc of this.documents) {
        const days = doc.stalenessDays !== null ? String(doc.stalenessDays) : 'n/a';
        const thresh = doc.threshold === Infinity ? 'never' : `${doc.threshold}d`;
        const icon = { fresh: '🟢', warning: '🟡', stale: '🔴', unknown: '⚪', retired: '⚫' }[doc.freshnessStatus];
        console.log(`  ${doc.id.padEnd(28)} ${doc.type.padEnd(12)} ${days.padEnd(8)} ${thresh.padEnd(8)} ${icon} ${doc.freshnessStatus}`);
      }
      console.log('  ' + '-'.repeat(75));
      console.log();
    }

    // ── Summary ──
    console.log(sep);
    const ok = this.documents.length - this.errors.length;
    const exitCode = this.errors.length > 0 ? 1 : 0;
    const badge = exitCode === 0 ? '✅ PASS' : '❌ FAIL';
    console.log(`  ${badge}  |  ${this.documents.length} docs  |  ${this.errors.length} errori  |  ${this.warnings.length} warning  |  ${this.saltati} saltati (frontmatter non leggibile)`);
    console.log(sep + '\n');
    return exitCode;
  }
}

// ── Validazione ──

function validate(mdFiles, baseDir, profile = 'full') {
  const report = new ValidationReport();
  const now = new Date();

  // 1. Carica schema
  const schemaPath = new URL('./mr-schema.json', import.meta.url);
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  SCHEMA_KEYS = new Set(Object.keys(schema.properties || {}));

  // 2. Parsa tutti i file .md (mdFiles è già stato raccolto dal main)
  const registry = new Map();   // id → { data, file, content }
  const allIds = new Set();

  for (const filePath of mdFiles) {
    const raw = readFileSync(filePath, 'utf8');
    const rel = relative(baseDir, filePath);

    let parsed;
    try {
      parsed = matter(raw);
    } catch (e) {
      // 0.6-z3: un doc MR con il frontmatter rotto è un errore, non un doc in meno nel conteggio
      report.saltati++;
      if (bloccoMr(raw)) report.error(rel, testoIlleggibile(e, true));
      else report.warn(rel, testoIlleggibile(e, false));
      continue;
    }

    // Skip file senza header MR
    if (!parsed.data || !parsed.data.mr_version) continue;

    // Normalizza Date → stringa ISO (gray-matter parsa date YAML come Date objects)
    const data = parsed.data;
    for (const key of ['created', 'last_updated', '_last_scanned']) {
      if (data[key] instanceof Date) {
        data[key] = data[key].toISOString().slice(0, 10);
      }
    }
    const id = data.id;

    // ── Livello 1: Schema validation ──
    const valid = validateSchema(data);
    if (!valid) {
      for (const err of validateSchema.errors) {
        // profilo light (0.6-z1): una chiave sconosciuta alla radice è di un altro strumento, warning sotto
        if (profile === 'light' && err.keyword === 'additionalProperties' && !err.instancePath) continue;
        const path = err.instancePath || '(root)';
        report.error(rel, `Schema: ${path} ${err.message}`);
      }
    }

    // ── Livello 1a: hash di commit tra apici (nota A11) ──
    for (const v of unquotedCommits(raw)) {
      report.error(rel, `code_refs: verified.commit deve essere una stringa tra apici (es. commit: '${v}'), trovato ${v}`);
    }

    // ── Livello 1a-bis: verified.date raccomandata (nota A16) ──
    for (const [i, r] of (Array.isArray(data.code_refs) ? data.code_refs : []).entries()) {
      if (r && r.verified && r.verified.commit && !r.verified.date) {
        report.warn(rel, `code_refs[${i}]: verified senza date (raccomandata: serve a rimappare dopo una riscrittura della storia)`);
      }
    }

    // ── Livello 1a-ter: review_needed (0.6-z): il doc dichiara parti da aggiornare ──
    if (typeof data.review_needed === 'string' && data.review_needed.trim() && data.status !== 'superseded' && data.status !== 'deprecated') {
      report.warn(rel, `da aggiornare (review_needed): ${data.review_needed.trim()}`);
    }

    // ── Livello 1b: profilo light ──
    if (profile === 'light') {
      for (const key of LIGHT_REQUIRED) {
        if (data[key] === undefined || data[key] === null || data[key] === '') {
          report.error(rel, `Profilo light: campo obbligatorio mancante "${key}"`);
        }
      }
      if (data.required_by !== undefined) {
        report.error(rel, `Profilo light: "required_by" non va scritto nel file (si calcola dai depends_on degli altri doc)`);
      }
      const allowed = new Set(['mr_version', ...LIGHT_REQUIRED, ...LIGHT_OPTIONAL]);
      for (const key of Object.keys(data)) {
        if (key === 'required_by' || key.startsWith('_') || allowed.has(key)) continue;
        if (!SCHEMA_KEYS.has(key)) report.warn(rel, `Profilo light: chiave di un altro strumento "${key}" (non è di MR: ignorata)`);
        else report.warn(rel, `Profilo light: campo fuori profilo "${key}"`);
      }
    }

    // Registra nel registry
    if (id) {
      if (registry.has(id)) {
        report.error(rel, `ID duplicato: "${id}" (già in ${registry.get(id).file})`);
      } else {
        registry.set(id, { data, file: rel, content: parsed.content });
        allIds.add(id);
      }
    }

    // Calcola freshness
    const stalenessDays = daysBetween(data.last_updated || data.created, now);
    const threshold = parseStalenessThreshold(data.staleness_threshold, data.type);
    let freshnessStatus = 'unknown';
    // un doc superato o dismesso non invecchia: è fuori servizio per definizione (0.6-l)
    if (data.status === 'superseded' || data.status === 'deprecated') {
      freshnessStatus = 'retired';
    } else if (stalenessDays !== null && threshold !== Infinity) {
      if (stalenessDays < threshold * 0.7) freshnessStatus = 'fresh';
      else if (stalenessDays < threshold) freshnessStatus = 'warning';
      else freshnessStatus = 'stale';
    } else if (threshold === Infinity) {
      freshnessStatus = 'fresh'; // never stale
    }

    // Content hash
    const hash = computeContentHash(parsed.content);
    report.log(rel, `_content_hash calcolato: ${hash}`);

    report.documents.push({
      id: id || '(no id)',
      type: data.type || '?',
      stalenessDays,
      threshold,
      freshnessStatus,
      file: rel,
    });
  }

  if (report.documents.length === 0) {
    console.log('\n  Nessun file con header MR trovato.\n');
    return 0;
  }

  // Inverso calcolato di depends_on: id target → [id sorgenti]
  const computedRequiredBy = new Map();
  for (const [id, { data }] of registry) {
    for (const dep of data.depends_on || []) {
      if (!dep || !dep.id) continue;
      if (!computedRequiredBy.has(dep.id)) computedRequiredBy.set(dep.id, []);
      computedRequiredBy.get(dep.id).push(id);
    }
  }
  // Nel profilo light vale l'inverso calcolato; nel full quello dichiarato
  const requiredByCount = (id, data) =>
    profile === 'light'
      ? (computedRequiredBy.get(id) || []).length
      : (data.required_by || []).length;

  // 3. Validazione cross-document
  for (const [id, { data, file }] of registry) {

    // ── Livello 2: Integrità referenziale ──
    const relFields = ['depends_on', 'required_by', 'related_to', 'propagate_staleness_to'];
    for (const field of relFields) {
      if (!data[field]) continue;
      for (const entry of data[field]) {
        if (!allIds.has(entry.id)) {
          const strength = entry.strength || (field === 'related_to' ? 'weak' : 'strong');
          if (strength === 'strong') {
            report.error(file, `Riferimento rotto (${field}): "${entry.id}" non esiste nel registry`);
          } else {
            report.warn(file, `Riferimento rotto weak (${field}): "${entry.id}" non esiste nel registry`);
          }
        }
      }
    }

    // superseded_by è un riferimento (0.6-l, pilota _arch): deve esistere, e va con status superseded
    if (data.superseded_by !== undefined) {
      const target = String(data.superseded_by);
      if (!/^[a-z0-9][a-z0-9/_-]*[a-z0-9]$/.test(target)) {
        report.error(file, `superseded_by: "${target}" non è un id valido`);
      } else if (!allIds.has(target)) {
        report.error(file, `Riferimento rotto (superseded_by): "${target}" non esiste nel registry`);
      } else if (target === id) {
        report.error(file, `superseded_by punta al documento stesso`);
      }
      if (data.status !== 'superseded') {
        report.warn(file, `superseded_by presente ma status è "${data.status}" (atteso: superseded)`);
      }
    }

    // ── Livello 3: Simmetria del grafo (solo profilo full) ──
    if (profile === 'full' && data.depends_on) {
      for (const dep of data.depends_on) {
        const target = registry.get(dep.id);
        if (target && target.data.required_by) {
          const hasInverse = target.data.required_by.some(r => r.id === id);
          if (!hasInverse) {
            report.warn(file, `Asimmetria grafo: depends_on "${dep.id}" ma "${dep.id}" non ha required_by "${id}"`);
          }
        } else if (target && !target.data.required_by) {
          report.warn(file, `Asimmetria grafo: depends_on "${dep.id}" ma "${dep.id}" non ha campo required_by`);
        }
      }
    }

    // ── Livello 4: Vincoli di tipo ──
    if (data.type === 'report' && !data.depends_on?.length) {
      report.warn(file, `Vincolo tipo: un "report" dovrebbe avere almeno un depends_on`);
    }
    if (data.type === 'roadmap' && !data.depends_on?.length) {
      report.warn(file, `Vincolo tipo: un "roadmap" dovrebbe avere almeno un depends_on verso spec o ppd`);
    }
    if (data.type === 'spec' && requiredByCount(id, data) === 0) {
      report.warn(file, `Vincolo tipo: una "spec" dovrebbe avere almeno un required_by`);
    }
    // v0.4: vincoli per i nuovi tipi brain-extended
    if (data.type === 'capsule' && requiredByCount(id, data) === 0) {
      report.warn(file, `Vincolo tipo: una "capsule" dovrebbe avere almeno un required_by (la capsule serve a una portfolio_view)`);
    }
    if (data.type === 'portfolio_view' && !data.depends_on?.length) {
      report.warn(file, `Vincolo tipo: una "portfolio_view" dovrebbe avere almeno un depends_on verso le capsule`);
    }
    if (data.type === 'html_mirror' && !data.depends_on?.length) {
      report.warn(file, `Vincolo tipo: un "html_mirror" dovrebbe avere esattamente un depends_on al .md sorgente`);
    }
    if (data.type === 'cross_cutting_doc' && !data.related_to?.length) {
      report.warn(file, `Vincolo tipo: un "cross_cutting_doc" dovrebbe avere almeno un related_to verso una capsule`);
    }

    // ── Livello 5: Vincoli di status ──
    if (data.depends_on) {
      for (const dep of data.depends_on) {
        const target = registry.get(dep.id);
        if (!target) continue;
        const strength = dep.strength || 'strong';
        // un doc storico (superseded/deprecated) che dipende da un doc storico è coerente: al
        // massimo un warning (0.6-p; caso vero: roadmap e hof dismessi → architettura dismessa)
        const sourceRetired = data.status === 'superseded' || data.status === 'deprecated';
        for (const st of ['deprecated', 'superseded']) {
          if (target.data.status !== st || strength !== 'strong') continue;
          if (sourceRetired) report.warn(file, `depends_on strong verso documento ${st}: "${dep.id}" (anche questo doc è ${data.status}: coerente)`);
          else report.error(file, `depends_on strong verso documento ${st}: "${dep.id}"`);
        }
        if (target.data.status === 'draft' && strength === 'strong') {
          report.warn(file, `depends_on strong verso documento draft: "${dep.id}"`);
        }
        if (target.data.status === 'paused' && strength === 'strong') {
          report.warn(file, `depends_on strong verso documento paused: "${dep.id}" (paused = potrebbe tornare; rivedere se la dipendenza regge)`);
        }
      }
    }

    // ── Livello 6: Freshness (stale alert) ──
    const doc = report.documents.find(d => d.id === id);
    if (doc && doc.freshnessStatus === 'stale') {
      report.warn(file, `Documento stale: ${doc.stalenessDays} giorni (soglia: ${doc.threshold}d)`);
    }
  }

  return report.print();
}

// ── Main ──

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`
mr-validate (MR v0.5.1) — sola lettura

USAGE:
  node mr-validate.mjs [path ...] [--profile full|light]

  path       file .md o directory (default: cwd)
  --profile  full (default) | light — vedi matrix.md §1.8

Exit code: 0 nessun errore, 1 errori di validazione, 2 uso scorretto.
`);
  process.exit(0);
}

let profile = 'full';
const targets = [];
for (let i = 0; i < rawArgs.length; i++) {
  const a = rawArgs[i];
  if (a === '--profile') {
    profile = rawArgs[++i];
  } else if (a.startsWith('--profile=')) {
    profile = a.slice('--profile='.length);
  } else if (a.startsWith('-')) {
    console.error(`Flag sconosciuto: ${a}`);
    process.exit(2);
  } else {
    targets.push(a);
  }
}
if (!PROFILES.includes(profile)) {
  console.error(`Profilo sconosciuto: "${profile}" (ammessi: ${PROFILES.join(', ')})`);
  process.exit(2);
}
if (targets.length === 0) targets.push('.');

// Base directory per i path relativi nell'output: cwd dell'invocazione
const baseDir = process.cwd();

// Raccoglie tutti i file .md da tutti i target (file singolo o dir ricorsiva)
// le cartelle test-files (fixture con errori voluti) si saltano quando si valida una cartella
// che le contiene, come fa lo scanner; passandole direttamente si validano (0.6-l)
const allFiles = collectMarkdownArgs(targets, {
  extraExcludedDirs: ['test-files'],
  onMissing: (arg) => console.error(`⚠️  Path non trovato: ${arg}`),
});

console.log(`
  Targets: ${targets.join(', ')}`);
console.log(`  Profilo: ${profile}`);
console.log(`  File .md raccolti: ${allFiles.length}`);

const exitCode = validate(allFiles, baseDir, profile);
process.exit(exitCode);
