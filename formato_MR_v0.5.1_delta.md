---
mr_version: '0.5'
id: mr/formato-v051-delta
title: Formato MR — delta v0.5 → v0.5.1 (sicurezza di default, profilo light)
type: spec
owner: rnd
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
depends_on:
- id: mr/formato-v05-delta
  reason: estende il delta v0.5
- id: mr/matrix
  reason: il profilo light è definito in matrix.md §1.8
---

# Formato MR — delta v0.5 → v0.5.1

**Data:** 2026-10-03 · **Origine:** valutazione di sicurezza dell'agente arch (`valutazione di sicurezza interna`)

## 1. Formato

Nessun campo nuovo, nessun campo rimosso: i file restano `mr_version: '0.5'` (sono accettati
anche 0.2, 0.3, 0.4). La v0.5.1 è un rilascio del tooling.

Novità di formato "d'uso": il **profilo light**, definito in `matrix.md` §1.8 e controllato da
`mr-validate --profile light`:

- obbligatori: `id`, `title`, `type`, `owner`, `status`, `created`, `last_updated`;
- opzionali: `depends_on`, `propagate_staleness_to`, `superseded_by`, `staleness_threshold`;
- `required_by` vietato nel file: lo calcola lo scanner come inverso dei `depends_on`
  e lo scrive in `mr-status.json`;
- ogni altro campo produce un warning "fuori profilo".

## 2. Tooling

| Rilievo della valutazione | Cosa cambia |
|---|---|
| S1 — contenuto dei doc inviato a DeepSeek | rimossi `mr_tag.py`, `nsparql.py`, `benchmark_global.py` e ogni client LLM; skill Claude Code `mr-tag` e `mr-query`; `kg_query.py` deterministico |
| S2 — `kg_server.py` senza auth su `0.0.0.0`, `--debug`, SSRF via `SERVICE` | `kg_server.py` rimosso; `kg_query.py` rifiuta `SERVICE` e `FROM`, caricamento grafi di rdflib disattivato |
| S3 — scanner scrive di default | sola lettura senza `--write` (`--dry-run` accettato, equivale al default) |
| S4 — `matrix.md` cercato fino alla radice del filesystem | ricerca fermata alla root del repo git |
| S5 — `rglob` senza esclusioni | esclusioni di default in tutti i tool (`tools/lib/discover.mjs`, `tools/mr-kg/mr_walk.py`) |
| S6 — `.bak` di `mr_tag` | `mr_tag.py` rimosso; nessun tool crea `.bak` |
| S7 — dipendenze non fissate | lockfile npm committati, `requirements.txt` con versioni esatte, dipendenza `glob` inutilizzata rimossa |
| Q1 — nessuna CI | GitHub Action: test Node, test Python, test "niente scritture senza `--write`" |
| Q2 — versioni disallineate | tooling 0.5.1 ovunque (readme, matrix, schema, scanner, package.json) |
| Q3 — path cablati | rimossi i default su `brain/`, `progetti/`, i progetti R&D interni; comunità del graph report dai namespace degli id |
| Q4 — scritture nei file di altri doc | `mr_enhance.py` rimosso; profilo light; `scanner --write --profile light` non tocca i doc |

## 3. Comportamento di `build_kg.py` e `graph_report.py`

- `build_kg.py` richiede almeno un `--dir` e salva il `.ttl` solo con `--write`; aggiunge a ogni
  documento le proprietà `mr:id` e `mr:namespace`.
- `graph_report.py` stampa su stdout; salva report e wiki solo con `--write`.
