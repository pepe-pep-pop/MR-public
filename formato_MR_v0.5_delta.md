---
mr_version: "0.5"
id: mr/formato-v05-delta
title: "Formato MR v0.5 — delta v0.4 → v0.5"
type: spec
owner: mr
status: active
created: '2026-06-25'
last_updated: '2026-06-25'
ai_summary: >-
  Delta del formato MR v0.4 → v0.5. Canonizzazione del layer Knowledge Graph +
  Neuro-Symbolic QA sviluppato in SPIKE A (maggio-giugno 2026). 7 tool Python
  spostati in tools/mr-kg/: build_kg, nsparql, mr_tag, mr_enhance, graph_report,
  kg_server, benchmark_global. Zero breaking changes su v0.3/v0.4.
ai_keywords:
- mr
- v0.5
- formato
- delta
- knowledge-graph
- neuro-symbolic
- nsparql
- build_kg
- mr_tag
- mr_enhance
- graph_report
- kg_server
priority: high
depends_on:
- id: mr/formato-v04-delta
  reason: "v0.5 è estensione additiva di v0.4 — v0.4 è prerequisito"
  rel_type: extends
- id: mr/formato-mr-v03
  reason: "La spec base (M1-M16) resta in v0.3.md — v0.5 è layer aggiuntivo"
  rel_type: extends
- id: mr/matrix
  reason: "matrix.md v0.4 aggiornata con §8 KG Pipeline"
  rel_type: references
external_dependencies:
- path: "<ricerca-interna>/handoff/HANDOFF-SPIKE-A.md"
  reason: "Handoff principale di SPIKE A — neuro-symbolic QA + KG extension. 150
    docs, 4,388 triples, 85-90% NL→SPARQL accuracy."
  type: brief
- path: "<ricerca-interna>/handoff/HANDOFF-PRISMA-KG.md"
  reason: "Handoff di integrazione PRISMA→MR. Design per Edo: PRISMA scrive
    MR-tagged .md → build_kg.py → nsparql.py. Pipeline gia' pronta."
  type: brief
- path: "<ricerca-interna>/report/SPIKE-A-REPORT.md"
  reason: "Report completo di SPIKE A (2026-05-17): architettura, benchmark (20
    domande), miglioramenti P1-P6."
  type: brief
staleness_threshold: never
---

# Formato MR v0.5 — delta v0.4 → v0.5

> **Nota v0.5.1 (2026-10-03):** i tool `mr_tag.py`, `nsparql.py`, `kg_server.py`, `mr_enhance.py` e `benchmark_global.py` descritti qui sono stati rimossi, insieme a ogni chiamata a DeepSeek e Ollama. Vedi `formato_MR_v0.5.1_delta.md`. Questo documento resta come specifica storica della v0.5.

> **Cos'è questo file**: documenta SOLO le differenze tra v0.4 e v0.5. La spec base (M1-M16, regole strutturali) resta in `formato_MR_v0.3.md` (immutabile). Il delta v0.3→v0.4 resta in `formato_MR_v0.4_delta.md` (immutabile). Per usare v0.5 come consumer LLM, leggi v0.3 + v0.4_delta + questo file.
>
> **Origine**: SPIKE A (Neuro-Symbolic QA), sessioni 17-18 maggio + 25 maggio + 3 giugno 2026. Sviluppato in `<ricerca-interna>/`, field-tested su 150+ documenti reali da 8 progetti (brain, MR, progetti interni). Canonizzato come bump v0.5 ufficiale di MR il 2026-06-25.
>
> **Filosofia v0.5**: estensione **additiva** di v0.3/v0.4, **zero breaking changes**. Il nuovo layer è costituito da tool Python opzionali che consumano i file MR esistenti per generare un Knowledge Graph RDF e un motore di interrogazione neuro-simbolico (NL→SPARQL→KG→NL). I file v0.3 e v0.4 pre-esistenti restano completamente funzionanti anche senza questo layer.

