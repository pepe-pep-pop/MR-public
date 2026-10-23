---
mr_version: '0.3'
id: mr/matrix
title: Matrix — Schema MR v0.5.1 + Operational Instructions
type: spec
owner: rnd
status: active
created: '2026-04-26'
last_updated: '2026-10-03'
depends_on:
- id: mr/formato-mr-v03
  reason: Specifica base dello schema MR v0.3
- id: mr/formato-v04-delta
  reason: Delta delle modifiche v0.4 rispetto a v0.3
ai_summary: Questo file è la sorgente di verità eseguibile del sistema Metadati
  Relazionali (MR) per il progetto MR e i suoi consumer. Definisce lo schema, il
  vocabolario, le regole di propagazione, il registry id→path e le istruzioni
  operative per Claude Code Opus 4.6 su come gestire i prompt utente riguardanti
  il sistema MR. Include la specifica v0.4, estensione additiva di v0.3 senza
  breaking changes.
ai_keywords:
- MR
- Metadati Relazionali
- schema
- v0.4
- Claude Code
- propagazione
- tipi MR
- brain-extended
priority: high
required_by:
- id: mr/formato-mr-v03
  reason: Richiesto da mr/formato-mr-v0.3 (inverso automatico)
external_dependencies:
- path: id:mr/piano-rnd-app-00
  reason: Trigger sharding tracciato in piano-RnD-app-00.md (doc del workspace
    d'origine, non presente nel repo MR)
  type: brief
- path: id:cpo/spike-2-roadmap
  reason: Condivide il concetto 'claude code' con mr/matrix (doc del workspace
    d'origine, non presente nel repo MR)
  type: brief
- path: id:cpo/report-spike-2-integration
  reason: Condivide il concetto 'claude code' con mr/matrix (doc del workspace
    d'origine, non presente nel repo MR)
  type: brief
- path: id:cpo/roadmap-00
  reason: Condivide il concetto 'claude code' con mr/matrix (doc del workspace
    d'origine, non presente nel repo MR)
  type: brief
- path: id:cpo/piani-spike-0-roadmap
  reason: Condivide il concetto 'claude code' con mr/matrix (doc del workspace
    d'origine, non presente nel repo MR)
  type: brief
---
# matrix.md — Schema MR v0.5.1 + Operational Instructions

> **Cos'è questo file**: la sorgente di verità eseguibile del sistema **Metadati Relazionali (MR)** per il progetto MR e i suoi consumer. Definisce schema, vocabolario, regole di propagazione, registry id→path, e — soprattutto — istruzioni operative per Claude Code Opus 4.6 (consumer primario) su come gestire i prompt utente che riguardano il sistema MR.
>
> **Versione MR**: tooling **v0.6** (fasi a, b e c, 2026-10-03), formato **0.6** (`mr_version: '0.6'`, accettate anche 0.2-0.5). La v0.6 aggiunge i link doc → codice (`code_refs`, ancore `<!-- mr:code -->`, §1.3) e il comando `tools/mr/mr.mjs` (claim check, deriva, impatto). La v0.5.1 aveva aggiunto il **profilo light** (§1.8), i tool sicuri di default (sola lettura senza `--write`, esclusioni di default) e tolto ogni chiamata a LLM esterni. Specifica base in `formato_MR_v0.3.md`, delta in `formato_MR_v0.4_delta.md`, `formato_MR_v0.5_delta.md`, `formato_MR_v0.5.1_delta.md`, `formato_MR_v0.6_delta.md`.
> **Status**: monolitico (decisione D2 di Spike 4). Trigger sharding tracciato in `piano-RnD-app-00.md`: refactor a `matrix/` con 5 file separati se questo file supera 500 righe consistently per ≥2 settimane. Anti-pattern BMAD #912: in caso di sharding, questo file viene **eliminato**, mai coesistenza con `matrix/`.
> **Validatore**: `tools/mr-validate/mr-validate.mjs` con `mr-schema.json` (accetta `mr_version` `"0.2"` legacy, `"0.3"`, `"0.4"`, `"0.5"`); `--profile light` per i vincoli del §1.8.
> **Consumer primario**: **Claude Code via prompt naturale**, con le skill `mr-tag` e `mr-query` in `.claude/skills/`. Editor visuali (Front Matter CMS, Obsidian Properties, ecc.) sono compatibilità verificate ma non priorità. Vedi `formato_MR_v0.3.md` §10-11.
> **Linkato da**: il `CLAUDE.md` di un progetto MR-enabled dovrebbe contenere una riga del tipo: *"Per il sistema MR (Metadati Relazionali), leggi `matrix.md` come prima cosa."*
>
> **Changelog v0.5.1 → v0.6** (2026-10-03, PRD `mr/prd-v0-6-codice-doc`):
> - Campo `code_refs` e ancore `<!-- mr:code ... -->` (§1.3, dettagli in `formato_MR_v0.6_delta.md`); le ancore non contano per `_content_hash`
> - `node tools/mr/mr.mjs claims | scan | impact`: claim check, deriva dei link via git, doc da ricontrollare dopo una modifica; sempre in sola lettura
> - Doc storici (piani chiusi, status di fine vita, cartelle d'archivio): nessun segnale, solo una riga informativa
>
> **Changelog v0.5 → v0.5.1** (2026-10-03, valutazione di sicurezza dell'agente arch):
> - Nessuna API LLM esterna: rimossi `mr_tag.py`, `nsparql.py`, `benchmark_global.py` (DeepSeek); la parte LLM è nelle skill Claude Code `mr-tag` e `mr-query`. Nuovo `kg_query.py`, SPARQL deterministico che rifiuta `SERVICE` e `FROM`
> - Rimosso `kg_server.py` (endpoint di rete senza autenticazione) e `mr_enhance.py` (scriveva `required_by`/`related_to` nei file degli altri doc)
> - Tutti i tool in **sola lettura** senza `--write`; lo scanner cerca `matrix.md` solo fino alla root del repo
> - **Esclusioni di default** ovunque: `node_modules`, `.git`, `dist`, `build`, cartelle nascoste, repo annidati, `.gitignore`
> - **Profilo light** (§1.8); `required_by` calcolato dallo scanner in `mr-status.json`
> - Lockfile npm committati, requisiti Python fissati, CI GitHub Actions
>
> **Changelog v0.3 → v0.4** (2026-04-26, post field test `_www/brain/` BRAIN-0 + WORKER-0):
> - Aggiunti 5 type: `capsule`, `cross_cutting_doc`, `portfolio_view`, `html_mirror`, `index` (brain-extended)
> - Aggiunto `status: paused` (semantica: potrebbe tornare; ≠ deprecated)
> - Aggiunto campo top-level opzionale `external_dependencies` (vedi §1.7)
> - I 9 type v0.3 + 4 status v0.3 + 4 relazioni v0.3 + struttura `relation_entry` restano invariati
> - Deferiti a v0.5: walker `.html` per parsare `<!-- mr-frontmatter -->`, scanner cascade events asymmetric reporting

---

## 1. Schema

Definisce i tipi MR validi, i loro default e i loro campi obbligatori per tipo. Tutti gli `mr_version` usano questo schema: i 9 tipi v0.3, i 5 brain-extended v0.4 e i 2 della v0.5 (`handoff`, `runbook`).

### 1.1 Tipi MR validi e default per tipo

| Tipo | Origine semantica | `staleness_threshold` default | Campi obbligatori (oltre ai globali) | Relazioni "tipiche" (warning se mancanti) |
|---|---|---|---|---|
| `guide` | Diátaxis: tutorial | `60d` | — | `related_to` verso almeno un `explanation` o `reference` |
| `how-to` | Diátaxis: how-to | `60d` | — | `depends_on` verso un `reference` o `spec` |
| `reference` | Diátaxis: reference | `30d` | — | nessuna obbligatoria |
| `explanation` | Diátaxis: explanation | `180d` | — | nessuna obbligatoria |
| `spec` | MR-extended | `90d` | — | almeno un `required_by` (la spec serve a qualcosa) |
| `roadmap` | MR-extended | `30d` | — | almeno un `depends_on` verso un `spec` o `ppd` |
| `report` | MR-extended | `never` | — | almeno un `depends_on` (verso `roadmap`/`spec`/`log`) |
| `log` | MR-extended | `never` | — | nessuna obbligatoria (i log sono autonomi) |
| `ppd` | MR-extended | `never` | — | nessuna obbligatoria (è un documento fondazionale) |
| `handoff` | MR-extended (v0.5) | `90d` (nessun default dedicato: vale quello generico) | — | catena: il più recente `active`, gli altri `superseded` con `superseded_by` verso il successivo |
| `runbook` | MR-extended (v0.5) | `90d` (nessun default dedicato: vale quello generico) | — | nessuna obbligatoria |
| `backlog` | MR-extended (0.6-z6) | `14d` **per voce**: conta la colonna «Aggiornato» delle righe della sezione «In corso», non la data del file | — | nessuna obbligatoria |
| `capsule` | brain-extended (v0.4) | `30d` | — | almeno un `required_by` (la capsule serve a una `portfolio_view`) |
| `cross_cutting_doc` | brain-extended (v0.4) | `60d` | — | almeno un `related_to` verso una `capsule` |
| `portfolio_view` | brain-extended (v0.4) | `14d` | — | almeno un `depends_on` verso una `capsule` (+ `propagate_staleness_to` verso il mirror se esiste) |
| `html_mirror` | brain-extended (v0.4) | `30d` | — | esattamente un `depends_on` verso il `.md` sorgente |
| `index` | brain-extended (v0.4) | `60d` | — | nessuna obbligatoria (punto di ingresso per umani/LLM) |

**Vincoli di tipo (colonna «Relazioni tipiche»), dalla 0.6-z6:** non scattano sui doc chiusi
(`deprecated`, `superseded`). Un `depends_on: []` scritto esplicitamente vuol dire «verificato:
nessuna dipendenza da dichiarare» e spegne i vincoli sul `depends_on`.

**Semantica dei 5 tipi v0.4** (per dettagli e esempi: `formato_MR_v0.4_delta.md` + field test in `_www/brain/_mr/v0.4_proposal.md`):
- `capsule`: riassunto sintetico (<200 righe) di un singolo progetto, derivato da un `project_brief.md` esterno (vedi §1.7 `external_dependencies`).
- `cross_cutting_doc`: analisi narrativa che attraversa tutti i progetti su una dimensione (architettura, devops, infra, vendite, timeline).
- `portfolio_view`: aggregatore presentazionale che cita TUTTE (o quasi tutte) le `capsule`, in formato ottimizzato per audience specifico (sales pitch, tabella, one-pager).
- `html_mirror`: versione HTML statica di un `.md` sorgente, generata fuori-MR. Caveat: il walker v0.4 è ancora `.md`-only — gli `.html` si taggano via commento `<!-- mr-frontmatter -->` ma non sono parsati. Walker `.html` deferito a v0.5.
- `index`: meta-documento navigazionale (mappa "vai qui per X"). Diverso da `capsule` (un progetto) e `cross_cutting_doc` (una dimensione).

### 1.2 Campi globali sempre obbligatori (tutti i tipi)

```yaml
mr_version: "0.4"           # const "0.2" | "0.3" | "0.4" — accettati tutti
id: namespace/slug          # pattern: ^[a-z0-9][a-z0-9/_-]*[a-z0-9]$
title: "..."                # 1-200 char
type: <uno dei 17 sopra>    # enum (9 v0.3 + 5 brain-extended v0.4 + 2 v0.5 + backlog)
owner: <nome o team>        # 1+ char
created: YYYY-MM-DD         # date format
```

### 1.3 Campi globali opzionali (tutti i tipi)

```yaml
status: active|draft|deprecated|superseded|paused   # default: active (v0.4 aggiunge paused)
version: x.y.z                                # semver del documento (NON di mr_version)
last_updated: YYYY-MM-DD                      # auto-aggiornato da mr-scanner se _content_hash cambia
staleness_threshold: Nd | never               # ereditato da §1.1 se omesso
superseded_by: namespace/slug                 # OBBLIGATORIO se status: superseded
depends_on: [<relation_entry>]                # vedi §1.4
required_by: [<relation_entry>]               # vedi §1.4
related_to: [<relation_entry>]                # vedi §1.4
propagate_staleness_to: [<propagation_entry>] # vedi §1.5
external_dependencies: [<external_dep_entry>] # v0.4, vedi §1.7
code_refs: [<code_ref_entry>]                 # v0.6: link doc → codice {path, symbol?, repo?, section?, verified?{commit, date?}} — formato_MR_v0.6_delta.md; hash tra apici
ai_summary: "..."                             # max 500 char
ai_keywords: [...]                            # max 20 elementi
priority: high|medium|low                     # default: medium
```

### 1.4 `relation_entry` (struttura di un elemento di `depends_on`/`required_by`/`related_to`)

```yaml
- id: namespace/slug          # OBBLIGATORIO — id target esistente nel registry
  reason: "..."               # OBBLIGATORIO — motivazione umana
  strength: strong|weak       # OPZIONALE — default: strong per depends_on/required_by, weak per related_to
  rel_type: <vedi §2.4>       # OPZIONALE — default: references per depends_on, see_also per related_to
```

### 1.5 `propagation_entry` (struttura di un elemento di `propagate_staleness_to`)

```yaml
- id: namespace/slug          # OBBLIGATORIO — id target esistente nel registry
  reason: "..."               # OBBLIGATORIO — perché questo target diventa stale se questo file cambia
```

Nota: `propagate_staleness_to` è semanticamente diverso da `required_by`. `required_by` significa "questo documento è usato da X". `propagate_staleness_to` significa "se questo documento cambia sostanzialmente, X va automaticamente rivalutato come stale". Possono coincidere ma non sempre.

### 1.6 Campi computed (`_*`) — gestiti da `mr-scanner`, mai editati manualmente

```yaml
_content_hash: "sha256:abc123456789"       # sha256 del BODY markdown SOLO (mai del frontmatter), SHORT hash 12 char hex
_computed_staleness_days: 75               # today - last_updated, in giorni
_computed_status: fresh|warning|stale|broken  # derivato da _computed_staleness_days vs staleness_threshold
_last_scanned: YYYY-MM-DD                  # quando lo scanner ha aggiornato questi campi
_propagated_from:                          # array opzionale, scritto da mr-scanner quando un documento sorgente con propagate_staleness_to cambia hash
  - id: namespace/slug                     # id del documento sorgente che ha propagato lo stale
    date: YYYY-MM-DD                       # data della run dello scanner che ha rilevato il cambio
```

**Stato implementazione (post Spike 6, 2026-04-12)**: `mr-scanner.mjs` **esiste ed è funzionante** in `tools/mr-scanner/mr-scanner.mjs`. I 4 file pilota di Spike 4/5 (`PPD_00.md`, `piano-RnD-app-00.md`, `ricerca-00-MR.md`, `PRD_MR_v0.1.md`) contengono ora i campi `_*` popolati dalla prima run dello scanner. Il validatore continua a tollerare la loro assenza nei file non ancora scansionati (retrocompatibilità).

**Precisazioni da Spike 6**:
- **Formato `_content_hash`**: `sha256:` + i primi 12 char hex dello sha256 del body normalizzato. Non l'hash completo (64 char). Lo "short hash" è sufficiente per il rilevamento di cambi sostanziali e più leggibile nei file.
- **Normalizzazione del body prima dell'hash** (D3.1 di Spike 6): CRLF/CR → LF, UTF-8 forzato, trim dei trailing newline di fine file. **NON** normalizzati: trailing whitespace di riga, tab vs spaces (potenzialmente semantici). Questa normalizzazione è implementata identicamente in `mr-scanner.mjs` e in `mr-validate.mjs` → gli hash prodotti dai due tool coincidono byte per byte.
- **`_propagated_from` è un array** (anche con un solo elemento). Ogni entry ha `id` + `date`. Lo scanner aggiorna l'entry con lo stesso `id` se esiste (preserva la data più recente) e mantiene le entries con `id` diversi. Il vincolo D5.1.a di Spike 6 garantisce che `last_updated` del file target NON venga modificato dalla propagazione — solo `_propagated_from` cambia.
- **`mr-status.json`**: file accanto a `matrix.md` (nella stessa directory) che contiene gli hash precedenti di ogni file scansionato. Schema v0.1: `{version, scanner_version, last_scan_date, files: {id→{path, content_hash, last_scanned}}, propagation_events}`. Lo scanner lo legge all'inizio di ogni run e lo riscrive alla fine. `propagation_events` contiene **solo** gli eventi della run corrente, non uno storico cumulativo.

**Regola cristallizzata di v0.3 (Finding #4 di Spike 1, confermata in Spike 6)**: `_content_hash` calcolato SOLO sul body markdown post-frontmatter. MAI sull'intero file. Motivazione: gli editor visuali normalizzano il YAML al save (rimuovono virgolette, espandono array inline) → cambia il byte stream del frontmatter senza che cambi il contenuto semantico. Se l'hash fosse calcolato sull'intero file, ogni save di un editor genererebbe un falso positivo "documento modificato".

**Caveat noto da Spike 6 (Finding #1)**: `gray-matter` parsa le date YAML come `Date` objects, e `js-yaml` li riserializzerebbe come ISO datetime completi (`2026-02-28T00:00:00.000Z`). Lo scanner risolve con `normalizeDatesForStringify` che converte i `Date` in stringhe `YYYY-MM-DD` prima della scrittura. Effetto collaterale: le date post-scrittura sono quoted come stringhe (`created: '2026-02-28'` invece di `created: 2026-02-28`). Il validatore le accetta entrambi i formati.

### 1.7 `external_dependencies` (v0.4, opzionale, top-level)

Modella dipendenze su artefatti **fuori dal grafo MR** — tipicamente file in altre cartelle del filesystem che non sono MR-tagged. Esempio canonico: una `capsule` in `_www/brain/projects/ft.md` dichiara come sorgente il `project_brief.md` di FT, che vive in `_soft/Miei/RM/FT/docs/` (fuori dal dominio MR di brain).

```yaml
external_dependencies:
  - path: "_soft/Miei/RM/FT/docs/project_brief.md"
    reason: "Brief sorgente da cui questa capsule è derivata"
    type: brief                  # opzionale: brief | data | tool | repo
```

**Schema dell'entry**:

```yaml
- path: <stringa>             # OBBLIGATORIO — path filesystem (relativo o assoluto, non risolto dal validator)
  reason: <stringa>           # OBBLIGATORIO — motivazione della dipendenza esterna
  type: brief|data|tool|repo  # OPZIONALE — categoria semantica dell'artefatto
```

**Semantica e vincoli**:
- Il **validator NON risolve `path`**: può non esistere localmente, può puntare fuori dal repo, può essere un URL-like. Solo annotazione documentale.
- Lo **scanner NON propaga staleness** su `external_dependencies`: out of scope MR (il file esterno non è scansionato).
- Pensato per **consumer LLM** (es. Claude Code): leggendo una `capsule` con `external_dependencies`, l'LLM sa "se vuoi capire da dove viene questa capsule, leggi quel path".
- Differenza vs `related_to` con id ghost: usare `related_to: [{id: external/ft-brief, ...}]` inquina il registry e produce broken refs. `external_dependencies` è il campo dedicato.

**Tipi tipici di consumer per ogni `type`**:
- `brief`: il `project_brief.md` di un progetto esterno (caso tipico di `capsule`)
- `data`: dataset/CSV/JSON sorgenti di un'analisi (caso tipico di `cross_cutting_doc`)
- `tool`: tool CLI usati per generare il documento (es. `pygount`, `git log`)
- `repo`: altro repo/cartella git fuori dal grafo MR corrente

### 1.8 Profilo light (v0.5.1)

Profilo ridotto per adottare MR su doc che non sono di MR, con frontmatter corti e senza
scritture incrociate. Non è un nuovo formato: stesso schema 0.5, vincoli in più controllati da
`mr-validate --profile light`.

| Campo | Profilo light |
|---|---|
| `mr_version`, `id`, `title`, `type`, `owner`, `status`, `created`, `last_updated` | **obbligatori** |
| `depends_on`, `propagate_staleness_to`, `superseded_by`, `staleness_threshold`, `code_refs`, `review_needed` | opzionali (`superseded_by` obbligatorio con `status: superseded`; `staleness_threshold` è una configurazione del solo doc; `code_refs` dalla v0.6; `review_needed` dalla 0.6-z: doc valido con parti non più vere, motivo breve, lo toglie `mr rivisto --write`) |
| campi `_*` | ammessi (sono dello scanner) |
| `required_by` | **vietato nel file** (errore): si calcola come inverso dei `depends_on` e si legge in `mr-status.json` |
| gli altri campi MR (`ai_summary`, `ai_keywords`, `related_to`, `priority`, …) | **warning** "fuori profilo" |
| chiavi che MR non conosce, di altri strumenti nello stesso blocco (`pdf_options` di md-to-pdf, `layout` di Astro, …) | **warning** "chiave di un altro strumento" (dalla 0.6-z1; nel profilo full restano errore di schema) |

Effetti sui controlli:
- livello 3 (simmetria `depends_on ↔ required_by`): non si applica, l'inverso è calcolato;
- livello 4 (vincoli di tipo): per `spec` e `capsule` "almeno un `required_by`" usa l'inverso calcolato.

Scanner: `mr-scanner --write --profile light` non tocca i doc; scrive solo il registry §4.1 di
`matrix.md` e `mr-status.json` (con `computed_*` e `required_by` per ogni id).

---

## 2. Vocabulary

Vocabolari controllati. Tutti i campi qui hanno valori finiti — qualsiasi altro valore è errore di schema.

### 2.1 `type` (17 valori — 9 v0.3 + 5 brain-extended v0.4 + 2 v0.5 + backlog)

Vedi §1.1 per la tabella completa con default. In sintesi:
- **9 v0.3**: `guide`, `how-to`, `reference`, `explanation` (i 4 di Diátaxis) + `spec`, `roadmap`, `report`, `log`, `ppd` (estensioni MR per R&D)
- **5 v0.4 brain-extended**: `capsule`, `cross_cutting_doc`, `portfolio_view`, `html_mirror`, `index` (tipi emersi dal field test su `_www/brain/` 2026-04-26)
- **2 v0.5**: `handoff` (passaggio di consegne tra sessioni, in catena) e `runbook` (procedura operativa). Erano nello schema dalla v0.5 ma mancavano da questa tabella fino alla 0.6-z5
- **`backlog`** (0.6-z6): il backlog unico di un repo (`doc/backlog.md`, sezioni In corso, Prossimi, In attesa, Idee, Fatto). È «vecchio» quando una voce «In corso» ha «Aggiornato» più vecchio di 14 giorni (o di `staleness_threshold`); la data del file non conta

**Quando NON sai quale tipo usare**:
- Per documentazione tecnica generica: scegli `explanation` (più tollerante, no relazioni obbligatorie, threshold lungo) come fallback temporaneo. Rivisita più tardi.
- Per documentazione di portfolio/cross-progetto: i 5 tipi v0.4 sono pensati per cataloghi tipo `brain/`. Se il documento riassume *un* progetto da un brief esterno → `capsule`. Se attraversa più progetti su una dimensione → `cross_cutting_doc`. Se aggrega N capsule per audience specifico → `portfolio_view`.

### 2.2 `status` (5 valori — 4 v0.3 + paused v0.4)

| Valore | Semantica | Quando usarlo | Vincoli |
|---|---|---|---|
| `active` (default) | Documento corrente, valido, referenziabile | Default per ogni nuovo file | — |
| `draft` | In lavorazione, non ancora referenziabile come dipendenza forte | Quando il documento è in scrittura attiva | `depends_on: strength: strong` verso un draft → warning |
| `deprecated` | Sostituito o non più rilevante, ma conservato per storia | Quando un documento perde la sua utilità ma non c'è un sostituto preciso | `depends_on` verso deprecated → warning |
| `superseded` | Rimpiazzato da un altro documento specifico | Quando esiste un sostituto con `id` noto | `superseded_by` OBBLIGATORIO; `depends_on` verso superseded → warning |
| `paused` (v0.4) | In pausa, **potrebbe tornare**. Differente da `deprecated` (deprecated = c'è ma non usare; paused = aspettiamo che riparta) | Quando un progetto/documento è messo in pausa per blocker esterno (es. FT in pausa per blocco PSD2 2026-04-25) | `depends_on: strength: strong` verso un paused → warning (la dipendenza regge ma il target è dormiente) |

### 2.3 `strength` (2 valori)

| Valore | Semantica | Default per |
|---|---|---|
| `strong` | Dipendenza essenziale: rompere invalida il documento dipendente | `depends_on`, `required_by` |
| `weak` | Correlazione utile ma non critica: rompere produce warning informativo, non errore | `related_to` |

**Regola operativa**: usa `strong` quando puoi dire "se questo target sparisse, il mio documento sarebbe sostanzialmente sbagliato". Usa `weak` quando puoi dire "se questo target sparisse, il mio documento perderebbe contesto utile ma non sarebbe sbagliato".

### 2.4 `rel_type` (7 valori)

| Valore | Applicabile a | Semantica | Esempio |
|---|---|---|---|
| `references` | `depends_on` (default) | Cita o usa dati dal target | Una spec che cita una `reference` per i dettagli tecnici |
| `implements` | `depends_on`, `required_by` | Realizza/operazionalizza i requisiti del target | Un `roadmap` che implementa un `ppd` |
| `extends` | `depends_on` | Aggiunge funzionalità o casi al target | Una `spec` v0.2 che estende v0.1 |
| `see_also` | `related_to` (default) | Correlazione informativa, nessuna dipendenza causale | Due `report` su temi vicini |
| `derived_from` | `related_to` | Evolve concettualmente dal target (più forte di see_also) | Un `report` che parte dai finding di un altro `report` |
| `supersedes` | `related_to` | Rimpiazza il target (usato in coppia con `status: superseded` sul target) | Un `spec` v2 che supersedes una v1 |
| `validates` | `related_to` | Testa o verifica il target (es. test plan ↔ spec) | Un `report` di test che valida una `spec` |

**Quando NON sai quale rel_type usare**: ometti il campo. Il default è `references` per `depends_on` e `see_also` per `related_to`, che sono i casi più comuni e meno impegnativi semanticamente.

### 2.5 `priority` (3 valori)

| Valore | Semantica |
|---|---|
| `high` | Documento di prima rilevanza per il progetto. LLM lo carica sempre quando il contesto lo permette |
| `medium` (default) | Importanza standard. LLM lo carica quando rilevante per il task corrente |
| `low` | Storico, archivio, materiale di consultazione occasionale. LLM lo carica solo se esplicitamente richiesto |

`priority` è un suggerimento per i consumer LLM, non un vincolo del validator.

---

## 3. Relation Rules

Regole che `mr-validate.mjs` applica ai 6 livelli di validazione. Vedi `tools/mr-validate/mr-validate.mjs` per l'implementazione.

### 3.1 Vincoli di integrità referenziale (livello 2 — errore se rotti)

- Ogni `id` referenziato in `depends_on`/`required_by`/`related_to`/`propagate_staleness_to` deve esistere come `id` di un altro file MR registrato nel registry (§4 di questo file).
- Ogni `superseded_by` deve puntare a un `id` esistente con `status: active` (non a un altro deprecated/superseded).
- Pattern `id` valido: `^[a-z0-9][a-z0-9/_-]*[a-z0-9]$` (slug con namespace opzionale, 2-80 char).

### 3.2 Vincoli di simmetria del grafo (livello 3 — warning se asimmetrici)

- Se A ha `depends_on: id: B`, allora B *dovrebbe* avere `required_by: id: A` (e viceversa).
- Asimmetria → warning (non errore). Nel profilo light (§1.8) il controllo non si applica: `required_by` non si scrive, lo scanner lo calcola in `mr-status.json`.
- Per ora (Spike 4 senza scanner), Claude Code può proporre all'utente di aggiungere il `required_by` mancante quando rileva un'asimmetria.

### 3.3 Vincoli di tipo (livello 4 — warning se non rispettati)

Vedi tabella §1.1 per le relazioni "tipiche" per tipo. In sintesi:
- `report` deve avere almeno un `depends_on` (i report nascono sempre da qualcosa: roadmap, spec, log)
- `roadmap` deve avere `depends_on` verso almeno un `spec` o `ppd`
- `spec` dovrebbe avere almeno un `required_by` (una spec serve a qualcosa di concreto)
- `how-to` dovrebbe avere `depends_on` verso un `reference` o `spec`
- `guide` dovrebbe avere `related_to` verso almeno un `explanation` o `reference`

### 3.4 Vincoli di status (livello 5 — errore o warning)

- `depends_on: strength: strong` verso un documento `deprecated` o `superseded` → **errore**
- `depends_on: strength: strong` verso un documento `draft` → **warning**
- `depends_on: strength: strong` verso un documento `paused` (v0.4) → **warning** (la dipendenza regge ma il target è dormiente: il documento dipendente potrebbe basarsi su uno stato che il paused non manterrà se ripartirà)
- `status: superseded` senza `superseded_by` → **errore** (vincolo schema condizionale `if/then`)

### 3.5 Vincoli di freshness (livello 6 — warning se stale)

- Se `_computed_staleness_days > staleness_threshold` → stale (warning)
- Se `_computed_staleness_days > staleness_threshold × 0.7` → warning (anticipatorio)
- Se `staleness_threshold: never` → mai stale, indipendentemente dall'età
- Se manca `last_updated`, lo scanner usa `created` come fallback

### 3.6 Regola di propagazione (operativa, non validata dal linter)

Quando un documento A con `propagate_staleness_to: [{id: B, ...}]` viene modificato sostanzialmente (ovvero il suo `_content_hash` cambia), il documento B deve essere considerato come **da rivalutare**. Lo scanner futuro lo segnalerà automaticamente. Per ora (Spike 4), Claude Code può proporre all'utente di rivalutare manualmente B quando rileva una modifica sostanziale ad A.

---

## 4. ID Registry

> **Sezione speciale**: questa è la **prima responsabilità documentale** di `matrix.md` (Finding #1 di Spike 0). Senza un registry esplicito `id → path`, ogni consumer (Dataview, Claude Code, scanner futuro) deve ricostruirsi la mappa localmente, con duplicazione di sforzo e fonte di errori.
>
> **Stato attuale**: compilazione manuale. Sarà auto-generata da `mr-scanner.mjs` quando esisterà (Spike 5+). Spike 4 popola questo registry a mano con i 3 file pilota.
>
> **Importante — disallineamento possibile col validator**: `mr-validate.mjs` NON legge questa sezione di `matrix.md`. Il validator costruisce il proprio registry on-the-fly scandendo il filesystem (`findMdFiles` + parsing del frontmatter). Questo significa:
>
> 1. Se aggiungi un nuovo file MR ma dimentichi di aggiornare la tabella §4.1, il validator NON se ne accorge (il file viene comunque registrato dal filesystem scan)
> 2. Se rimuovi un file MR ma dimentichi di togliere l'entry da §4.1, il validator NON se ne accorge (l'entry orfana resta solo in §4.1, irrilevante per la validazione)
> 3. Quindi §4.1 è una **proiezione cachata** (umana e per LLM) dello stato reale del filesystem, non l'autorità
> 4. **Lo scanner futuro (Spike 5)** sarà responsabile di mantenere §4.1 sincronizzato con il filesystem ad ogni run (auto-rigenerazione)
> 5. **Per ora (Spike 4 senza scanner)**: Claude Code deve aggiornare manualmente §4.1 ogni volta che aggiunge/modifica/rimuove un entry MR — vedi §5.3-5.5 delle Operational Instructions
>
> **Errore tipico del validator** in caso di id orfano: NON dice "manca in matrix.md", dice `Riferimento rotto (depends_on): "namespace/slug" non esiste nel registry` — dove "registry" = il Map che il validator costruisce dal filesystem in quella run, non §4.1 di matrix.md.

### 4.1 Tabella registry

> **Nota per `mr-scanner`** (Spike 6+): la tabella registry sotto è delimitata dai marker HTML `MR-REGISTRY-START/END`. Lo scanner sostituisce **integralmente** il contenuto tra i marker (decisione D4 di Spike 6: sostituzione integrale, scanner come autorità su §4.1). Dalla v0.5.1 lo fa **solo con `--write`**: senza flag mostra l'anteprima. Per rigenerare il registry senza toccare i doc: `node tools/mr-scanner/mr-scanner.mjs <dir> --write --profile light`. NON modificare manualmente i marker. Per editing manuale del registry (es. annotazioni umane), usare la sezione §4.1.bis sotto i marker.

<!-- MR-REGISTRY-START -->

| `id` | `type` | Path (da repo root) | `status` | `created` | `last_updated` |
|---|---|---|---|---|---|
| `mr/formato-mr-v03` | `spec` | `formato_MR_v0.3.md` | `active` | `2026-04-11` | `2026-04-11` |
| `mr/formato-v04-delta` | `spec` | `formato_MR_v0.4_delta.md` | `active` | `2026-04-26` | `2026-04-26` |
| `mr/formato-v05-delta` | `spec` | `formato_MR_v0.5_delta.md` | `active` | `2026-06-25` | `2026-06-25` |
| `mr/formato-v051-delta` | `spec` | `formato_MR_v0.5.1_delta.md` | `active` | `2026-10-03` | `2026-10-03` |
| `mr/formato-v06-delta` | `spec` | `formato_MR_v0.6_delta.md` | `active` | `2026-10-03` | `2026-10-13` |
| `mr/matrix` | `spec` | `matrix.md` | `active` | `2026-04-26` | `2026-10-03` |
| `mr/tools-mr-kg-readme` | `reference` | `tools/mr-kg/README.md` | `active` | `2026-06-25` | `2026-10-03` |
| `mr/tools-mr-readme` | `reference` | `tools/mr/README.md` | `active` | `2026-10-03` | `2026-10-22` |

<!-- MR-REGISTRY-END -->

### 4.2 Convenzione di namespace per `id`

- **Per file del progetto MR stesso**: `mr/<slug>` (es. `mr/ppd-00`, `mr/piano-rnd`, `mr/ricerca-00`)
- **Per file di altri progetti R&D in `progetti/`**: `<progetto>/<slug>` (es. `cpo/spec-prompts`, `gcm/ppd-00`, `progetto-c/schema-base`)
- **Per progetti esterni (futuro use case cliente)**: `<cliente-anonimo>/<area>/<slug>` (es. `acme/automation/zap-001`, `acme/service/hubspot-prod`)
- **Per riferimenti generici (root-level)**: `ref/<slug>` (es. `ref/claude-md-root`)

Lo slug è kebab-case, alfanumerico minuscolo, max 80 char totali (incluso namespace). Pattern regex: `^[a-z0-9][a-z0-9/_-]*[a-z0-9]$`.

### 4.3 Quando aggiungere un nuovo entry al registry

Ogni volta che un nuovo file con header MR viene committato nel repo. Per ora manualmente: aggiungi una riga alla tabella §4.1 con `id`, `type`, path, `status`, `last_updated`. In futuro lo scanner lo farà automaticamente eseguendo `node mr-scanner.mjs` come step CI o on-demand.

### 4.4 Quando rimuovere un entry dal registry

**Mai**, in linea di principio. Se un documento viene cancellato:
- Marcalo come `status: deprecated` o `superseded` (NON rimuovere il file)
- Mantieni l'entry nel registry per integrità referenziale (altri file potrebbero ancora avere `depends_on` verso il suo `id`)
- Se davvero il file deve essere rimosso fisicamente: prima rimuovi tutti i riferimenti `id → quello` dagli altri file, esegui `mr-validate.mjs` per confermare zero broken refs, poi rimuovi anche l'entry dal registry insieme al file

---

## 5. Operational Instructions (per Claude Code)

> **Audience di questa sezione**: tu, Claude Code (o qualsiasi LLM con tool di Read/Edit file). Non un essere umano che legge documentazione tecnica.
>
> **Dalla v0.5.1**: per taggare un doc usa la skill `mr-tag`, per domande sul grafo la skill `mr-query` (`.claude/skills/`). Nessuno strumento MR chiama API LLM esterne, e nessuno scrive su disco senza `--write`: lancialo prima senza, mostra il risultato, poi chiedi l'ok.
>
> **Quando un utente lavora su un repo che contiene un `matrix.md`**: leggi questo file come prima cosa quando l'utente menziona "MR", "metadati", "il sistema MR", "il grafo", o cita un `id` MR (formato `namespace/slug`).

### 5.1 Cosa fare all'apertura di una sessione MR

Se l'utente chiede qualcosa che riguarda il sistema MR (anche solo "qual è lo stato di MR?"):

1. **Leggi `matrix.md`** (questo file) per intero. È la sorgente di verità del sistema.
2. **Leggi il registry §4.1** per sapere quali file MR esistono nel repo.
3. **Non leggere tutti i file MR a priori** — solo quelli che servono per il task corrente. Pattern: just-in-time loading.
4. **Se serve un'overview dello stato**: esegui `node tools/mr-validate/mr-validate.mjs <path>` per ottenere un report PASS/FAIL + freshness table.

### 5.2 Cosa fare quando l'utente chiede di **leggere lo stato del grafo**

Esempi di prompt utente:
- *"Qual è lo stato del sistema MR?"*
- *"Quanti documenti MR abbiamo? Quanti sono stale?"*
- *"Dammi il punto della situazione delle automazioni catalogate"*
- *"Ci sono broken refs o asimmetrie nel grafo?"*

**Azioni**:
1. Esegui `node tools/mr-validate/mr-validate.mjs <path>` (con `<path>` = la root del progetto MR-enabled; `--profile light` se il progetto usa il profilo light)
2. Riporta all'utente: numero di documenti analizzati, errori, warning, freshness table sintetica
3. Se ci sono errori/warning: per ognuno, spiega *cosa* è il problema in termini umani e *cosa* l'utente può fare per risolverlo
4. Se ci sono file stale: proponi all'utente di rivedere i contenuti e poi aggiornare `last_updated` (oppure aspettare che lo scanner futuro lo faccia automaticamente quando cambia il `_content_hash`)

### 5.3 Cosa fare quando l'utente chiede di **aggiungere un documento al sistema MR**

Esempi di prompt utente:
- *"Aggiungi il file X.md al sistema MR come tipo report"*
- *"Tagga questa nuova automazione: si chiama Y, dipende dal SaaS Z"*
- *"Crea un nuovo entry MR per questo file"*

**Azioni**:
1. **Leggi il file target** per capire il contenuto e proporre `id`, `title`, `type`, `ai_summary`
2. **Verifica che l'`id` proposto non collida** con uno esistente nel registry §4.1. Se collide, proponi una variante.
3. **Costruisci l'header YAML** seguendo lo schema §1, con i campi obbligatori e quelli che hai informazioni per compilare. NON inventare relazioni: se l'utente non ha specificato `depends_on`, lascia il campo omesso (o vuoto) e chiedi all'utente se aggiungerle.
4. **Aggiungi l'header all'inizio del file target**, prima di qualsiasi contenuto esistente. Se il file ha già un header (es. blockquote markdown), il YAML va PRIMA del blockquote.
5. **Aggiorna il registry §4.1** di questo file: anteprima con `node tools/mr-scanner/mr-scanner.mjs <dir>`, poi, con l'ok dell'utente, `--write --profile light` (oppure a mano: `id`, `type`, path relativo dal repo root, `status`, date)
6. **Esegui `mr-validate.mjs`** per confermare che il nuovo file è valido e non rompe il grafo
7. **Riporta all'utente** cosa hai fatto: file modificato, entry aggiunto al registry, risultato del validator

### 5.4 Cosa fare quando l'utente chiede di **modificare un documento esistente**

Esempi di prompt utente:
- *"Aggiungi un `depends_on` da X verso Y, motivazione 'usa i dati di Y'"*
- *"Cambia il `priority` di Z a high"*
- *"Aggiorna il `staleness_threshold` di X a 90d"*

**Azioni**:
1. **Leggi il file target** e identifica il campo da modificare nell'header MR
2. **Verifica la validità della modifica** rispetto allo schema (§1) e ai vincoli (§3). Es: se l'utente vuole aggiungere un `depends_on` verso un `id` che non esiste nel registry, segnalalo PRIMA di modificare il file.
3. **Modifica il file** (Edit tool, NON Write — solo il pezzo necessario)
4. **Aggiorna `last_updated`** alla data odierna NEL file modificato (lo scanner futuro lo farà automaticamente, ma per ora è manuale)
5. **Se la modifica è sostanziale** (cambio relazioni, cambio status, cambio type), proponi all'utente di **rivalutare i file in `propagate_staleness_to`** (se presenti) e i file in `required_by` con `strength: strong`
6. **Esegui `mr-validate.mjs`** per confermare zero regressioni
7. **Aggiorna l'entry nel registry §4.1** se sono cambiati `type`, `status`, o `last_updated`

### 5.5 Cosa fare quando l'utente chiede di **deprecare/superseded/pausare un documento**

Esempi di prompt utente:
- *"Marca il documento X come deprecated"*
- *"Il documento X è stato sostituito da Y, marcalo superseded"*
- *"Dismetti questa vecchia automazione"*
- *"Metti in pausa il progetto X, è bloccato"* (v0.4)

**Azioni**:
1. **Caso `deprecated`**: cambia `status: deprecated` nel file. Non serve `superseded_by`.
2. **Caso `superseded`**: cambia `status: superseded` E aggiungi `superseded_by: <id-del-sostituto>`. Verifica che il sostituto esista nel registry e abbia `status: active` (vincolo §3.4).
3. **Caso `paused` (v0.4)**: cambia `status: paused`. Non serve sostituto. **Differenza chiave vs deprecated**: paused = "potrebbe tornare" (es. progetto bloccato per blocker esterno temporaneo). Usa paused se il documento potrebbe ripartire; usa deprecated se non c'è ragionevole aspettativa di ritorno.
4. **Verifica i `required_by` del documento target**:
   - per `deprecated`/`superseded`: ogni file con `depends_on: strength: strong` verso questo documento produrrà **errore** (vincolo §3.4). Avvisa: "I file A, B, C hanno una strong reference. Devo aggiornare anche loro?"
   - per `paused`: ogni file con `depends_on: strength: strong` produrrà **warning** (non errore). La dipendenza regge ma l'utente sa che il target è dormiente.
5. **Aggiorna l'entry nel registry §4.1** con il nuovo `status`
6. **Esegui `mr-validate.mjs`** e riporta gli errori/warning emergenti — sono tutti aspettati e da risolvere uno per uno con l'utente
6. **NON cancellare il file**: i documenti deprecated/superseded restano nel repo per integrità storica e per non rompere riferimenti

### 5.6 Cosa fare quando l'utente chiede di **trovare documenti stale, broken refs, o problemi**

Esempi di prompt utente:
- *"Quali documenti sono stale?"*
- *"Trova i broken refs nel sistema MR"*
- *"C'è qualcosa di rotto nel grafo?"*

**Azioni**:
1. **Esegui `node tools/mr-validate/mr-validate.mjs <path>`** — già fa tutto questo nei suoi 6 livelli
2. **Estrai le sezioni rilevanti** dell'output: la freshness table per stale, gli "❌ ERRORI" per broken refs, i "⚠️ WARNING" per asimmetrie
3. **Riporta in formato leggibile** all'utente, raggruppato per tipo di problema
4. **Per ogni problema**: spiega cos'è e proponi un'azione concreta (modifica file X, rimuovi relazione Y, ecc.)
5. **NON eseguire fix automatici** senza autorizzazione esplicita dell'utente

### 5.7 Quando proporre all'utente di **propagare staleness**

Quando un documento A ha `propagate_staleness_to: [{id: B, ...}]` E A viene modificato sostanzialmente (cambio di contenuto del body, non solo del frontmatter):

1. Avvisa l'utente: *"Hai modificato il documento A. A ha `propagate_staleness_to: B` con motivazione '...'. Vuoi che proponga di rivalutare anche B?"*
2. Se l'utente conferma, leggi B e aiutalo a capire se davvero ha bisogno di un aggiornamento dato il cambio in A
3. Se aggiornare B è necessario: aggiorna anche `last_updated` di B alla data odierna
4. Se non è necessario: nessuna azione, semplice acknowledgement

**Importante**: la propagazione è semanticamente diversa dalla simmetria `depends_on ↔ required_by`. La simmetria è strutturale (chi cita chi), la propagazione è operativa (chi diventa stale quando chi cambia). Possono coincidere ma non sempre.

### 5.8 Cosa NON modificare MAI senza autorizzazione esplicita

- **Campi `_*`** (`_content_hash`, `_computed_*`, `_last_scanned`): sono dello scanner. Se l'utente chiede di modificarli a mano, spiega che sono auto-generati e suggerisci di lasciarli stare (o di eseguire lo scanner quando esisterà).
- **File con `status: deprecated` o `superseded`**: leggibili ma immutabili. Se l'utente chiede di modificare un deprecated/superseded, conferma esplicitamente prima di procedere e ricordagli che il documento è marcato come tale.
- **File `matrix.md` stesso**: sì, puoi modificarlo (è il tuo "contratto"), ma con cautela. Modifiche a §1-§3 (schema, vocabulary, relation rules) vanno discusse esplicitamente con l'utente perché impattano TUTTI i file MR del repo. Modifiche al §4 (registry) sono routine — fai pure quando aggiungi/togli/modifichi entry.
- **Lo schema JSON** (`tools/mr-validate/mr-schema.json`): modificalo solo quando il vocabolario in §2 di questo file cambia, e sempre in coerenza con `formato_MR_v0.3.md`. Mai introdurre divergenze tra schema JSON e questo `matrix.md`.

### 5.9 Esempi di prompt utente da supportare (few-shot)

Lista di prompt che dovresti saper gestire seguendo le istruzioni qui sopra. Ogni esempio è un pattern per riconoscere intent simili.

#### Esempio 1 — Stato del sistema
**Utente**: *"Dammi il punto della situazione del sistema MR del progetto"*
**Tu**: leggi `matrix.md` se non già fatto, esegui `mr-validate.mjs`, riporta sintesi: N documenti, M errori, K warning, freshness table compatta.

#### Esempio 2 — Aggiungere un nuovo file
**Utente**: *"Ho appena scritto `docs/api-rest.md`, è una reference. Aggiungilo al sistema MR. Dipende dalla spec `mr/openapi-v1` e dal `mr/auth-spec`."*
**Tu**: leggi il file target, costruisci header MR con `id: docs/api-rest`, `type: reference`, `depends_on` ai 2 id citati. Verifica che i 2 target esistano nel registry. Aggiungi header all'inizio del file. Aggiungi entry al registry §4.1. Esegui validatore. Riporta all'utente.

#### Esempio 3 — Aggiungere una relazione
**Utente**: *"Aggiungi un `depends_on` dal piano R&D verso il documento `mr/ricerca-00`, motivazione 'fonte dati primaria'"*
**Tu**: identifica il file `piano-RnD-app-00.md` (o equivalente con id `mr/piano-rnd`), leggi il suo header, aggiungi un nuovo elemento all'array `depends_on` con i campi richiesti. Verifica esistenza del target nel registry. Aggiorna `last_updated` del file modificato. Esegui validatore.

#### Esempio 4 — Marcare come deprecated
**Utente**: *"Il documento `mr/spike-2-old` è obsoleto, marcalo deprecated"*
**Tu**: trova il file (via registry §4.1 → path), cambia `status: deprecated`. Cerca chi ha `depends_on` verso quel file con `strength: strong` (legge il registry e/o esegue validator) — segnala all'utente i file impattati. Aggiorna entry nel registry. Esegui validatore.

#### Esempio 5 — Stale check
**Utente**: *"Cosa è stale?"*
**Tu**: esegui `mr-validate.mjs`, estrai dalla freshness table tutti i file con stato 🟡 warning o 🔴 stale, riportali con motivazione (es. *"`mr/piano-rnd` è stale: 42 giorni dalla last_updated, threshold 30d"*). Per ognuno, proponi azione (rivedere il contenuto e aggiornare last_updated).

#### Esempio 6 — Trovare dipendenti di un file
**Utente**: *"Voglio modificare `mr/ppd-00`. Quali altri documenti devono essere rivalutati?"*
**Tu**: leggi il file target, estrai `required_by` e `propagate_staleness_to`. Riporta all'utente la lista degli `id` impattati con la motivazione di ciascuna relazione. Per i `propagate_staleness_to`: nota che dovranno essere rivalutati. Per i `required_by` con `strength: strong`: nota che potrebbero rompersi se la modifica è sostanziale.

#### Esempio 7 — Catalogazione automazioni cliente (use case business futuro)
**Utente**: *"Aggiungi questa automazione al sistema MR: si chiama 'Sync HubSpot → Notion contacts', usa i SaaS HubSpot e Notion, è critica"*
**Tu**: MR v0.4 non ha ancora un tipo `automation` dedicato (rinviato a v0.5+ post-pilota cliente). Usa `type: spec` come fallback con `priority: high`. Costruisci `id: <cliente>/sync-hubspot-notion-contacts`. Aggiungi `depends_on` verso eventuali entry MR per HubSpot e Notion (se esistono — altrimenti chiedi all'utente se vuole crearli prima). Avvisa l'utente: *"Per ora sto usando `type: spec` perché v0.4 non ha ancora `automation`. Quando arriverà v0.5+ (post-pilota cliente reale) il tipo dedicato sostituirà automaticamente."*

#### Esempio 8 (v0.4) — Catalogare un body di documentazione cross-progetto
**Utente**: *"Voglio mettere a sistema MR la cartella `_www/brain/` che ho usato per testare MR. Aiutami."*
**Tu**: leggi `matrix.md` (questo file) per ricordare i 5 tipi v0.4 (capsule, cross_cutting_doc, portfolio_view, html_mirror, index). Per ogni file di brain/: classifica in base al contenuto. `brain/projects/<slug>.md` → `capsule` con `external_dependencies` verso il `project_brief.md` corrispondente. `brain/<dimension>.md` (architecture, devops, sales) → `cross_cutting_doc` con `related_to` verso le capsule citate. `brain/portfolio*.md` → `portfolio_view` con `depends_on` su tutte le capsule + `propagate_staleness_to` verso eventuale `html_mirror`. `brain/README.md` → `index`. `brain/html/*.html` → `html_mirror` taggato via commento `<!-- mr-frontmatter -->` (walker `.html` deferito a v0.5). Esegui `mr-validate.mjs` per check simmetrie. Riferimento: la sessione field test del 2026-04-26 (Opus 4.7) ha taggato 28 file in **~30 minuti** con 0 warning post-fix.

#### Esempio 9 (v0.4) — Mettere un progetto in pausa
**Utente**: *"Metti in pausa il progetto FT, è bloccato sulla PSD2"*
**Tu**: trova la `capsule` di FT (es. `brain/projects/ft.md`). Cambia `status: active` → `status: paused`. Aggiungi una sezione "Blockers — Paused YYYY-MM-DD" nel body (cambia il `_content_hash`, lo scanner propagherà). Esegui `mr-validate.mjs`: i `depends_on: strength: strong` verso FT da altri file daranno warning (corretto, segnale informativo). Se la capsule ha `propagate_staleness_to: [portfolio, portfolio_sales, portfolio_oneline]`, il prossimo run di `mr-scanner.mjs` invaliderà automaticamente quei 3 target. Aggiorna entry registry §4.1 con `status: paused`. NON usare `deprecated` perché FT *potrebbe ripartire* quando il blocker PSD2 si risolve (semantica precisa di `paused`, vedi §2.2).

### 5.10 Caveat noti per i consumer

Vedi `formato_MR_v0.3.md` §12 per la lista completa. In sintesi:

1. **Normalizzazione YAML al save** (Front Matter CMS, Obsidian, ecc.): il git diff post-save è rumoroso. NON considerare cambio di virgolette/array inline come "documento modificato sostanzialmente". Usa `_content_hash` (body-only) come segnale di vera modifica.
2. **Micro-bug `Block - 1`** in Front Matter CMS: il labelField del primo elemento di un block esistente non viene applicato. Limitazione UX, non funzionale.
3. **Dataview `Enable JavaScript Queries`**: OFF di default in Settings → Dataview. Va attivato esplicitamente per i blocchi `dataviewjs` (graph traversal).
4. **Tastiera italiana**: il backtick richiede `AltGr + '`. Senza AltGr esce solo `'` (apostrofo singolo, non riconosciuto come delimitatore code block).

### 5.11 Editor visuali compatibili (per utenti che NON usano Claude Code)

NON sono priorità in v0.3, ma supportati come opzione secondaria. Se un utente menziona uno di questi editor, sai che il file MR è leggibile/modificabile da quel tool senza modifiche al formato:

- **Front Matter CMS** (VS Code): config in `frontmatter.json` (root del repo MR) con 5 content types (`spec`, `roadmap`, `report`, `ppd`, `explanation`) + 1 fieldGroup `mr_relation`
- **Obsidian Properties pannel**: nativo, zero setup
- **Obsidian Dataview**: plugin Community + abilitare JS queries
- **Astro Content Collections, TinaCMS, Decap CMS**: pattern "un content type per tipo MR" trasferibile (mai testato direttamente)

---

## 6. Use case di esportazione opzionale (futuri, NON in scope v0.3)

### 6.1 Code-to-docs reverse index

Idea per il futuro: un comando del tipo `node mr-scanner.mjs --reverse-index <file-codice>` che produce JSON con la lista degli `id` MR che referenziano quel file di codice. Use case: tool come driftcheck possono consumare questo output per saltare il loro step LLM di "scoperta delle relazioni" (vedi `report/spike-2-driftcheck.md` §4).

**Status**: requisiti in `PRD_MR_v0.6_codice-doc.md` (requisiti interni, non pubblicati) (`mr/prd-v0-6-codice-doc`, draft): collegamento codice ↔ documentazione, claim check, indice inverso. **Fasi 0.6-a, b e c implementate**: `node tools/mr/mr.mjs claims` (claim check R5), `scan` (claim + deriva di `code_refs` e ancore via git, R1-R4), `impact <commit|a..b|--staged|path>` (**indice inverso**, R6) — sempre in sola lettura; `verify <doc>[#sez] [--write]` (R7) e `suggest-links <doc|dir> [--write]` (R8), gli unici che scrivono, solo con `--write` e solo nei doc indicati; skill `mr-drift-review` e `mr-link`; repo locali con `--code-repo` o `mr.repos.yaml` (R10, note A5 e A9). Dopo una riscrittura della storia: `remap` (nota A16). Fase 0.6-d: `coverage` (R9), `scan --remote` via `gh api` (R10), `--format segnalazione` (R11). Misure in `report/pilota-0.6-a/`, `report/0.6-b/`, `report/0.6-c/`, `report/0.6-c1/` (soglia sull'hold-out, `tests/holdout/`).

### 6.2 Dashboard automazioni (use case cliente)

Idea per il futuro: un dashboard HTML statico generato da `mr-scanner.mjs` che mostra lo stato di tutti i documenti MR del repo, con grafo di dipendenze visualizzato + freshness aggregata + broken refs in evidenza. Alimentato da `mr-status.yaml` (anch'esso da implementare).

**Status**: idea documentata, nessuna implementazione. Spike 5+ post-PRD.

---

## 7. Riferimenti al di fuori di questo file

| File | Cosa contiene | Quando leggerlo |
|---|---|---|
| `formato_MR_v0.3.md` | Specifica completa del formato v0.3 (immutabile), con tutte le motivazioni M1-M16 | Quando devi capire *perché* il formato base è così, non solo *come* funziona |
| `formato_MR_v0.4_delta.md` | Delta v0.3→v0.4 (5 type, status:paused, external_dependencies). Cita brain field test come fonte | Quando lavori con i 5 tipi v0.4 o `external_dependencies` |
| `report/bozza_MR_v0.2.md` | Storica bozza v0.2 con motivazioni M1-M10 | Solo per archeologia / per capire la genesi del formato |
| `tools/mr-validate/mr-validate.mjs` | Validatore funzionante a 6 livelli | Quando devi eseguire una verifica reale del grafo |
| `tools/mr-validate/mr-schema.json` | JSON Schema del formato MR | Quando devi validare schematicamente un file (livello 1) |
| `piano_spike4.md` | Piano operativo di Spike 4 | Solo se stai facendo lavoro di Spike 4 stesso |
| `piano-RnD-app-00.md` | Piano R&D principale del progetto MR | Quando ti serve overview del progetto MR e dello stato dei suoi spike |
| `log.md` | Storico cronologico delle sessioni R&D | Quando ti serve sapere "perché abbiamo deciso X il giorno Y" |
| `PPD_00.md` | Product Proposal Document originale | Quando ti serve overview del *problema* che MR risolve, non del *come* |
| `ricerca-00-MR.md` | Ricerca stato dell'arte | Quando ti serve overview di cosa esiste fuori e come MR si posiziona |

**Regola di lettura efficiente**: NON leggere tutti questi file all'inizio di ogni sessione. Leggi solo `matrix.md` (questo file) come prima cosa quando si parla di MR. Tutti gli altri sono caricati just-in-time, solo se rilevanti per il task corrente.
