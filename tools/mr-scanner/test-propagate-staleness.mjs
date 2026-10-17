#!/usr/bin/env node
/**
 * test-propagate-staleness.mjs — Test unitari per propagateStaleness() (Spike 6 C.3)
 *
 * Scenari testati (tutti sul mini-grafo in test-files/):
 *   1. Prima scansione (previousState=null) → 0 eventi (D5.1.c)
 *   2. Hash invariato → 0 eventi
 *   3. Hash cambiato su source-a con previousState valido → 2 eventi (→b, →c)
 *   4. Single-hop: stessa modifica di #3 → nessun evento chained source-a→target-d (D5.1.b)
 *   5. Target senza propagate_staleness_to (target-c modificato) → 0 eventi
 *   6. Funzione pura: nessuna mutazione del filesystem → verificato controllando
 *      che i file in test-files/ sono bit-identici prima/dopo (D5.1.a garantito
 *      implicitamente perché la funzione non fa I/O)
 *
 * Invocazione:
 *   node tools/mr-scanner/test-propagate-staleness.mjs
 *
 * Exit code 0 = tutti pass, 1 = almeno uno fallito.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

import {
  populateComputedFields,
  propagateStaleness,
  computeContentHash,
  collectAllMrFiles,
} from './mr-scanner.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_FILES_DIR = join(__dirname, 'test-files');

// ── Mini test framework ──────────────────────────────────────────────────

const results = [];
function test(name, fn) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          results.push({ name, pass: true });
          console.log(`  ✅ ${name}`);
        })
        .catch((err) => {
          results.push({ name, pass: false, err: err.message });
          console.log(`  ❌ ${name}`);
          console.log(`     ${err.message}`);
        });
    }
    results.push({ name, pass: true });
    console.log(`  ✅ ${name}`);
  } catch (err) {
    results.push({ name, pass: false, err: err.message });
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}\n       expected: ${e}\n       actual:   ${a}`);
  }
}

function assertEventCount(events, expected, msg) {
  if (events.length !== expected) {
    throw new Error(
      `${msg}\n       expected ${expected} events, got ${events.length}\n       events: ${JSON.stringify(events)}`
    );
  }
}

function assertHasEvent(events, source, target, msg) {
  const found = events.some((ev) => ev.source === source && ev.target === target);
  if (!found) {
    throw new Error(
      `${msg}\n       expected event ${source} → ${target} not found\n       events: ${JSON.stringify(events)}`
    );
  }
}

function assertNoEvent(events, source, target, msg) {
  const found = events.some((ev) => ev.source === source && ev.target === target);
  if (found) {
    throw new Error(
      `${msg}\n       unexpected event ${source} → ${target} found\n       events: ${JSON.stringify(events)}`
    );
  }
}

// ── Setup: scansione dei test files e costruzione scannedFiles mock ──────

async function setupScannedFiles() {
  // collectAllMrFiles skippa "test-files" come nome directory, quindi NON possiamo
  // usarlo per scoprire i file qui dentro. Leggiamo esplicitamente i 4 file noti.
  const fileNames = ['source-a.md', 'target-b.md', 'target-c.md', 'target-d.md'];
  const scannedFiles = [];
  for (const name of fileNames) {
    const filePath = join(TEST_FILES_DIR, name);
    const { hashShort, frontmatter } = await computeContentHash(filePath);
    scannedFiles.push({
      path: filePath,
      id: frontmatter.id,
      type: frontmatter.type,
      frontmatter,
      _content_hash: hashShort,
    });
  }
  return scannedFiles;
}

// ── Test scenarios ───────────────────────────────────────────────────────

async function runTests() {
  console.log('\ntest-propagate-staleness.mjs — Scenari C.3\n');

  const scannedFiles = await setupScannedFiles();
  const today = new Date('2026-04-12');

  // Estraggo gli hash correnti per comodità
  const currentHashes = new Map();
  for (const f of scannedFiles) currentHashes.set(f.id, f._content_hash);

  // ── Scenario 1: prima scansione (previousState=null) ──
  test('Scenario 1: previousState=null → 0 eventi (D5.1.c)', () => {
    const events = propagateStaleness(scannedFiles, null, today);
    assertEventCount(events, 0, 'prima scansione non deve emettere eventi');
  });

  // ── Scenario 2: hash invariato ──
  test('Scenario 2: hash invariati → 0 eventi', () => {
    // previousState contiene gli hash correnti → nessun cambio
    const previousState = new Map(currentHashes);
    const events = propagateStaleness(scannedFiles, previousState, today);
    assertEventCount(events, 0, 'hash invariati non devono emettere eventi');
  });

  // ── Scenario 3: source-a cambia hash → 2 eventi (→b, →c) ──
  test('Scenario 3: source-a hash cambiato → 2 eventi (→target-b, →target-c)', () => {
    // previousState ha un hash diverso per source-a, uguale per gli altri
    const previousState = new Map(currentHashes);
    previousState.set('test/source-a', 'sha256:000000000000'); // hash previo diverso
    const events = propagateStaleness(scannedFiles, previousState, today);
    assertEventCount(events, 2, 'source-a modificato deve emettere 2 eventi');
    assertHasEvent(events, 'test/source-a', 'test/target-b', 'deve esistere source-a → target-b');
    assertHasEvent(events, 'test/source-a', 'test/target-c', 'deve esistere source-a → target-c');
    // Verifica metadata degli eventi
    for (const ev of events) {
      assertEqual(ev.date, '2026-04-12', `ev.date non matcha (target ${ev.target})`);
      if (typeof ev.reason !== 'string' || ev.reason.length === 0) {
        throw new Error(`ev.reason deve essere non-vuoto per ${ev.target}`);
      }
    }
  });

  // ── Scenario 4: single-hop (D5.1.b) — target-b ha a sua volta propagate_staleness_to:[d],
  //    ma d NON deve apparire negli eventi di propagazione di source-a ──
  test('Scenario 4: single-hop, target-d NON deve ricevere propagazione indiretta (D5.1.b)', () => {
    const previousState = new Map(currentHashes);
    previousState.set('test/source-a', 'sha256:000000000000');
    const events = propagateStaleness(scannedFiles, previousState, today);
    assertNoEvent(events, 'test/source-a', 'test/target-d', 'single-hop violato: source-a → target-d non deve esistere');
    // Inoltre: siccome target-b NON ha hash cambiato (previousState ha l'hash corrente),
    // non deve emettere neanche target-b → target-d
    assertNoEvent(events, 'test/target-b', 'test/target-d', 'target-b non ha cambiato hash, non deve emettere');
  });

  // ── Scenario 5: target-c modificato ma senza propagate_staleness_to → 0 eventi dal suo lato ──
  test('Scenario 5: file modificato senza propagate_staleness_to → nessun evento da quel file', () => {
    const previousState = new Map(currentHashes);
    previousState.set('test/target-c', 'sha256:000000000000'); // target-c modificato
    // Tutti gli altri invariati
    const events = propagateStaleness(scannedFiles, previousState, today);
    // target-c non ha propagate_staleness_to → non deve emettere nulla
    const eventsFromC = events.filter((ev) => ev.source === 'test/target-c');
    assertEventCount(eventsFromC, 0, 'target-c senza propagate_staleness_to non deve emettere');
    // E siccome source-a non è cambiato, totale = 0
    assertEventCount(events, 0, 'nessun altro file ha cambiato hash');
  });

  // ── Scenario 6: verifica purezza (i file non devono essere stati modificati) ──
  test('Scenario 6: funzione pura — file bit-identici pre/post (D5.1.a implicito)', async () => {
    // Ricalcolo gli hash DI NUOVO e verifico che coincidano con quelli di setup
    for (const f of scannedFiles) {
      const { hashShort } = await computeContentHash(f.path);
      if (hashShort !== f._content_hash) {
        throw new Error(`file ${f.id} modificato dopo propagateStaleness: era ${f._content_hash}, ora ${hashShort}`);
      }
    }
  });

  // ── Scenario 7: multi-source — source-a + target-c entrambi cambiati,
  //    solo source-a emette (target-c non ha propagate_staleness_to) ──
  test('Scenario 7: multi-source misto — solo i file con propagate_staleness_to emettono', () => {
    const previousState = new Map(currentHashes);
    previousState.set('test/source-a', 'sha256:000000000000');
    previousState.set('test/target-c', 'sha256:111111111111');
    const events = propagateStaleness(scannedFiles, previousState, today);
    assertEventCount(events, 2, 'solo source-a deve emettere (2 eventi), target-c niente');
    const sources = new Set(events.map((ev) => ev.source));
    if (!sources.has('test/source-a') || sources.size !== 1) {
      throw new Error(`sources inaspettate: ${[...sources].join(',')}`);
    }
  });
}

// ── Entry point ──────────────────────────────────────────────────────────

await runTests();

// Attendi che eventuali test async si risolvano
await new Promise((r) => setTimeout(r, 50));

console.log('');
test('freshness (0.6-n): superseded/deprecated → retired; tipo senza default (handoff) → 90d come mr-validate', () => {
  const oggi = new Date('2026-10-04T12:00:00Z');
  const vecchio = { last_updated: '2026-04-21' };
  const st = (fm) => populateComputedFields(fm, 'sha256:x', oggi)._computed_status;
  assert(st({ ...vecchio, type: 'roadmap', status: 'superseded' }) === 'retired', 'superseded');
  assert(st({ ...vecchio, type: 'handoff', status: 'deprecated' }) === 'retired', 'deprecated');
  assert(st({ ...vecchio, type: 'handoff', status: 'active' }) === 'stale', `handoff attivo di 166 giorni: atteso stale (soglia 90d), ottenuto ${st({ ...vecchio, type: 'handoff', status: 'active' })}`);
  assert(st({ last_updated: '2026-09-01', type: 'handoff', status: 'active' }) === 'fresh', 'handoff attivo di 33 giorni: fresh');
  assert(st({ ...vecchio, type: 'report', status: 'active' }) === 'fresh', 'report: never');
});

test('freshness (0.6-z6): paused non invecchia; backlog misurato sulle voci «In corso», non sulla data del file', () => {
  const oggi = new Date('2026-10-16T12:00:00Z');
  const vecchio = { last_updated: '2026-01-01' };
  const st = (fm, corpo = null) => populateComputedFields(fm, 'sha256:x', oggi, corpo)._computed_status;
  assert(st({ ...vecchio, type: 'reference', status: 'paused' }) === 'paused', 'paused');
  const corpo = (d) => `# B\n\n## In corso\n| ID | Cosa | Aggiornato |\n|---|---|---|\n| B-001 | x | ${d} |\n`;
  assert(st({ ...vecchio, type: 'backlog', status: 'active' }, corpo('2026-10-10')) === 'fresh', 'voce di 6 giorni: fresh, anche col file di gennaio');
  assert(st({ ...vecchio, type: 'backlog', status: 'active' }, corpo('2026-09-20')) === 'stale', 'voce di 26 giorni: stale');
  assert(populateComputedFields({ ...vecchio, type: 'backlog' }, 'x', oggi, corpo('2026-09-20'))._computed_staleness_days === 26, 'giorni della voce più ferma');
  // date senza anno, come nei backlog pilota: «16/10» = oggi; «20/12» sarebbe nel futuro → l'anno prima
  assert(st({ ...vecchio, type: 'backlog' }, corpo('16/10')) === 'fresh', '16/10 senza anno');
  assert(st({ ...vecchio, type: 'backlog' }, corpo('20/12')) === 'stale', '20/12 senza anno: dicembre scorso');
});

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;
console.log(`━`.repeat(60));
console.log(`Risultato: ${passed}/${results.length} PASS`);
if (failed > 0) {
  console.log(`❌ ${failed} test falliti`);
  process.exit(1);
}
console.log(`✅ Tutti i test C.3 passano`);
process.exit(0);