---

## Sommario delle modifiche

| # | Modifica | File toccati | Impatto |
|---|---|---|---|
| 1 | `mr_version` enum: aggiunto `"0.5"` | `mr-schema.json`, `matrix.md` §1.2 | Permette di marcare nuovi file v0.5 senza errore schema |
| 2 | Nuovo layer tooling Python: KG pipeline | `tools/mr-kg/` (7 tool + config) | MR frontmatter → RDF Turtle → NL queryable. Struttura identica a `tools/mr-validate/` e `tools/mr-scanner/` |
| 3 | Nuova sezione `matrix.md` §8 | `matrix.md` §8.1–§8.8 | Knowledge Graph Pipeline: namespace canonico, tool reference, quick commands |
| 4 | Aggiornamento `matrix.md` §5.10 | `matrix.md` §5.10 | Operational Instructions: 3 nuovi prompt few-shot per KG operations |
| 5 | Nuovo doc delta (questo file) | `formato_MR_v0.5_delta.md` | Documenta l'intero layer KG come estensione canonica |
| 6 | Aggiornamento `piano-RnD-app-00.md` | `piano-RnD-app-00.md` | Nuova riga tabella stato: Spike A canonizzato come v0.5 |
| 7 | Aggiornamento `log.md` | `log.md` Step 17 | Registra il bump v0.5 nello storico |

**Costo totale upstream**: ~50 LoC modificati su `mr-schema.json` + tool esistenti già compatibili (zero refactor) + ~1,200 righe di codice Python spostato (non modificato), ~200 righe di delta doc, ~100 righe di README/config. Zero breaking changes, zero retrocompatibilità da gestire.

---

## 1. Nuovo `mr_version: "0.5"`

### 1.1 Schema enum

`mr-schema.json` accetta ora `"0.2"` (legacy), `"0.3"`, `"0.4"`, `"0.5"`. I file v0.3 e v0.4 esistenti restano validi senza migrazione.

### 1.2 Quando usare `"0.5"` invece di `"0.4"`

- **Sempre** se il file viene taggato da `mr_tag.py` (auto-tagging LLM) — il tool usa v0.5 per default.
- **Opzionale** in tutti gli altri casi. I tool Python NON richiedono `mr_version: "0.5"` per funzionare: `build_kg.py` processa qualsiasi versione supportata dallo schema. Il bump serve solo a marcare l'epoca di taggatura.

### 1.3 I 4 file pilota upstream restano v0.3

Per scelta esplicita (identica a v0.4): `PPD_00.md`, `piano-RnD-app-00.md`, `ricerca-00-MR.md`, `PRD_MR_v0.1.md` non usano feature v0.5 → restano `mr_version: "0.3"` come **prova vivente di retrocompatibilità**.

---

## 2. Knowledge Graph Pipeline — Architettura

### 2.1 Data flow

```
                  ┌─────────────────────┐
                  │  MR-tagged .md files │
                  │  (frontmatter YAML)  │
                  └────────┬────────────┘
                           │
                           ▼
                  ┌─────────────────────┐
                  │    build_kg.py      │
                  │  MR→RDF Turtle     │
                  │  (528 righe)        │
                  └────────┬────────────┘
                           │
                           ▼
                  ┌─────────────────────┐
                  │   rnd-kg.ttl (.ttl) │
                  │   RDF Knowledge     │
                  │   Graph             │
                  └────────┬────────────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
      ┌────────────┐ ┌──────────┐ ┌──────────┐
      │ nsparql.py │ │graph_    │ │kg_server │
      │NL→SPARQL→ │ │report.py │ │.py       │
      │KG→NL      │ │Graph     │ │Flask     │
      │(853 righe) │ │Report    │ │endpoint  │
      └────────────┘ └──────────┘ └──────────┘
```

### 2.2 Tool che alimentano il KG (upstream)

