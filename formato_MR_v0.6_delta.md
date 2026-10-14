---
mr_version: '0.6'
id: mr/formato-v06-delta
title: Formato MR — delta v0.5.1 → v0.6 (link doc → codice)
type: spec
owner: rnd
status: active
created: '2026-10-03'
last_updated: '2026-10-13'
depends_on:
- id: mr/formato-v051-delta
  reason: estende il delta v0.5.1
---

# Formato MR — delta v0.5.1 → v0.6

**Data:** 2026-10-03 · **Requisiti:** `PRD_MR_v0.6_codice-doc.md` (requisiti interni, non pubblicati)

Estensione additiva: i doc senza i campi nuovi validano come prima (N7). `mr_version: '0.6'`
è ammessa; i campi nuovi sono accettati anche con versioni precedenti.

## 1. `code_refs` nel frontmatter (R1)

```yaml
code_refs:
  - path: supabase/functions/sync-gcal/index.ts   # relativo alla root del repo del codice; glob ammessi
    symbol: syncCalendar                            # opzionale: funzione, classe, route, tabella, env var
    repo: acme/app-web                         # opzionale: assente = stesso repo del doc (o --code-repo)
    section: "## Sincronizzazione"                  # opzionale: sezione del doc che descrive questo codice
    verified: { commit: '3f2a91c', date: '2026-10-03' }   # ultimo controllo; date raccomandata (nota A16)
```

- `path` obbligatorio; gli altri campi opzionali. Schema in `tools/mr-validate/mr-schema.json`
  (`code_ref_entry`), ammesso nel profilo light.
- **L'hash di commit va tra apici.** Senza apici, YAML legge `0164750` come numero (e js-yaml
  come ottale) e `3e45123` come float: il validatore lo segnala con «must be string». `mr` legge
  comunque il frontmatter con lo schema failsafe, quindi ogni scalare resta stringa.
- `verified` si aggiorna solo con `mr verify <doc>[#sezione] --write` (R7), mai in automatico:
  hash corto del commit corrente tra apici singoli e `date` = data di quel commit (nota A16: la
  data è raccomandata, `mr-validate` avvisa se manca; serve a rimappare dopo una riscrittura).
