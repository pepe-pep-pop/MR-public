# MR — Metadati Relazionali

**MR** dà alla documentazione markdown due cose:

1. **Un frontmatter con relazioni.** Ogni doc dichiara cosa è (`type`, `status`, `owner`), quando è
   stato aggiornato e da quali altri doc dipende. Uno scanner calcola le relazioni inverse, la
   freschezza e il registro dei doc.
2. **Un controllo doc ↔ codice.** Il comando `mr` legge le affermazioni dei doc (path, comandi,
   variabili d'ambiente, endpoint, tabelle, nomi di funzione) e le cerca nel codice. Così dice quali
   doc sono rimasti indietro, e quali doc ricontrollare dopo una modifica al codice.

Tutto è deterministico: nessuna API LLM, nessun server, nessuna scrittura senza `--write`. La parte
che richiede giudizio (proporre un frontmatter, rileggere una deriva) la fanno le skill di
[Claude Code](https://claude.com/claude-code) in `.claude/skills/`, sempre con l'ok di chi le usa.

> **Stato:** sperimentale, formato 0.6. Usato ogni giorno su qualche decina di repo, ma l'interfaccia
> dei comandi può ancora cambiare. La versione è in `tools/mr/package.json`.

*In English:* MR adds relational metadata (YAML frontmatter) to markdown docs and checks docs against
code: it extracts the claims a doc makes (paths, commands, env vars, endpoints, tables, symbols) and
looks them up in the repository. Deterministic, offline, read-only unless `--write` is given.
Documentation and messages are in Italian.

## Requisiti

- Node.js 18 o superiore (la CI prova 20 e 22)
- git
- Python 3.10 o superiore, solo per il knowledge graph (`tools/mr-kg`)

## Installazione

Le dipendenze sono locali a ogni strumento e fissate dai lockfile:

```bash
npm ci --prefix tools/mr-validate && npm ci --prefix tools/mr-scanner && npm ci --prefix tools/mr
python3 -m venv .venv && .venv/bin/pip install -r tools/mr-kg/requirements.txt -r tools/mr/requirements-test.txt
```

## Uso in breve

```bash
# frontmatter: validazione (sempre sola lettura)
node tools/mr-validate/mr-validate.mjs --profile light <cartella>

# registro e freschezza: anteprima; con --write aggiorna matrix.md e mr-status.json
node tools/mr-scanner/mr-scanner.mjs <cartella> [--write --profile light]

# doc ↔ codice (sola lettura)
node tools/mr/mr.mjs claims <doc|cartella> [--code-repo <dir>]   # affermazioni del doc cercate nel codice
node tools/mr/mr.mjs scan   <doc|cartella>                        # claims + deriva delle ancore doc → codice
node tools/mr/mr.mjs impact <commit|a..b|--staged>                # doc da ricontrollare dopo una modifica
node tools/mr/mr.mjs coverage [<repo>]                            # punti d'ingresso che nessun doc cita
node tools/mr/mr.mjs env [<repo>]                                 # variabili lette dal codice ↔ elenchi (.env*.example o doc)
node tools/mr/mr.mjs stato [<repo>]                               # a che punto è il repo con MR e qual è il passo dopo
node tools/mr/mr.mjs vivi <repo> --senza-frontmatter              # doc vivi ancora senza frontmatter
node tools/mr/mr.mjs date <doc|cartella>                          # created e last_updated da git

# scritture, solo con --write e solo nei doc indicati
node tools/mr/mr.mjs verify <doc>[#sezione] [--write]            # ancore verificate al commit corrente
node tools/mr/mr.mjs suggest-links <doc|cartella> [--write]       # ancore proposte dalle affermazioni
node tools/mr/mr.mjs rivisto <doc> [--write]                      # doc riletto e ancora vero: last_updated
```

La guida completa è in [`docs/guida.md`](docs/guida.md); il dettaglio dei comandi è in
[`tools/mr/README.md`](tools/mr/README.md).

## Un esempio di frontmatter (profilo light)

```yaml
---
mr_version: '0.6'
id: app/guida-deploy
title: "Guida al deploy"
type: how-to
owner: team-app
status: active
created: '2026-05-12'
last_updated: '2026-09-30'
depends_on:
  - id: app/architettura
    reason: descrive i servizi che il deploy aggiorna
---
```

## Struttura

| Path | Cosa contiene |
|---|---|
| [`matrix.md`](matrix.md) | schema, vocabolario, regole e istruzioni operative: la sorgente di verità del formato |
| `formato_MR_v0.3.md`, `formato_MR_v0.*_delta.md` | specifica del formato e modifiche per versione |
| `tools/mr-validate/` | validatore del frontmatter (JSON Schema, integrità, freschezza) |
| `tools/mr-scanner/` | registro dei doc, relazioni inverse, propagazione della freschezza |
| `tools/mr/` | comando `mr` (doc ↔ codice) e `giro.mjs` (controllo periodico su più repo) |
| `tools/mr-kg/` | knowledge graph RDF deterministico e query SPARQL |
| `.claude/skills/` | skill di Claude Code: `mr-tag`, `mr-link`, `mr-drift-review`, `mr-giro`, `mr-query` |
| `docs/guida.md` | guida d'uso |

## Da dove viene questo repo

Questo repo è la **copia pubblica** di un repo di sviluppo privato, e si aggiorna da lì ogni giorno.
Nella copia pubblica:
- i nomi di progetti, organizzazioni e percorsi negli esempi e nei test sono **segnaposto**
  (`acme/app-web`, `portale-b`, `/home/utente/…`);
- i rimandi a `report/`, `handoff/` o a un PRD indicano note di sviluppo interne, non pubblicate.

## Contribuire

Issue e pull request sono benvenute: leggi [`CONTRIBUTING.md`](CONTRIBUTING.md). Per una
vulnerabilità vedi [`SECURITY.md`](SECURITY.md). Chi partecipa segue il
[codice di condotta](CODE_OF_CONDUCT.md).

## Licenza

[Apache License 2.0](LICENSE). Vedi anche [`NOTICE`](NOTICE).