Prima di `build_kg.py`, due tool preparano i file `.md`:

- **`mr_tag.py`**: auto-genera frontmatter MR analizzando il contenuto del documento via LLM (DeepSeek o Ollama). Supporta singolo file e batch con `--apply --validate`.
- **`mr_enhance.py`**: fissa asimmetrie `depends_on↔required_by`, aggiunge relazioni cross-project, arricchisce il grafo delle dipendenze. Idempotente: non sovrascrive relazioni esistenti.

### 2.3 Tool che consumano il KG (downstream)

- **`nsparql.py`**: NL → SPARQL → KG → NL. DeepSeek 90%, Ollama 85% (benchmark 30 domande). Pipeline: extract_schema() → _nl_to_sparql() → _validate_sparql() → RDFLib execute → _results_to_nl().
- **`graph_report.py`**: GRAPH_REPORT.md con 6 sezioni: Overview, God Nodes, Communities, Bridges, Staleness, Suggested Questions. Flag `--wiki` per export per-community.
- **`kg_server.py`**: Flask SPARQL endpoint deployabile su pepserv. Supporta raw SPARQL e NL→SPARQL via POST. Endpoint `/health`, `/sparql`.

### 2.4 Integrazione con tool esistenti

- `build_kg.py` consuma già i campi computed `_computed_status` e `_computed_staleness_days` scritti da `mr-scanner.mjs`
- `mr_enhance.py` fissa asimmetrie che `mr-validate.mjs` segnala come warning
- Il workflow completo è documentato in §5 di questo delta

---

## 3. Namespace RDF canonico

### 3.1 Namespace

Tutti i tool Python usano il namespace RDF canonico:

```turtle
@prefix rnd: <https://rnd-lab.local/> .
@prefix mr:  <https://rnd-lab.local/mr#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
```

- **`rnd:`** — risorsa documento/concept. URI derivata dall'`id` MR: `rnd:<slug-con-trattini>`
- **`mr:`** — predicati e classi del vocabolario MR. Esempi: `mr:dependsOn`, `mr:status`, `mr:Document`, `mr:Active`, `mr:High`

### 3.2 Predicati RDF

| Predicato MR | Dominio | Range | Mappatura frontmatter |
|---|---|---|---|
| `mr:dependsOn` | Document | Document | `depends_on[].id` |
| `mr:requiredBy` | Document | Document | `required_by[].id` |
| `mr:relatedTo` | Document | Document | `related_to[].id` |
| `mr:hasTopic` | Document | Concept | `ai_keywords[]` + headings dal body |
| `mr:status` | Document | Status | `status` |
| `mr:priority` | Document | Priority | `priority` |
| `mr:stalenessDays` | Document | xsd:integer | `_computed_staleness_days` |
| `mr:contentHash` | Document | xsd:string | `_content_hash` |

### 3.3 TYPE_MAP canonico (da `build_kg.py`)

| MR type | Classe RDF |
|---|---|
| `index` | `mr:Index` |
| `cross_cutting_doc` | `mr:CrossCuttingDoc` |
| `capsule` | `mr:ProjectCapsule` |
| tutti gli altri | `mr:Document` |

### 3.4 STATUS_MAP canonico

| MR status | Classe RDF |
|---|---|
| `active` | `mr:Active` |
| `draft` | `mr:Draft` |
| `deprecated` | `mr:Deprecated` |
| `superseded` | `mr:Superseded` |
| `paused` | `mr:Paused` |
| `fresh` (computed) | `mr:Fresh` |
| `stale` (computed) | `mr:Stale` |
| `warning` (computed) | `mr:Warning` |

---

## 4. Tool `build_kg.py` — MR frontmatter → RDF Turtle

### 4.1 Funzione

Legge file `.md` con frontmatter MR, estrae YAML, genera triple RDF. Output: RDF Turtle (.ttl).

### 4.2 Dettaglio tecnico

