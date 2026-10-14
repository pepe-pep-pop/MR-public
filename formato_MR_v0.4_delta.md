---
mr_version: "0.4"
id: mr/formato-v04-delta
title: "Formato MR v0.4 — delta v0.3 → v0.4"
type: spec
owner: mr
status: active
created: '2026-04-26'
last_updated: '2026-04-26'
ai_summary: >-
  Delta del formato MR v0.3 → v0.4. Estensione additiva post field test su
  _www/brain/ (BRAIN-0 + WORKER-0, 2026-04-26). 5 nuovi type, status:paused,
  campo external_dependencies. Zero breaking changes su v0.3.
ai_keywords:
  [
    mr,
    v0.4,
    formato,
    delta,
    brain,
    capsule,
    paused,
    external_dependencies
  ]
priority: high
external_dependencies:
- path: "_soft/Miei/_www/brain/_mr/v0.4_proposal.md"
  reason: "Proposta originale v0.4 di WORKER-0 dopo field test su brain/. Fonte
    semantica delle 5 estensioni."
  type: brief
- path: "_soft/Miei/_www/brain/_mr/v0.4_validation_report.md"
  reason: "Validation report del field test: 28 file taggati, 8/8 acceptance, 3/5
    cascade FT automatica (i 2 mancanti sono html_mirror, fix deferito a v0.5)"
  type: brief
staleness_threshold: never
---

# Formato MR v0.4 — delta v0.3 → v0.4

> **Cos'è questo file**: documenta SOLO le differenze tra v0.3 e v0.4. La spec base (M1-M16, regole strutturali) resta in `formato_MR_v0.3.md` (immutabile). Per usare v0.4 come consumer LLM, leggi prima v0.3 poi questo delta.
>
> **Origine**: field test su `_www/brain/` (orchestratore BRAIN-0, esecutore WORKER-0 su Claude Opus 4.7, 2026-04-26). Cartella `brain/` resa MR-compliant in **~30 minuti** (28 file `.md` taggati con frontmatter v0.4 + 5 mirror `.html` taggati via commento HTML). 8/8 acceptance criteria, 0 warning post-fix asimmetrie. La proposta WORKER-0 e il validation report sono linkati come `external_dependencies` nel frontmatter qui sopra.
>
> **Filosofia v0.4**: estensione **additiva** di v0.3, **zero breaking changes**. Tutti i file `mr_version: "0.3"` restano validi senza modifiche.

---

## Sommario delle 5 modifiche

| # | Modifica | File toccati | Impatto |
|---|---|---|---|
| 1 | `mr_version` enum: aggiunto `"0.4"` | `mr-schema.json`, `matrix.md` §1.2 | Permette di marcare i nuovi file v0.4 senza errore schema |
| 2 | `type` enum: aggiunti 5 valori brain-extended | `mr-schema.json`, `mr-validate.mjs`, `mr-scanner.mjs`, `matrix.md` §1.1+§2.1 | Modella documentazione cross-progetto (capsule, viste, mirror, indici, analisi) |
| 3 | `status` enum: aggiunto `paused` | `mr-schema.json`, `mr-validate.mjs`, `matrix.md` §1.3+§2.2+§3.4+§5.5 | Distingue "documento in pausa che potrebbe tornare" da "deprecated" |
| 4 | Nuovo campo top-level opzionale `external_dependencies` | `mr-schema.json`, `matrix.md` §1.7 | Annota dipendenze su artefatti fuori dal grafo MR (es. brief esterni) |
| 5 | Nuovo doc delta (questo file) + aggiornamento `matrix.md` header v0.3→v0.4 | `formato_MR_v0.4_delta.md`, `matrix.md` header | Self-evidente |

**Costo totale upstream**: ~30 LoC modificati su `mr-schema.json` + `mr-validate.mjs` + `mr-scanner.mjs`, ~150 LoC aggiunte a `matrix.md`, +questo file (~250 righe). Zero refactor architetturale.

---

## 1. Nuovo `mr_version: "0.4"`

### 1.1 Schema enum

`mr-schema.json` accetta ora `"0.2"` (legacy), `"0.3"`, `"0.4"`. I file v0.3 esistenti non richiedono migrazione: restano validi a tempo indeterminato.

### 1.2 Quando usare `"0.4"` invece di `"0.3"`

- **Sempre** se il file usa uno dei 5 nuovi `type` (capsule, cross_cutting_doc, portfolio_view, html_mirror, index).
- **Sempre** se il file usa `status: paused`.
- **Sempre** se il file usa `external_dependencies`.
- **Opzionale** in tutti gli altri casi: file che non usano nessuna feature v0.4 possono restare `"0.3"` indefinitamente. Il bump della versione del singolo file è LAZY — solo quando serve.