- Dopo `git filter-repo`: `mr remap <doc|dir> --commit-map .git/filter-repo/commit-map` riancora i
  `verified` in modo esatto (anteprima; `--write` dopo l'ok). Senza mappa, o per i commit che non
  ci sono, propone candidati per data + file, applicati solo con `--accept-fallback`.
- Dalla 0.6-c `mr-validate` dà **errore** se `commit:` nei `code_refs` non è tra apici (nota A11);
  le ancore sono esenti.

## 2. Ancore nel corpo (R2)

```markdown
<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=3f2a91c date=2026-10-03 -->
```

- Stessi attributi di `code_refs` (`path`, `symbol`, `repo`, `verified`, `date`), valori anche tra
  virgolette. Valgono per la sezione in cui stanno (il titolo più vicino sopra).
- Se una sezione ha almeno un'ancora, i `code_refs` del frontmatter con `section` uguale non si usano.
- Attributo informativo `livello=file` (0.6-c): lo scrive `suggest-links` quando ancora al file intero
  perché nessun simbolo della sezione si risolve (nota A12). Non cambia il calcolo della deriva.
- **Le ancore non contano per `_content_hash`** (nota A2): righe che contengono solo l'ancora
  spariscono prima dell'hash, altrimenti si toglie il commento. Aggiornare `verified=` non fa
  scattare la propagazione. Implementazione identica in `mr-scanner` e `mr-validate`.

## 3. Esiti della deriva (R3) e livelli (R4)

`node tools/mr/mr.mjs scan <dir>`: `ok`, `drift`, `moved`, `missing`, `unverified`,
`unresolvable`. Livello: `regex` (definizione trovata), `occurrences` (righe in cui compare il
nome, es. una variabile d'ambiente), `file`, `glob`. Il livello 1 (tree-sitter) è della fase 0.6-d.

## 4. Doc storici (nota A7)

Piani chiusi (`docs/superpowers/plans/`), `status` superseded / deprecated / done / archived,
cartelle d'archivio (`_archive`, `archivio`, `old`, `legacy`, `ref`, …) e regole
`storico:<glob>` dell'allow-list: gli esiti si calcolano ma non producono segnali né exit code 1;
nel report c'è una riga informativa per doc.

## 5. `review_needed`: doc da aggiornare (0.6-z)

Campo opzionale, ammesso anche nel profilo light: `review_needed: "<motivo breve>"` (stringa da 1 a
200 caratteri, senza dati personali).

**Quando.** Il doc è ancora valido, quindi `status: active`, ma ha parti non più vere oggi, e la
correzione non si fa subito. Esempio: `review_needed: "elenco fermo a 52 funzioni, oggi 93"`.

**Effetti:**
- `mr-validate` dà un warning «da aggiornare (review_needed): <motivo>», tranne che per i doc
  `superseded` o `deprecated`;
- il giro lo conta e lo elenca per repo nella sezione «Salute dei doc», a parte dai problemi del
  frontmatter;
- `mr rivisto <doc> --write` lo toglie insieme all'aggiornamento di `last_updated`: «riletto ed è
  vero» vuol dire che le parti da aggiornare sono a posto. `--tieni-review` lo lascia.

## 6. Date da git senza i commit di sola redazione (0.6-z)

Non è un campo, è una regola per scrivere `created` e `last_updated`:
- `created` è il commit che ha aggiunto il file, seguendo i rename;
- `last_updated` è l'ultimo commit che cambia il contenuto. Non contano i commit che lasciano il testo
  invariato (solo frontmatter, o solo spostamento del file) e i commit di sola redazione dichiarati nel file `mr.redazioni` del repo dei doc, uno
  sha (almeno 7 caratteri) o `messaggio: <testo>` per riga.

`mr date <doc|dir>` le calcola in sola lettura e le confronta con quelle del frontmatter.

**Repo nato da un import (0.6-z2).** La riga `import: <sha>` in `mr.redazioni` dichiara un commit
d'importazione. Per i doc creati in quel commit le date di git non dicono niente, e `mr date` legge
quelle dichiarate nelle prime 40 righe del testo:
- «Data:», «Date:», «Scritto:», «Generato:», «Creato:», «Data sessione:» danno `created`;
- «Last updated:», «Ultimo aggiornamento:», «Aggiornato:» danno `last_updated`;
- senza una data di aggiornamento, `last_updated` è la stessa data di creazione;
- un commit dopo l'import che cambia il testo dà `last_updated` come sempre.

Formati letti: `2026-05-12` e `12/05/2026`. Senza data nel testo, le due date restano sconosciute e il
confronto col frontmatter non segna «diverso».

## 7. Chiavi di altri strumenti nel profilo light (0.6-z1)

Altri strumenti leggono il frontmatter dallo stesso blocco: `pdf_options` di md-to-pdf, `layout` di
Astro, le chiavi di Docusaurus. Nel profilo light una chiave di primo livello che lo schema MR non
conosce è un **warning** «chiave di un altro strumento», non più l'errore di schema «(root) must NOT
have additional properties». I campi MR restano controllati come prima (tipo, formato, valori). Nel
profilo full resta errore.

## 8. Frontmatter non leggibile (0.6-z3)

Un frontmatter che il parser YAML non legge (tipico: `title: A: b` senza virgolette) non fa più
sparire il doc in silenzio:
- **`mr-validate`:** errore «frontmatter non leggibile (riga N: …)» se il blocco contiene
  `mr_version:`; warning se non lo contiene (forse il frontmatter di un altro strumento). Il
  riepilogo conta i file saltati.
- **`mr-scanner`:** stessa riga, conteggio nel riepilogo, exit 1 se un doc MR è rotto (non entra nel
  registry).
- **Giro, «Salute dei doc»:** il doc conta tra quelli con frontmatter, con il problema «frontmatter non
  leggibile».

Regola di scrittura: `title` sempre tra virgolette doppie.