- **Dipendenze**: `rdflib`, `pyyaml`
- **Argomenti CLI**: `--dir` (scan directory), `--output` (path output), `--exclude` (pattern da saltare), `--extract-headings` (estrae concept da heading/grassetto del body)
- **URI convention**: `slug_to_uri()` converte `mr/report-spike-3` in `rnd:mr-report-spike-3`. Sostituisce `/`, `.`, `_` con `-`
- **Concept extraction**: opzionale (`--extract-headings`). Estrae heading `##` e testo in **grassetto** come nodi Concept, linkati al documento via `mr:hasTopic`

### 4.3 Esempio di output

```turtle
rnd:mr-piano-rnd a mr:Document ;
    rdfs:label "Piano R&D — Metadati Relazionali" ;
    mr:status mr:Active ;
    mr:priority mr:High ;
    mr:dependsOn rnd:mr-ppd-00 ;
    mr:hasTopic mr:Validazione, mr:Spike, mr:Roadmap .
```

---

## 5. Tool `nsparql.py` — Neuro-Symbolic QA

### 5.1 Architettura

```
User question ("Which documents depend on GlobeView?")
        │
        ▼
[extract_schema()] → KG schema description
        │
        ▼
[_nl_to_sparql()] → LLM prompt = schema + question + instructions + few-shot examples
        │
        ▼
LLM returns SPARQL → [_validate_sparql()] → auto-fix common issues
        │
        ▼
RDFLib executes SPARQL → _format_results()
        │
        ▼
[_results_to_nl()] → LLM translates to natural language
        │
        ▼
Final answer
```

### 5.2 LLM backends

| Backend | Modello | Hardware | Accuracy | Latency |
|---|---|---|---|---|
| **Ollama** (locale) | `qwen2.5-coder:7b` (default) o `qwen3:14b` | RTX 4070, 12GB VRAM | 70-85% | 7.27s |
| **DeepSeek** (cloud) | `deepseek-v4-pro` o `deepseek-coder` | Cloud API | 73-90% | 2.59s |

### 5.3 Benchmark (30 domande, 25 maggio 2026)

| Modello | Score | Δ vs baseline |
|---|---|---|
| Ollama (qwen2.5-coder:7b) | 21/30 (70%) | +17pp |
| DeepSeek (cloud) | 22/30 (73%) | = |

### 5.4 Prompt improvements (maggio 2026)

- Multi-keyword decomposition (`FILTER(CONTAINS(cpo) && CONTAINS(spike) && CONTAINS(roadmap))`)
- Project prefix mapping table (progetto A→`a/`, progetto B→`b/`, progetto C→`c/`)
- Staleness query pattern (`_computed_status`, `_computed_staleness_days`)
- 7 SPARQL examples nel prompt (project ID search, multi-keyword, stale docs)

### 5.5 Flag notevoli

- `--deepseek`: usa DeepSeek API invece di Ollama locale
- `--interactive`: REPL mode per domande consecutive (contesto cumulativo)
- `--verify-schema`: mostra schema estratto del KG
- `--verify-queries`: esegue 6 verification queries predefinite
- `--kg <path>`: carica KG custom

---

## 6. Tool di preparazione: `mr_tag.py` + `mr_enhance.py`

### 6.1 `mr_tag.py` — Auto-generazione frontmatter

- Analizza il contenuto del documento via LLM (DeepSeek preferito, fallback Ollama)
- Estrae: `id`, `title`, `type`, `status`, `created`, `last_updated`, `depends_on`, `required_by`, `ai_summary`, `ai_keywords`, `priority`
- Supporta: singolo file (`--apply`), batch folder (`--batch`), validate post-tag (`--validate`), exclude pattern (`--exclude`)
- **Caveat**: il risultato LLM va sempre validato. `--validate` esegue `mr-validate.mjs` subito dopo il tag