### 1.3 I 4 file pilota upstream restano v0.3

Per scelta esplicita: `PPD_00.md`, `piano-RnD-app-00.md`, `ricerca-00-MR.md`, `PRD_MR_v0.1.md` non usano feature v0.4 → restano `mr_version: "0.3"` come **prova vivente di retrocompatibilità**. Il validator deve passare PASS su loro anche dopo il bump dello schema.

---

## 2. I 5 nuovi `type` (brain-extended)

### 2.1 Tabella sintetica

Vedi `matrix.md` §1.1 per tabella canonica con default. In sintesi:

| Tipo | Soglia default | Use case canonico |
|---|---|---|
| `capsule` | 30d | Riassunto sintetico (<200 righe) di un singolo progetto, derivato da `project_brief.md` esterno |
| `cross_cutting_doc` | 60d | Analisi narrativa che attraversa N progetti su una dimensione (architettura, devops, sales, timeline) |
| `portfolio_view` | 14d | Aggregatore presentazionale che cita TUTTE le capsule, ottimizzato per audience (sales, technical, oneline) |
| `html_mirror` | 30d | Versione HTML statica di un `.md` sorgente (generata fuori-MR). Walker `.html` deferito a v0.5 |
| `index` | 60d | Meta-documento navigazionale ("vai qui per X"). Diverso da capsule (un progetto) e cross_cutting_doc (una dimensione) |

### 2.2 Razionale delle soglie

- `portfolio_view: 14d` perché aggregatore — quando una capsule cambia, la view è quasi sempre da rivedere (soglia stretta = pressione a mantenere coerenza)
- `html_mirror: 30d` perché derivato meccanicamente — la rigenerazione è cheap
- `cross_cutting_doc: 60d` perché analisi che invecchia lentamente (i pattern strutturali del portfolio non cambiano in settimane)
- `capsule: 30d` perché lo stato di un progetto cambia in settimane (non giorni, non mesi)
- `index: 60d` perché la struttura di una cartella cambia raramente

### 2.3 Vincoli di tipo (livello 4 validator)

Aggiunti 4 warning (NON errori), seguendo il pattern esistente per i tipi v0.3:
- `capsule` senza `required_by` → "una capsule serve a una portfolio_view"
- `portfolio_view` senza `depends_on` → "deve citare le capsule"
- `html_mirror` senza `depends_on` → "deve avere esattamente 1 dep al .md sorgente"
- `cross_cutting_doc` senza `related_to` → "deve citare almeno una capsule"

### 2.4 Caveat noto: `html_mirror` e walker `.md`-only

Nel field test brain, i 5 file `.html` sono stati taggati via commento HTML:

```html
<!-- mr-frontmatter
mr_version: "0.4"
id: brain/html/portfolio-sales
type: html_mirror
depends_on:
  - id: brain/portfolio-sales
    reason: "Sorgente Markdown del mirror"
-->
```

**Il walker v0.4 di `mr-validate.mjs` e `mr-scanner.mjs` cerca SOLO `.md`** → questi tag NON vengono parsati. Conseguenza pratica:
- I 5 `.html` non sono nel registry §4.1
- I `propagate_staleness_to` da `.md` verso `.html` producono broken refs (5 errori nel field test brain)
- L'`_propagated_from` non viene mai scritto sui `.html` (perché lo scanner non li tocca)

**Decisione esplicita v0.4**: tag HTML come annotazione documentale; il valore di `propagate_staleness_to` del `.md` sorgente segnala intent. Walker `.html` → v0.5 (vedi §6).

---

## 3. Nuovo `status: paused`

### 3.1 Semantica

`paused` ≠ `deprecated`:
- `deprecated`: c'è ma non usare. Sostituito o non rilevante. Nessuna ragionevole aspettativa di ritorno.
- `paused`: in pausa, **potrebbe tornare**. Bloccato per blocker esterno temporaneo (compliance, dipendenza third-party, decisione strategica).

Caso reale che ha motivato il valore: **FT (Personal Finance Tracker)** messo in pausa il 2026-04-25 per blocco PSD2 (Plaid/Yapily contract-only, GoCardless BAD chiuso). FT non è morto: aspetta che il vincolo regolatorio si sblocchi.

### 3.2 Vincoli

