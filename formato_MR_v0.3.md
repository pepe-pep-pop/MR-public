---
mr_version: '0.3'
id: mr/formato-mr-v03
title: Formato MR v0.3 — Specifica
type: spec
owner: rnd
status: active
created: '2026-04-11'
last_updated: '2026-04-11'
depends_on:
- id: mr/matrix
  reason: Riferimento a matrix.md per type_defaults e sharding
ai_summary: Specifica del formato MR (Metadati Relazionali) v0.3, che definisce
  la struttura YAML per documenti tecnici con metadati relazionali. Include
  decisioni di scope (D1-D6), formato completo con campi obbligatori e
  opzionali, e riferimenti a strumenti di validazione e scanner.
ai_keywords:
- MR
- metadati relazionali
- v0.3
- specifica
- YAML
- validatore
- scanner
- LLM
priority: high
required_by:
- id: mr/matrix
  reason: Richiesto da mr/matrix (inverso automatico)
external_dependencies:
- path: id:mr/piano-spike4
  reason: Decisioni di scope e test riferiti a piano_spike4.md (doc del workspace
    d'origine, non presente nel repo MR)
  type: brief
staleness_threshold: never
---
# Formato MR v0.3 — Specifica

> **Data**: 2026-04-11
> **Status**: corrente — successore canonico di `report/bozza_MR_v0.2.md` (storico)
> **Basato su**: bozza v0.2 (Spike 3 + 3b + 3c) + finding di Spike 0 + 1 + 2 (Parte A e Parte B)
> **Decisioni di scope**: vedi §1 di questo file e `piano_spike4.md` §3
> **Validatore di riferimento**: `tools/mr-validate/mr-validate.mjs` con `mr-schema.json` aggiornato per accettare `mr_version: ["0.2", "0.3"]`
> **Consumer primario dei file MR**: Claude Code Opus 4.6 via prompt naturale (vedi §10)

---

## 1. Decisioni di scope (D1-D6)

Tutte prese durante la sessione 2026-04-11. Riferimento operativo: `piano_spike4.md` §3.

| ID | Decisione | Sintesi |
|---|---|---|
| **D1** | Versione | `mr_version: "0.3"`. v1.0 nascerà solo con ≥10 file MR-taggati in produzione + zero errori validatore per ≥2 settimane |
| **D2** | matrix.md | **Monolitico**. Trigger sharding tracciato in roadmap principale: refactor a `matrix/{index,schema,vocabulary,relation-rules,id-registry,operational-instructions}.md` se `matrix.md` supera 500 righe consistently per ≥2 settimane |
| **D3** | File pilota | `progetti/MR/PPD_00.md` (ppd) + `piano-RnD-app-00.md` (roadmap) + `ricerca-00-MR.md` (explanation). `tools/test-files/spec-office.md` rimosso preventivamente (riferimenti a id fittizi) |
| **D4** | Scanner `mr-scanner.mjs` | **Fuori scope Spike 4**. Diventa **prima feature del piano implementativo del PRD** (Spike 5). In Spike 4 i campi `_*` sono solo specificati concettualmente, non compilati nei pilota |
| **D5** | CI workflow GitHub Actions | **Rinviato post-PRD**. Resta tracciato come task in `matrix.md`, nessuna pressione temporale |
| **D6** | Test "LLM-readable da solo" | Claude Opus 4.6 in nuova chat **Claude Code** fresh, 3 prompt crescenti, criteri PASS/PARTIAL/FAIL specificati in `piano_spike4.md` §3 D6 |

---

## 2. Formato completo

```yaml
---
# === METADATI RELAZIONALI (MR) v0.3 ===
mr_version: "0.3"

# ── Identità ──
id: mr/the-office-spec             # slug unico decoupled da path (Antora). Pattern: ^[a-z0-9][a-z0-9/_-]*[a-z0-9]$
title: "The Office Spec v0.1"
type: spec                         # vocabolario controllato (Diátaxis-extended) — vedi §4
owner: core-team
status: active                     # active | draft | deprecated | superseded

# ── Versioning & freshness ──
version: 0.1.0                     # semver libero del documento (NON è mr_version)
created: 2025-12-01
last_updated: 2025-12-15           # aggiornato auto da mr-scanner se _content_hash cambia (v0.3+)
staleness_threshold: 90d           # ereditato da type_defaults in matrix.md se omesso

# ── Relazioni ──
depends_on:
  - id: ref/openclaw-claude-md
    reason: "Dati riferimento delta table Openclaw"
    strength: strong               # default per depends_on/required_by
    rel_type: references           # default: references

required_by:
  - id: office/output-v010
    reason: "Output generato da questa spec"
    strength: strong
    rel_type: implements

related_to:
  - id: ricerca/ironclaw-analysis
    reason: "Analisi variante confrontata nella spec"
    rel_type: see_also             # default: see_also (strength default: weak)

propagate_staleness_to:
  - id: office/output-v010
    reason: "Derivato diretto — rivalutare se spec cambia sostanzialmente"

# ── Deprecation (se applicabile) ──
# superseded_by: office/spec-v020  # OBBLIGATORIO se status: superseded

# ── Classificazione per LLM ──
ai_summary: "Standard agnostico per orchestrazione bot AI specializzati"
ai_keywords: [office, orchestration, agent, protocol, standard]
priority: high                     # high | medium | low

# ── Campi computed (mr-scanner) — non editare manualmente ──
# _content_hash: "sha256:a1b2c3d4e5f6"
# _computed_staleness_days: 75
# _computed_status: fresh          # fresh | warning | stale | broken
# _last_scanned: 2026-02-28
---
```

**IMPORTANTE — campo `_content_hash`** (decisione architetturale di v0.3, finding #4 di Spike 1):

Il `_content_hash` è calcolato **SOLO sul body markdown** (post-frontmatter), **MAI sull'intero file** (frontmatter incluso). Motivazione:

- Gli editor visuali (Front Matter CMS, Obsidian, ecc.) **normalizzano** il YAML al save: rimuovono virgolette opzionali, espandono array inline in multi-line, riordinano i campi. Cambia il *byte stream* del frontmatter senza che cambi il *contenuto semantico* del documento.
- Se `_content_hash` fosse calcolato sull'intero file, ogni save di un editor visuale lo rigenererebbe → `last_updated` verrebbe aggiornato erroneamente → tutto il sistema di freshness diventerebbe rumoroso e inaffidabile.
- Calcolando `_content_hash` solo sul body markdown, l'hash è invariante rispetto alla normalizzazione cosmetica del frontmatter. Lo scanner aggiorna `last_updated` solo quando il *vero* contenuto cambia.

**Non è negoziabile**: lo scanner Spike 5 deve implementarlo così.

---

## 3. Delta rispetto a v0.2

| Campo | v0.2 | v0.3 | Tipo modifica |
|---|---|---|---|
| `mr_version` | `"0.2"` | `"0.3"` | bump versione |
| `_content_hash` (body-only) | implicito | **esplicito**: solo body markdown, mai frontmatter | regola cristallizzata |
| Sezione "Decisioni di scope" | assente | presente (§1) | nuovo |
| Sezione "Compatibilità consumer" | assente | presente (§10) | nuovo |
| Sezione "Editor visuali" | assente | presente (§11) | nuovo |
| Sezione "Caveat noti per i consumer" | assente | presente (§12) | nuovo |
| Sezione "Use case di esportazione opzionale" (sinergia driftcheck) | assente | presente (§13) | nuovo |
| Vocabolario `type`, `status`, `strength`, `rel_type` | invariato | invariato | — |
| Regole di validazione (6 livelli) | invariato | invariato | — |
| Struttura `matrix.md` (5 sezioni) | invariato | invariato + finding #1 di Spike 0 (registry id→path = prima responsabilità) | rinforzato |

**Niente nuovi tipi MR introdotti in v0.3**: i tipi `automation`, `service`, `integration`, `process`, `dashboard` (rilevanti per il use case di catalogazione automazioni del cliente reale) sono **rinviati a Spike 5/post-PRD**, dopo aver applicato MR a 5-10 casi reali e aver capito quali distinzioni servono davvero.

---

## 4. Vocabolario controllato (invariato da v0.2)

### 4.1 `type` (Diátaxis-extended)

| Tipo | Origine | Semantica | `staleness_threshold` default |
|---|---|---|---|
| `guide` | Diátaxis: tutorial | Walkthrough guidato per onboarding | 60d |
| `how-to` | Diátaxis: how-to | Procedura per task specifico | 60d |
| `reference` | Diátaxis: reference | Descrizione tecnica puntuale | 30d |
| `explanation` | Diátaxis: explanation | Contesto e ragionamento architetturale | 180d |
| `spec` | MR-extended | Standard normativo, prescrive comportamenti | 90d |
| `roadmap` | MR-extended | Piano temporale e obiettivi | 30d |
| `report` | MR-extended | Risultati di spike/esperimento/analisi | never |
| `log` | MR-extended | Record di sessione, ADR, decisione puntuale | never |
| `ppd` | MR-extended | Product definition document | never |

### 4.2 `status`

| Valore | Semantica | Vincoli |
|---|---|---|
| `active` | Documento corrente e valido | — |
| `draft` | In lavorazione, non referenziabile come dipendenza strong | `depends_on: strength: strong` verso un draft → warning |
| `deprecated` | Sostituito o non più rilevante | `depends_on` verso deprecated → warning |
| `superseded` | Rimpiazzato da un altro documento | `superseded_by` obbligatorio |

### 4.3 `strength`

| Valore | Semantica | Effetto su validazione |
|---|---|---|
| `strong` (default per `depends_on`/`required_by`) | Dipendenza essenziale — rompere invalida il documento | Errore se target mancante o deprecated |
| `weak` (default per `related_to`) | Correlazione utile ma non critica | Warning se target mancante |

### 4.4 `rel_type`

| Valore | Applicabile a | Semantica |
|---|---|---|
| `references` | `depends_on` (default) | Cita o usa dati dal target |
| `implements` | `depends_on`, `required_by` | Realizza i requisiti del target |
| `extends` | `depends_on` | Aggiunge funzionalità al target |
| `see_also` | `related_to` (default) | Correlazione informativa |
| `derived_from` | `related_to` | Evolve concettualmente dal target |
| `supersedes` | `related_to` | Rimpiazza il target |
| `validates` | `related_to` | Testa o verifica il target |

---

## 5. Regole di validazione (invariate da v0.2 — vedi `mr-validate.mjs`)

6 livelli:
1. **Schema** — struttura YAML contro JSON Schema (ajv)
2. **Integrità referenziale** — ogni id in relazioni deve esistere nel registry
3. **Simmetria grafo** — `depends_on` ↔ `required_by` speculare (warning se asimmetrico)
4. **Vincoli di tipo** — un `report` deve avere `depends_on`, una `roadmap` deve dipendere da un `spec` o `ppd`, ecc.
5. **Vincoli di status** — strong ref verso deprecated/superseded → errore; verso draft → warning
6. **Freshness** — `_computed_staleness_days > staleness_threshold` → stale; > 70% threshold → warning

Output: PASS/FAIL con exit code 0/1, freshness table con icone 🟢🟡🔴, lista errori e warning specifici per file.

---

## 6. Campi computed (gestiti da `mr-scanner` — Spike 5)

| Campo | Calcolato come | Quando aggiornato |
|---|---|---|
| `_content_hash` | sha256 del **body markdown** (esclusi frontmatter e `---` delimitatori) | Ad ogni scan, confrontato con valore precedente |
| `_computed_staleness_days` | `today - last_updated` | Ad ogni scan |
| `_computed_status` | derivato da `_computed_staleness_days` vs `staleness_threshold` (fresh / warning / stale / broken) | Ad ogni scan |
| `_last_scanned` | timestamp esecuzione scanner | Ad ogni scan |

**Auto-update di `last_updated`**: se lo scanner trova `_content_hash` ≠ valore corrente, aggiorna `_content_hash` E `last_updated` a oggi. Questo elimina la disciplina manuale di tenere `last_updated` fresco.

**Decisione architetturale (D4)**: lo scanner non è ancora implementato in Spike 4. I 3 file pilota di Spike 4 **non avranno campi `_*` compilati**. Il validatore tollera la loro assenza. La prima feature implementativa del PRD (Spike 5) sarà proprio `mr-scanner.mjs`.

---

## 7. Struttura `matrix.md` (5 sezioni canoniche)

`matrix.md` v0.3 è **monolitico** (decisione D2). Le 5 sezioni canoniche, in quest'ordine:

```markdown
# matrix.md — Schema MR v0.3

## Schema
[definizione tipi MR validi, campi obbligatori per tipo, staleness default per tipo]

## Vocabulary
[valori validi per: type, status, strength, rel_type, priority]

## Relation Rules
[vincoli di tipo: chi può dipendere da chi, simmetria, vincoli di status]

## ID Registry
[lista ID dichiarati con tipo e path — auto-generata da mr-scanner in futuro,
manuale per i 3 pilota di Spike 4. PRIMA responsabilità di matrix.md
(vedi finding #1 di Spike 0 in §9)]

## Operational Instructions
[istruzioni operative per Claude Code Opus 4.6 (consumer primario):
come leggere i metadati, come gestire prompt utente di modifica grafo,
quando segnalare staleness, esempi di prompt da supportare]
```

**Trigger sharding** (decisione D2): se `matrix.md` supera 500 righe consistently per ≥2 settimane, refactor a struttura `matrix/` con 5 file separati. Anti-pattern BMAD #912 da evitare: il file `matrix.md` originale viene **eliminato** quando si crea `matrix/`, mai coesistenza.

---

## 8. Anti-pattern evitati (invariati da v0.2)

| Anti-pattern | Fonte | Come lo evitiamo |
|---|---|---|
| Dual source of truth | BMAD bug #912 | Se matrix.md viene shardato in matrix/, il file originale si elimina |
| Threshold globale fisso | BMAD issue #1218 | `staleness_threshold` per-documento con default per tipo |
| Dipendenze implicite | BMAD workflow code | Tutte le dipendenze esplicitamente dichiarate nel front matter |
| XML/formato pesante | DITA | YAML front matter — leggibile da umani e LLM senza parser specializzati |
| Relazioni solo gerarchiche | DITA default, Sphinx toctree | Grafo libero con `depends_on`/`required_by`/`related_to` |
| ID accoppiato al path | Pre-Antora | Slug unico decoupled dal filesystem |
| Validazione manuale | Pre-Sphinx | `mr-validate` automatico con exit code in CI |
| `_content_hash` su intero file | Spike 1 caveat normalizzazione YAML | sha256 calcolato SOLO sul body markdown (non frontmatter) |

---

## 9. Finding architetturali da Spike 0 + 1 + 2 (consolidamento per v0.3)

Nuovi rispetto a v0.2 — questi sono i 6 finding emersi durante le Parti B di Spike 0/1/2 e durante il source review di Spike 2.

### Finding #1 (da Spike 0) — Registry id→path è la PRIMA responsabilità di `matrix.md`

**Cosa**: Dataview di Obsidian (e in generale tutti i tool che indicizzano file markdown) indicizzano i file **per path filesystem**, non per il campo `id` custom del frontmatter. Per fare query come "dato l'id `mr/piano-rnd`, trovami il file", serve un registry esplicito `id → path`.

**Implicazione per v0.3**: la sezione `## ID Registry` di `matrix.md` è la **prima responsabilità documentale** (non solo un nice-to-have). Senza, ogni consumer (Dataview, Claude Code, validator, scanner futuro) deve ricostruirsi la mappa localmente — duplicazione di sforzo e fonte di errori.

**Realizzazione in Spike 4**: in Step B.4 della scrittura di `matrix.md`, la sezione ID Registry viene compilata a mano per i 3 file pilota. Quando lo scanner Spike 5 esisterà, sarà auto-generata da uno scan completo del repo.

### Finding #2 (da Spike 0 bonus) — Properties pannel di Obsidian = compatibilità gratis

**Cosa**: Obsidian ha introdotto in versione 1.4+ un **Properties pannel** che legge automaticamente il YAML frontmatter dei file in Reading view e lo rende come editor strutturato (con type inference per stringhe, liste, date, ecc.). Funziona **senza** plugin Dataview.

**Implicazione per v0.3**: per consumer che usano Obsidian (non priorità ma capita), MR v0.3 è leggibile e modificabile via UI nativa **a costo zero**. Limite: gli `id` nelle relazioni restano stringhe non-cliccabili — per la risoluzione id→file serve Dataview o un plugin custom.

**Implicazione per il PRD (Spike 5)**: nella sezione "Editor compatibili" elencare Obsidian Properties come opzione zero-effort.

### Finding #3 (da Spike 1) — Pattern "un content type per tipo MR" è portabile

**Cosa**: Front Matter CMS richiede che `contentType.name` matchi il valore del campo `type` del frontmatter. Questo ha forzato il pattern "un content type Front Matter = un tipo MR" (`spec`, `roadmap`, `report`, `ppd`, `explanation`), con un `fieldGroup` condiviso `mr_relation` per assorbire la duplicazione delle 4 relazioni.

**Implicazione**: questo pattern **non è specifico di Front Matter CMS**. Vale anche per Astro Content Collections (ogni `defineCollection({ schema })`), TinaCMS, Decap CMS, Sanity, Contentful. Tutti questi sistemi funzionano a "content type per tipo di documento". MR v0.3 è naturalmente adatto a tutti.

**Realizzazione**: vedi §11 (Editor visuali compatibili).

### Finding #4 (da Spike 1, critico) — `_content_hash` SOLO sul body markdown

Già integrato in §2 e §6 del formato. È il finding più importante per l'implementazione futura dello scanner. Ripetuto qui per enfasi: **mai calcolare il `_content_hash` sull'intero file**, sempre solo sul body post-frontmatter.

### Finding #5 (da Spike 1) — Caveat normalizzazione YAML al save

**Cosa**: Front Matter CMS (e probabilmente altri editor visuali) **normalizza** il YAML al save: rimuove le virgolette opzionali dalle stringhe (`title: "x"` → `title: x`), espande gli array inline in multi-line (`[a, b, c]` → bullet list), può riordinare campi. Semanticamente equivalente, ma il git diff dopo ogni save è **rumoroso** anche per modifiche minime.

**Implicazione per matrix.md** (sezione Operational Instructions): documentare questo comportamento come atteso. Lo scanner deve usare `_content_hash` (body-only) come trigger di "modifica reale", **non** il git diff o il timestamp del filesystem.

### Finding #6 (da Spike 2) — Sinergia opzionale con driftcheck

**Cosa**: driftcheck (tool open source pre-push hook che rileva drift code↔doc usando LLM) è **complementare** a MR, non concorrente. Le classi di errore coperte sono ortogonali (vedi `report/spike-2-driftcheck.md` §3.2 per la tabella).

**Sinergia possibile** (idea, non implementazione): MR può esporre un "code-to-docs reverse index" (dato un file di codice, quali doc lo referenziano secondo il grafo MR). driftcheck può consumare questo index per **saltare il suo step #1 di generazione query LLM** → risparmio ~50% chiamate LLM per push.

**Implicazione per v0.3**: nessuna implementazione, solo documentazione in §13 come "use case di esportazione opzionale".

---

## 10. Compatibilità consumer

| Consumer | Stato in v0.3 | Note |
|---|---|---|
| **Claude Code Opus 4.6 via prompt naturale** | ⭐ **PRIMARIO** | Editor canonico per leggere/scrivere/modificare i file MR. Sia per il developer R&D, sia per consumer non-tech via prompt mediato (es. ingegnere gestionale che dice "aggiungi questa automazione al sistema MR") |
| **`mr-validate.mjs` da CLI** | ✅ Pronto | Validatore 6 livelli, exit code 0/1, freshness table |
| **Obsidian + Dataview (DQL pure)** | ✅ Validato in Spike 0 | 4/6 query critiche in DQL pura: scalari, presence, nested field access, date arithmetic |
| **Obsidian + Dataview (dataviewjs)** | ✅ Validato in Spike 0 | Per graph traversal (simmetria, broken refs). Richiede `Enable JavaScript Queries` ON in Settings → Dataview |
| **Obsidian Properties pannel** | ✅ Validato in Spike 0 | Lettura/edit nativi del frontmatter senza Dataview, compatibilità gratis (Finding #2) |
| **Front Matter CMS in VS Code** | ✅ Validato in Spike 1 | Pattern `block + fieldGroup` funziona per array di oggetti annidati. Config in `progetti/MR/frontmatter.json`. Caveat: micro-bug `Block - 1` su labelField del primo elemento |
| **Astro Content Collections** | 🟡 Compatibile concettualmente | Stesso pattern "un content type per tipo MR". Mai testato direttamente |
| **TinaCMS / Decap CMS / Sanity / Contentful** | 🟡 Compatibile concettualmente | Idem |
| **driftcheck** (sinergia opzionale) | 🟡 Concettuale | Vedi Finding #6 e §13 |
| **GitHub Actions CI** | 🟡 Rinviato (D5) | `mr-validate.mjs` può essere chiamato da workflow YAML, mai scritto. Rinvio post-PRD |

⭐ = primario / ✅ = validato / 🟡 = compatibile non priorità

---

## 11. Editor visuali compatibili (opzione, NON priorità)

**Importante**: in v0.3 il consumer primario per modificare i file MR è **Claude Code Opus 4.6 via prompt naturale**, non un editor visuale per non-developer. Gli editor sotto sono compatibili e possono essere usati come **opzione alternativa**, ma non sono parte del flusso canonico di adozione.

| Editor | Pattern di integrazione | Effort di setup |
|---|---|---|
| **Front Matter CMS** (VS Code) | `frontmatter.json` con N content types (uno per tipo MR) + 1 `fieldGroup` condiviso `mr_relation`. Vedi `progetti/MR/frontmatter.json` per esempio funzionante con 5 content types | Una tantum: ~30 min per il file di config. Per progetti diversi, copia + adatta i path |
| **Obsidian Properties pannel** | Zero setup. Apre i file MR e mostra il frontmatter come editor strutturato | Zero |
| **Obsidian Dataview** | Plugin Community + abilitare `Enable JavaScript Queries` per dataviewjs. Query DQL ad hoc per esplorare il grafo | Una tantum: install plugin |
| **Astro Content Collections** | `defineCollection({ schema: z.object({...}) })` con uno schema Zod per ciascun `type` MR. Pattern noto, mai testato | Una tantum: setup Astro project |
| **TinaCMS / Decap / altri** | Stesso pattern "content type per tipo MR" | Variabile |

**Suggerimento per il cliente** (use case business, vedi memoria `current_client_company.md`): NON installare editor visuali a priori. L'ingegnere gestionale del cliente userà Claude Code via prompt. Solo se in futuro emerge un'esigenza specifica di edit massivo da parte di non-developer, valutare Front Matter CMS come opzione secondaria.

---

## 12. Caveat noti per i consumer

Lista dei comportamenti non-ovvi che un consumer (Claude Code, validator, editor visuale, utente umano) deve conoscere per non sorprese.

### 12.1 Normalizzazione YAML al save degli editor visuali

**Sintomo**: aprire un file MR in Front Matter CMS, modificare un campo, salvare → il git diff mostra molte righe modificate anche se il contenuto semantico è cambiato di poco. Tipico: virgolette rimosse da stringhe, array inline espansi in multi-line.

**Causa**: Front Matter CMS (e altri serializer YAML) normalizzano il frontmatter al save secondo le convenzioni di gray-matter / js-yaml.

**Mitigazione**: il `_content_hash` (Finding #4) è calcolato solo sul body markdown, quindi la normalizzazione del frontmatter NON triggera un falso "documento modificato" lato scanner. Il git diff resta rumoroso ma solo cosmetico.

**Da specificare in `matrix.md` Operational Instructions**: Claude Code deve sapere che il git diff cosmetico del frontmatter NON è da considerare "il documento è cambiato sostanzialmente".

### 12.2 Micro-bug `Block - 1` in Front Matter CMS

**Sintomo**: aprendo un file MR esistente in Front Matter CMS, il primo elemento di ogni `block` (es. il primo elemento di `depends_on`) viene etichettato `Block - 1` invece dell'`id` come specificato nel `labelField`. Anche apri+salva non risolve. Solo gli elementi creati nuovi dal pannello prendono il labelField corretto.

**Causa**: bug noto di Front Matter CMS sul rendering del labelField al primo caricamento.

**Mitigazione**: limitazione UX, non funzionale. I dati sono accessibili espandendo il record. Da segnalare upstream a Front Matter CMS o documentare come "caveat noto".

### 12.3 Dataview `Enable JavaScript Queries` OFF di default

**Sintomo**: in Obsidian, i blocchi `dataviewjs` non vengono eseguiti. I blocchi `dataview` (DQL pura) sì.

**Causa**: misura di sicurezza di Dataview per evitare esecuzione JS arbitrario.

**Mitigazione**: documentare in `matrix.md` che per consumer Obsidian, abilitare `Enable JavaScript Queries` in Settings → Dataview è prerequisito per le query di graph traversal (Q4/Q6 di Spike 0).

### 12.4 Tastiera italiana — backtick richiede AltGr

**Sintomo**: scrivere ` ``` ` (3 backtick) per delimitare un code block markdown su tastiera italiana richiede `AltGr + '`. Senza AltGr esce solo l'apostrofo `'`. Marcatore non riconosciuto da nessun parser markdown.

**Causa**: layout di tastiera.

**Mitigazione**: nessuna a livello di formato MR, è un caveat operativo. Documentato qui per evitare la ripetizione del bug emerso durante Spike 0 Parte B (vedi `report/spike-0-obsidian.md`).

---

## 13. Use case di esportazione opzionale (futuro, non in scope v0.3)

Documentati qui come "idee tracciate" per il PRD (Spike 5) e oltre. **Non implementare in Spike 4**.

### 13.1 Code-to-docs reverse index (sinergia con driftcheck)

**Cosa**: dato un file di codice (es. `src/lib/foo.ts`), produrre l'elenco di documenti MR che lo referenziano secondo il grafo MR. Output formato JSON, consumabile da tool esterni.

**Use case**: driftcheck può saltare il suo step LLM #1 (`generate_search_queries`) usando questo index al posto della ricerca via ripgrep + LLM. Risparmio stimato: ~50% chiamate LLM per push (vedi `report/spike-2-driftcheck.md` §4).

**Implementazione**: una feature di `mr-scanner.mjs` (Spike 5+) o uno script standalone derivato dal validator esistente.

### 13.2 Dashboard automazioni (use case cliente)

**Cosa**: un dashboard HTML statico generato da `mr-scanner` che mostra lo stato di tutte le automazioni del cliente con le loro dipendenze SaaS, freshness, broken refs. Alimentato da `mr-status.yaml`.

**Use case**: report periodico per il cliente sul "punto della situazione" delle sue automazioni. Strumento di consulenza per l'utente (vedi memoria `current_client_company.md`).

**Implementazione**: post-Spike 5, dopo aver applicato MR a 5-10 automazioni reali del cliente.

---

## 14. Header minimo reale

Il rischio "Overengineering: troppi campi, troppa complessità" è gestito con default impliciti. Header minimo pratico per un report di spike:

```yaml
---
mr_version: "0.3"
id: mr/spike-N-titolo
title: "Spike N — Titolo"
type: report
owner: rnd
created: 2026-04-11
depends_on:
  - id: mr/piano-rnd
    reason: "Piano R&D che definisce questo spike"
ai_summary: "Sintesi 1 frase del finding principale"
---
```

**8 righe di contenuto effettivo** (esclusi commenti e campi computed). Tutto il resto è calcolato (`_*`) o ereditato da `matrix.md` (default `staleness_threshold: never` per `report`, `strength: strong` per `depends_on`, `rel_type: references`, `priority: medium`).

---

## 15. Motivazioni storiche M1-M10 (da v0.2)

Tutte le motivazioni M1-M10 della bozza v0.2 restano valide per v0.3 senza modifiche. Per non duplicare ~150 righe, vedi il file storico `report/bozza_MR_v0.2.md` sezioni M1-M10:

- **M1**: `status` + `superseded_by` (Sanity strong reference + DITA subject scheme + Antora versioning)
- **M2**: `strength` strong/weak (Sanity Content Lake)
- **M3**: `rel_type` sottotipi (DITA collection types + Backstage vocabulary + Diátaxis cross-linking)
- **M4**: `propagate_staleness_to` (BMAD #1408 + Sphinx files_to_rebuild)
- **M5**: `_content_hash` (BMAD hash-based change detection)
- **M6**: `_computed_*` (BMAD pre-compute pattern + Sphinx -W)
- **M7**: `staleness_threshold` ereditato (DITA cascade + Diátaxis ontologia)
- **M8**: `matrix.md` come schema eseguibile (Sanity schema-as-code + DITA reltable + Sphinx objects.inv + BMAD project-context)
- **M9**: anti-pattern evitati (vedi §8 di questo file)
- **M10**: complessità controllata (default impliciti, retrocompatibilità v0.2)

## 16. Motivazioni nuove M11-M16 (per v0.3)

### M11 — Sezione "Decisioni di scope" esplicita all'inizio del file

**Why**: le decisioni D1-D6 di Spike 4 sono frutto di una sessione lunga di analisi. Senza una sezione dedicata che le ricapitola, un futuro reader (Claude Code o umano) deve risalirle da `piano_spike4.md` + `log.md`. Esplicitarle in §1 di questo file le rende prima-classe.

### M12 — `_content_hash` body-only come decisione cristallizzata

**Why**: il finding #4 di Spike 1 ha rivelato che gli editor visuali normalizzano il YAML al save. Senza una regola esplicita "hash solo sul body", l'implementazione dello scanner Spike 5 potrebbe scegliere a caso e introdurre falsi positivi di "documento modificato". Cristallizzare la regola ora previene il bug futuro.

### M13 — Sezione "Caveat noti per i consumer"

**Why**: durante Spike 0 e 1, sono emersi 4 caveat operativi non scoperti durante Spike 3+3b+3c (perché lì il test era headless, non interattivo). Documentarli ora evita che altri consumer ci sbattano contro.

### M14 — `matrix.md` ID Registry come prima responsabilità (rinforzato)

**Why**: il finding #1 di Spike 0 ha mostrato che senza il registry id→path, ogni consumer (Dataview, Claude Code, ecc.) deve ricostruirsi la mappa, con fonte di errori. v0.2 lo aveva come "una delle 5 sezioni"; v0.3 lo eleva a "PRIMA responsabilità documentale".

### M15 — Editor primario = Claude Code via prompt (decisione di consumer)

**Why**: l'utente ha esplicitato durante la sessione di pianificazione di Spike 4 che il consumer primario dei file MR è Claude Code Opus 4.6 via prompt naturale, sia in R&D personale sia in eventuale uso da parte del cliente (ingegnere gestionale via prompt mediato). Questo cambia il framing delle Operational Instructions di `matrix.md`: target è un LLM, non un essere umano non-tech.

### M16 — Nessun nuovo tipo MR introdotto in v0.3 (rinvio a Spike 5)

**Why**: il use case cliente (catalogazione automazioni) suggerirebbe nuovi tipi (`automation`, `service`, `integration`, ecc.). Ma introdurli in v0.3 senza averli validati su casi reali sarebbe overengineering. v0.3 mantiene il vocabolario v0.2 invariato. Nuovi tipi nascono in Spike 5 dopo che l'utente avrà applicato MR a 5-10 automazioni vere del cliente e capito quali distinzioni servono davvero.

---

## 17. Changelog v0.2 → v0.3

Formato Keep a Changelog.

### Added
- Sezione §1 "Decisioni di scope" con D1-D6
- Sezione §10 "Compatibilità consumer" con tabella editor + verdetto
- Sezione §11 "Editor visuali compatibili" — opzione, non priorità
- Sezione §12 "Caveat noti per i consumer" (4 voci)
- Sezione §13 "Use case di esportazione opzionale" (sinergia driftcheck, dashboard automazioni)
- Sezione §9 "Finding architetturali da Spike 0 + 1 + 2" (6 finding consolidati)
- Motivazioni M11-M16 per le novità di v0.3
- Specifica esplicita: `_content_hash` calcolato SOLO sul body markdown, mai sull'intero file

### Changed
- `mr_version` da `"0.2"` a `"0.3"`
- `mr-schema.json` aggiornato: `mr_version` accetta enum `["0.2", "0.3"]` invece di `const "0.2"` (transizione retrocompatibile, i test files restano v0.2 e validi)
- `matrix.md` ID Registry **rinforzato a prima responsabilità documentale** (era "una delle 5 sezioni")
- Header del file: dichiarato esplicitamente che il consumer primario è Claude Code Opus 4.6

### Deprecated
- Niente.

### Removed
- `tools/test-files/spec-office.md` rimosso preventivamente nel pre-step di Spike 4 (riferimenti a id fittizi `office/...`, dataset di test ora a 5 file)

### Fixed
- Niente (v0.2 era una bozza, non aveva bug — solo gap colmati in v0.3)

### Security
- N/A

---

**Fine del file `formato_MR_v0.3.md`**. Successivo passo logico: Spike 4 Step B (scrittura `matrix.md` con le 5 sezioni canoniche).