### 6.2 `mr_enhance.py` — Relationship Enricher

- Costruisce un registry completo di tutti gli ID MR su folder multiple
- Per ogni `depends_on`, aggiunge il `required_by` inverso (se mancante)
- Aggiunge `propagate_staleness_to` basato sulla semantica del tipo di documento
- Aggiunge relazioni cross-project basate su occorrenze di termini comuni
- **Idempotente**: non sovrascrive relazioni esistenti, solo aggiunge mancanti
- Dry-run di default: preview senza scrittura; `--apply` per scrivere

---

## 7. Tool `graph_report.py` — GRAPH_REPORT.md

### 7.1 Output

Genera un report Markdown con 6 sezioni deterministiche (SPARQL-only, nessun LLM):

1. **Overview**: statistiche del KG (documenti, concetti, triple, relazioni, status, priority)
2. **God Nodes**: top 20 documenti più connessi per grado (combined `depends_on` + `required_by` + `related_to` + `hasTopic`)
3. **Project Communities**: documenti raggruppati per prefix MR (MR, progetto A, progetto B, brain, ecc.)
4. **Cross-Project Bridges**: connessioni tra progetti diversi
5. **Staleness Heat Map**: percentuale stale/warning/fresh per progetto
6. **Suggested Questions**: 10 domande di esempio basate sulla struttura del grafo

### 7.2 `--wiki` flag

Esporta pagine wiki per-community: `report/graph-community-wiki/` con un file per progetto (`.md`). Ogni pagina contiene la lista dei documenti della community con link.

---

## 8. Tool `kg_server.py` — SPARQL endpoint

### 8.1 Architettura

- Flask server, deployabile su pepserv (Xeon E5-2680 v4, Debian 13)
- Carica KG Turtle all'avvio
- Due endpoint: `/health` (health check) e `/sparql` (POST JSON)
- Supporta sia raw SPARQL (`{"query": "SELECT ..."}`) sia NL→SPARQL (`{"question": "What documents..."}`)

### 8.2 Esempio d'uso

```bash
# Health check
curl http://pepserv:50001/health

# Raw SPARQL
curl -X POST http://pepserv:50001/sparql \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT ?doc ?label WHERE { ?doc rdfs:label ?label . } LIMIT 3"}'

# Natural language (usa Ollama locale sul server)
curl -X POST http://pepserv:50001/sparql \
  -H "Content-Type: application/json" \
  -d '{"question": "What documents depend on GlobeView?"}'
```

### 8.3 Limitazioni note

- Servizio leggero: non ha caching, rate limiting, o autenticazione. Va messo dietro reverse proxy (nginx) in produzione.
- Il NL→SPARQL usa Ollama sul server (se disponibile). Per DeepSeek, passare `"deepseek": true` nel body della richiesta.

---

## 9. RDF namespace conventions (canonizzazione per v0.5)

### 9.1 URI derivazione

L'`id` MR `namespace/slug` diventa URI RDF come `rnd:<namespace>-<slug>` (sostituzione di `/` con `-`, poi normalizzazione a kebab-case).

Esempi:
| MR id | URI RDF |
|---|---|
| `mr/piano-rnd` | `rnd:mr-piano-rnd` |
| `gcm/roadmap-gcm-v02` | `rnd:gcm-roadmap-gcm-v02` |
| `cpo/spec-prompts` | `rnd:cpo-spec-prompts` |
| `brain/projects/globeview` | `rnd:brain-projects-globeview` |

### 9.2 Predicati → RDF lowercase

I predicati RDF usano **camelCase** per convenzione (non kebab-case, per coerenza con rdflib e Turtle standard):

| MR frontmatter | RDF predicate |
|---|---|
| `depends_on[].id` | `mr:dependsOn` |
| `required_by[].id` | `mr:requiredBy` |
| `related_to[].id` | `mr:relatedTo` |
| `ai_keywords[]` | `mr:hasTopic` |
| `_computed_staleness_days` | `mr:stalenessDays` |
| `_content_hash` | `mr:contentHash` |
| `created` | `mr:created` |
| `last_updated` | `mr:lastUpdated` |