- `depends_on: strength: strong` verso un paused → **warning** (NON errore come deprecated/superseded). La dipendenza regge ma il target è dormiente.
- Nessun campo aggiuntivo richiesto (nessun `paused_until`, nessun `paused_reason` obbligatorio — l'utente può aggiungerli liberamente nel body, ma lo schema non li impone).

### 3.3 Quando usare paused vs draft vs deprecated

| Stato del documento | Status corretto |
|---|---|
| In scrittura attiva, prima della pubblicazione | `draft` |
| Pubblicato, attivo, valido | `active` |
| Pubblicato, attivo, ma il progetto/concetto è in pausa | `paused` (v0.4) |
| Sostituito da un documento specifico | `superseded` + `superseded_by` |
| Non più rilevante, nessun sostituto, nessuna aspettativa di ritorno | `deprecated` |

---

## 4. Nuovo campo `external_dependencies`

### 4.1 Cosa modella

Dipendenze su artefatti **fuori dal grafo MR scansionato**. Caso canonico:

```yaml
external_dependencies:
  - path: "_soft/Miei/RM/FT/docs/project_brief.md"
    reason: "Brief sorgente da cui questa capsule è derivata"
    type: brief
```

Una `capsule` di FT in `_www/brain/projects/ft.md` dipende dal `project_brief.md` di FT, che vive in tutt'altra parte del filesystem (`_soft/Miei/RM/FT/`). Non è MR-tagged, non è scansionato dallo scanner di brain.

### 4.2 Schema entry

```yaml
- path: <stringa>             # OBBLIGATORIO — path filesystem (non risolto)
  reason: <stringa>           # OBBLIGATORIO
  type: brief|data|tool|repo  # OPZIONALE
```

### 4.3 Vincoli operativi

- **Validator NON risolve `path`**: solo annotazione documentale. Il path può essere relativo, assoluto, fuori-repo, URL-like.
- **Scanner NON propaga staleness**: `external_dependencies` è ortogonale a `propagate_staleness_to`. Lo scanner non visita questi path.
- **Pensato per LLM**: leggendo una capsule, Claude Code sa "se vuoi capire da dove viene, leggi quel file" e può aprirlo on-demand.

### 4.4 Alternative scartate

- `related_to` con `id` finto tipo `external/ft-brief`: scartato perché inquina il registry e produce broken refs. Il campo dedicato è la scelta pulita.
- Convertire i brief esterni in MR e linkarli con `id`: scartato perché inverte la logica (brain dovrebbe scoprire MR sui repo dei progetti, non viceversa) e perché v0.4 non supporta cross-repo MR.

---

## 5. Esempi canonici dal field test brain

Tutti gli esempi che seguono sono presi da file reali di `_www/brain/` (vedi `_www/brain/_mr/v0.4_proposal.md` per i dettagli e `_www/brain/_mr/v0.4_validation_report.md` per la validation).

### 5.1 `capsule` con `external_dependencies` + `paused`

```yaml
---
mr_version: "0.4"
id: brain/projects/ft
title: "Personal Finance Tracker (FT)"
type: capsule
owner: brain
status: paused                              # v0.4
created: '2026-04-25'
last_updated: '2026-04-25'
priority: high
external_dependencies:                      # v0.4
  - path: "_soft/Miei/RM/FT/docs/project_brief.md"
    reason: "Brief sorgente del progetto FT"
    type: brief
required_by:
  - id: brain/portfolio
    reason: "Riga FT nella tabella overview"
  - id: brain/portfolio-sales
    reason: "Capsule sales orientata B2C"
propagate_staleness_to:
  - id: brain/portfolio
    reason: "Cambio status FT → riga overview da rivedere"
  - id: brain/portfolio-sales
    reason: "Cambio status FT → capsule sales da rivedere"
---
```

### 5.2 `cross_cutting_doc`

```yaml
---
mr_version: "0.4"
id: brain/architecture
title: "Architecture — patterns across the portfolio"
type: cross_cutting_doc
owner: brain
status: active
created: '2026-04-25'
last_updated: '2026-04-25'
priority: high
related_to:
  - id: brain/projects/globeview
    reason: "Citato come pattern React + Vite + CesiumJS"
  - id: brain/projects/ft
    reason: "Citato come Next.js 14 outlier"
---
```

### 5.3 `portfolio_view` con cascade verso `html_mirror`

```yaml
---
mr_version: "0.4"
id: brain/portfolio-sales
title: "Portfolio progetti — sales view"
type: portfolio_view
owner: brain
status: active
created: '2026-04-25'
last_updated: '2026-04-25'
depends_on:
  - id: brain/projects/architetti
    reason: "Capsule fonte"
  - id: brain/projects/cleo
    reason: "Capsule fonte"
propagate_staleness_to:
  - id: brain/html/portfolio-sales
    reason: "Mirror HTML da rigenerare se cambia il sorgente"
---
```

### 5.4 `html_mirror` (commento HTML, non parsato in v0.4)

```html
<!-- mr-frontmatter
mr_version: "0.4"
id: brain/html/portfolio-sales
title: "Portfolio sales — HTML mirror"
type: html_mirror
owner: brain
status: active
created: '2026-04-25'
last_updated: '2026-04-25'
depends_on:
  - id: brain/portfolio-sales
    reason: "Sorgente Markdown del mirror"
-->
<!DOCTYPE html>
...
```

### 5.5 `index`

```yaml
---
mr_version: "0.4"
id: brain/readme
title: "Brain — project overview (index)"
type: index
owner: brain
status: active
created: '2026-04-25'
last_updated: '2026-04-25'
related_to:
  - id: brain/portfolio
    reason: "Citato come tabella at-a-glance"
  - id: brain/architecture
    reason: "Citato come deep narrative"
---
```

---

## 6. Deferito a v0.5

Decisioni esplicite di NON includere in v0.4 (post valutazione del field test):

### 6.1 Walker `.html` per `<!-- mr-frontmatter -->`

Estensione di `mr-validate.mjs` `findMdFiles` e `mr-scanner.mjs` `collectAllMrFiles` per parsare anche `.html` e estrarre frontmatter da commenti HTML. Stimato 30-60 min implementazione + test. Beneficio: chiusura completa della catena `capsule → portfolio_view → html_mirror` (oggi 3/5 cascade FT, sarebbe 5/5).

**Razionale del defer**: nel field test brain c'erano solo 5 file `.html`. Sotto questa soglia il workaround (commento HTML come annotazione + propagazione tracciata dal `.md` sorgente) è accettabile. Quando avremo >10 file `.html` da catalogare, vale la pena.

### 6.2 Scanner cascade events asymmetric reporting

Oggi `mr-status.json.propagation_events` contiene gli eventi della run corrente. Non c'è uno storico cumulativo né un report "questi target avrebbero dovuto ricevere staleness ma non ho potuto perché non sono nel registry" (caso `html_mirror` non scansionato). Out of scope v0.4.

### 6.3 Tipo `automation` per use case cliente

L'esempio §5.9.7 di `matrix.md` continua a usare `type: spec` come fallback per le automazioni cliente. Quando avverrà il pilota cliente reale (Spike 5 Step D), valuteremo se introdurre `automation` come 15° tipo MR. Per ora non c'è abbastanza esperienza per definirlo bene.

### 6.4 `paused_until` / `paused_reason` schemati

Oggi `paused` non ha campi accessori obbligatori. Se in futuro emergerà un pattern di "pausa con scadenza" o "pausa con motivazione strutturata", valuteremo. Per ora l'utente può scriverli come testo libero nel body.

### 6.5 Cross-repo MR

Oggi una capsule in `brain/` non può dichiarare `depends_on` verso una entry MR in `progetti/MR/` (registry per-cartella, validator non sa cercare cross-repo). Out of scope v0.4. Il maintainer ha già notato in `matrix.md` §4.2 che la convenzione di namespace lo permetterebbe sintatticamente.

---

## 7. Migrazione: cosa fare per usare v0.4

### 7.1 Per chi parte da zero

1. Tagga i file con `mr_version: "0.4"`
2. Usa i 5 nuovi tipi se modellano il tuo dominio (cataloghi cross-progetto, dashboard, indici)
3. Usa `external_dependencies` per puntare a brief esterni
4. Esegui `mr-validate.mjs` per check
5. Esegui `mr-scanner.mjs` per popolare campi `_*` e generare `mr-status.json`

### 7.2 Per chi ha già file v0.3

**Niente migrazione obbligatoria**. I file v0.3 restano validi. Bump della versione del singolo file solo quando inizi a usare una feature v0.4.

### 7.3 Per i tool

`mr-validate.mjs`, `mr-scanner.mjs`, `mr-schema.json` sono già aggiornati. Nessuna config aggiuntiva.

---

## 8. Riferimenti

- **Specifica base v0.3**: `formato_MR_v0.3.md` (immutabile, M1-M16)
- **Operational reference**: `matrix.md` (post bump v0.4: header, §1.1, §1.2, §1.3, §1.7, §2.1, §2.2, §3.4, §5.5, §5.9 esempi 8-9, §7)
- **Field test fonte di v0.4**: `_www/brain/_mr/v0.4_proposal.md` (proposta WORKER-0) + `_www/brain/_mr/v0.4_validation_report.md` (validation)
- **Tool**: `tools/mr-validate/{mr-validate.mjs, mr-schema.json}`, `tools/mr-scanner/mr-scanner.mjs`

---

*Generato da Claude Code Opus 4.7 (1M context) il 2026-04-26 in sessione di merge upstream del field test brain. Cita la proposta WORKER-0 come fonte semantica.*
