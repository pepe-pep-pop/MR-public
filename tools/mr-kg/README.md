---
mr_version: '0.6'
id: mr/tools-mr-kg-readme
title: "mr-kg — Knowledge Graph MR"
type: reference
owner: rnd
status: active
created: '2026-06-25'
last_updated: '2026-10-03'
---

# mr-kg — Knowledge Graph MR (v0.5.1)

Strumenti Python che trasformano i frontmatter MR in un grafo RDF (Turtle) e lo interrogano
con SPARQL. **Deterministici, senza LLM, senza rete.** In sola lettura se non si passa `--write`.

La traduzione da domanda in linguaggio naturale a SPARQL non sta più qui: la fa Claude Code con
la skill `mr-query` (`.claude/skills/mr-query/`), che poi esegue `kg_query.py`.

Per poche centinaia di doc il grafo di solito non serve: `mr-validate`, il registry di
`matrix.md` e `mr-status.json` bastano. Il KG conviene sopra qualche migliaio di doc, o per
domande che attraversano molti salti del grafo.

## Installazione

Venv locale nella root del repo MR (mai pip globale):

```bash
python3 -m venv .venv
.venv/bin/pip install -r tools/mr-kg/requirements.txt
```

Requisiti fissati in `requirements.txt` (rdflib, PyYAML e dipendenze). Python ≥ 3.9.

## Strumenti

| Tool | Cosa fa | Scrive? |
|------|---------|---------|
| `build_kg.py` | frontmatter MR → grafo RDF; stampa statistiche e query di verifica | solo con `--write` (salva il `.ttl` in `--output`) |
| `kg_query.py` | esegue una query SPARQL sul `.ttl`; `--schema` stampa lo schema del grafo | mai |
| `graph_report.py` | report del grafo: nodi più connessi, comunità per namespace, ponti, freshness | solo con `--write` (`--output`, e `--wiki`) |
| `mr_walk.py` | modulo: raccolta dei `.md` con le esclusioni di default | — |

Esclusioni di default nella scansione: `node_modules`, `.git`, `dist`, `build`, cartelle
nascoste, repo annidati (sotto-cartelle con un proprio `.git`), file ignorati dal `.gitignore`.
`--exclude <nome>` aggiunge altri nomi di cartella.

## Uso

```bash
cd tools/mr-kg
PY=../../.venv/bin/python

# 1. costruisci il grafo (senza --write: solo report a video)
$PY build_kg.py --dir ../../ --write --output /tmp/mr-kg.ttl

# 2. schema, per scrivere le query
$PY kg_query.py --kg /tmp/mr-kg.ttl --schema

# 3. query
$PY kg_query.py --kg /tmp/mr-kg.ttl -q "SELECT ?id WHERE { ?d mr:dependsOn ?t . ?t mr:id 'mr/matrix' . ?d mr:id ?id }"
$PY kg_query.py --kg /tmp/mr-kg.ttl --file domanda.rq --format json

# 4. report (stdout; con --write lo salva)
$PY graph_report.py --kg /tmp/mr-kg.ttl
```

## Sicurezza di `kg_query.py`

- Solo query di lettura: `SELECT`, `ASK`, `CONSTRUCT`, `DESCRIBE`. Gli update non passano.
- Rifiutate `SERVICE` (farebbe richieste HTTP verso endpoint esterni) e `FROM` / `FROM NAMED`
  (rdflib scaricherebbe i grafi indicati). Il controllo è sull'algebra della query, quindi vale
  anche per `SERVICE` annidati o scritti in minuscolo.
- Il caricamento automatico dei grafi di rdflib (`SPARQL_LOAD_GRAPHS`) è disattivato comunque.
- Nessun server: `kg_server.py` è stato rimosso nella v0.5.1.

## Cosa è cambiato dalla v0.5

Rimossi: `mr_tag.py` e `nsparql.py` (chiamate a un LLM cloud esterno o locale → skill
`mr-tag` e `mr-query`), `kg_server.py` (endpoint di rete senza autenticazione),
`benchmark_global.py` (dipendeva dal LLM cloud e da un modulo mai versionato), `mr_enhance.py`
(scriveva `required_by` e `related_to` nei file degli altri doc; ora `required_by` si calcola in
`mr-status.json`), `.env.local.example`. Dettagli in `formato_MR_v0.5.1_delta.md`.

## Test

```bash
.venv/bin/python -m unittest discover -s tools/mr-kg/tests -v
```