### 9.3 Gestione Concept

I Concept sono nodi RDF separati dai Document, con URI namespace `mr:` (non `rnd:`):

```
mr:Climate a mr:Concept ;
    rdfs:label "Climate" .

rnd:mr-report-spike-4 mr:hasTopic mr:Climate .
```

Creati automaticamente quando:
- `--extract-headings` è attivo su `build_kg.py` (estrae heading e grassetto)
- Oppure manualmente tramite frontmatter `ai_keywords`

---

## 10. Workflow end-to-end (full pipeline v0.5)

```bash
# ── 1. TAG (opzionale: auto-genera frontmatter per nuovi file) ──
python mr_tag.py --batch folder/ --apply --validate

# ── 2. ENHANCE (opzionale: fissa asimmetrie, arricchisce relazioni) ──
python mr_enhance.py --apply

# ── 3. VALIDATE (esistente: validatore Node) ──
cd ../mr-validate
node mr-validate.mjs ../../../folder/

# ── 4. SCAN (esistente: scanner Node per campi _*) ──
cd ../mr-scanner
node mr-scanner.mjs ../../../folder/

# ── 5. BUILD KG (nuovo in v0.5) ──
cd ../mr-kg
python build_kg.py --dir ../../../folder/

# ── 6. GRAPH REPORT (nuovo in v0.5) ──
python graph_report.py --wiki

# ── 7. QUERY (nuovo in v0.5) ──
python nsparql.py --deepseek "Which documents depend on GlobeView?"
```

Pipeline modulare: ogni step è opzionale e può essere eseguito indipendentemente. Per un flusso minimo bastano (5) + (7): KG già popolato + interrogazione.

---

## 11. Esempi d'uso

### 11.1 Interrogazione del KG

```bash
# Con DeepSeek (cloud)
python nsparql.py --deepseek "What documents depend on GlobeView?"

# Con Ollama (locale, RTX 4070)
python nsparql.py "List all stale documents older than 180 days"

# Interattivo
python nsparql.py --deepseek --interactive
```

### 11.2 Generazione report

```bash
# Report standard
python graph_report.py

# Con export wiki per-progetto
python graph_report.py --wiki
```

### 11.3 Deploy su pepserv

```bash
# Sul server
python kg_server.py --host 0.0.0.0 --port 50001

# Dalla rete locale
curl http://pepserv:50001/health
```

---

## 12. Cosa NON entra in v0.5 (deferito a v0.6)

Decisioni esplicite di NON canonizzare in questo bump:

### 12.1 PRISMA integration attiva

L'handoff `HANDOFF-PRISMA-KG.md` (interno, non pubblicato) è completo e la pipeline è pronta, ma PRISMA non ha ancora prodotto output reali (Edo è in fase di training/estrazione). v0.5 ha la pipeline pronta; v0.6 l'attiverà quando i primi file `.md` PRISMA saranno disponibili.

### 12.2 Leiden community detection

`graph_report.py` attualmente raggruppa documenti per prefix MR (deterministico, via slug). Graphify ([50.5k stars](https://github.com/safishamsi/graphify)) usa Leiden algorithm per rilevare comunità semantiche. Design documentato in `piani/graph-report-design.md` ma non implementato.

### 12.3 Walker `.html` per `<!-- mr-frontmatter -->`

Deferito da v0.4 (vedi `formato_MR_v0.4_delta.md` §6.1). I 5 file `.html` del field test brain sono annotati ma non parsati dal walker `.md`-only.

### 12.4 Scanner cascade events asymmetric reporting

Deferito da v0.4 (vedi `formato_MR_v0.4_delta.md` §6.2).

### 12.5 Tipo `automation` per use case cliente

Deferito da v0.4 (vedi `formato_MR_v0.4_delta.md` §6.3). Anche il riferimento nella hitlist (`piani/hitlist-mr-tag.md`) è aggiornato.

### 12.6 Integrazione CI/CD per KG pipeline

Nessuna GitHub Action è stata scritta per `build_kg.py` o `nsparql.py`. Resta on-demand come il resto del tooling Node.

---

## 13. Changelog v0.4 → v0.5

Formato Keep a Changelog.

### Added

- **Layer Knowledge Graph**: 7 tool Python in `tools/mr-kg/` per costruire, interrogare, e analizzare un Knowledge Graph RDF dai file MR
- **build_kg.py**: MR frontmatter → RDF Turtle (.ttl). TYPE_MAP, STATUS_MAP canonici
- **nsparql.py**: NL → SPARQL → KG → NL. DeepSeek 90%, Ollama 85%. Supporta interactive, verify-schema, verify-queries
- **mr_tag.py**: Auto-generazione frontmatter MR via LLM (DeepSeek preferito, fallback Ollama)
- **mr_enhance.py**: Fix asimmetrie `depends_on↔required_by`, arricchimento cross-project
- **graph_report.py**: GRAPH_REPORT.md con 6 sezioni + `--wiki` export per-community
- **kg_server.py**: Flask SPARQL endpoint per deploy su pepserv
- **benchmark_global.py**: Benchmark 30 domande multi-model
- **Sezione §8 in matrix.md**: Knowledge Graph Pipeline (namespace RDF, tool reference, quick commands)
- **Sezione §5.10 in matrix.md**: Operational Instructions — KG Operations (3 nuovi prompt few-shot)
- **Documentazione nuova**: `tools/mr-kg/README.md`, `tools/mr-kg/requirements.txt`, `tools/mr-kg/.env.local.example`

### Changed

- `mr-schema.json`: `mr_version` enum da `["0.2", "0.3", "0.4"]` a `["0.2", "0.3", "0.4", "0.5"]`
- `matrix.md`: header changelog v0.5 inline + §8 completa + §5.10
- `piano-RnD-app-00.md`: nuova riga stato Spike A canonizzato

### Deprecated

- Niente.

### Removed

- Niente. Il codice sorgente originale in `<ricerca-interna>/` rimane intatto come storico.

### Fixed

- Nessun fix: v0.4 non aveva bug, il layer è addizione pura.

### Security

- `.env.local` e `.env.local.example` aggiunti a `.gitignore` se non già presenti. Le API key DeepSeek non devono mai essere committate.

---

## 14. Riferimenti

- **Specifica base v0.3**: [`formato_MR_v0.3.md`](formato_MR_v0.3.md) (immutabile, M1-M16)
- **Delta v0.3→v0.4**: [`formato_MR_v0.4_delta.md`](formato_MR_v0.4_delta.md) (immutabile)
- **Operational reference**: [`matrix.md`](matrix.md) (post bump v0.5: header, §1.2, §8, §5.10)
- **Tool**: [`tools/mr-kg/`](tools/mr-kg/) (7 tool Python)
- **Sorgente storico**: `<ricerca-interna>/` (handoff, report, benchmark, TTL snapshot — preservato come historical record)
- **Handoff SPIKE A**: `<ricerca-interna>/handoff/HANDOFF-SPIKE-A.md`
- **Handoff PRISMA integration**: `<ricerca-interna>/handoff/HANDOFF-PRISMA-KG.md`
- **Report SPIKE A**: `<ricerca-interna>/report/SPIKE-A-REPORT.md` (PDF also available)
- **Graph Report design**: `<ricerca-interna>/piani/graph-report-design.md`

---

*Generato da Claude Code Opus il 2026-06-25 in sessione di canonizzazione bump v0.5 da `<ricerca-interna>/` a `progetti/MR/tools/mr-kg/`.*
