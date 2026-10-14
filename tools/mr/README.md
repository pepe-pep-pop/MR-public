# mr — collegamento codice ↔ documentazione (v0.6-d)

Comando Node per le fasi 0.6-a, b e c del PRD
`PRD_MR_v0.6_codice-doc.md` (requisiti interni, non pubblicati). Nessuna rete, nessun LLM.
`claims`, `scan` e `impact` sono **sempre in sola lettura**; `verify`, `suggest-links` e `remap`
scrivono **solo con `--write` e solo nei doc indicati**, mai nel codice. Un'unica dipendenza: `yaml`
(`npm ci --prefix tools/mr`).

```bash
node tools/mr/mr.mjs claims <doc|dir> [...] [flag]   # affermazioni del doc verificate sul codice (R5)
node tools/mr/mr.mjs scan   <doc|dir> [...] [flag]   # claims + deriva dei code_refs e delle ancore (R1-R4)
node tools/mr/mr.mjs impact <commit|a..b|--staged|path> [--docs <dir>] [--fail]   # doc da ricontrollare (R6)
node tools/mr/mr.mjs verify <doc>[#sezione] [--write]   # codice e diff dei link; --write aggiorna verified (R7)
node tools/mr/mr.mjs suggest-links <doc|dir> [--write]  # ancore proposte, alla funzione (R8)
node tools/mr/mr.mjs remap <doc|dir> [--commit-map <f>] [--write] [--accept-fallback]   # dopo filter-repo (A16)
node tools/mr/mr.mjs coverage [<repo>] [--docs <dir>]   # punti d'ingresso che nessun doc cita (R9)
```

Formati: `--format md|json`, e per `claims`/`scan` anche `--format segnalazione` (R11): una
segnalazione `doc-stale` per doc nel formato del template di `_arch`, su stdout, con path:riga e
commit che ha causato ogni segnale (nota A20). `mr` non scrive in `_arch`: il file lo apre arch.

Flag comuni: `--rev <commit>` (doc e codice letti a quel commit, senza checkout),
`--code-repo <dir>` (ripetibile), `--code-rev <c>`, `--ignore-file <f>`, `--format md|json`,
`--all`; per `scan`, `--subjects` (oggetto dei commit).
Exit code (R11): `0` nessun segnale · `1` segnali · `2` errore. Per `impact`, `1` solo con `--fail`.

## claims — claim check (R5)

Estrae dai doc le affermazioni verificabili e le controlla sul codice.

| Tipo | Esempio nel doc | Controllo | Esiti |
|---|---|---|---|
| `path` | `` `supabase/functions/x/index.ts` `` | il file/la cartella esiste: dalla root, dalla cartella del doc, dopo il nome del repo, come suffisso unico, per nome di file | found · not_found · ambiguous |
| `env` | `` `APP_RESEND_API_KEY` `` | parola nel codice, nei workflow CI o in `.env.example` | found · not_found |
| `table` | `` `portali.spedizioni` `` | espressione nel codice, oppure i due nomi nello stesso file di schema | found · not_found · ambiguous |
| `endpoint` | `` `POST /api/ordini` `` | prefisso fisso nel codice, routing per file, edge function Supabase | found · not_found |
| `command` | `` `pnpm run deploy` ``, `` `make x` ``, `` `deno task x` `` | script / target / task presente | found · not_found |
| `symbol` | `` `calcolaQuota()` `` | definizione riconosciuta | found · not_found · ambiguous |

Fonti: code span inline; nei blocchi shell solo i comandi. Evidenze: al massimo 3 `path:riga`,
mai il contenuto delle righe.

## scan — link doc → codice e deriva (R1-R4)

I link si dichiarano nel frontmatter o con un'ancora nella sezione
([`formato_MR_v0.6_delta.md`](../../formato_MR_v0.6_delta.md)):

```yaml
code_refs:
  - path: supabase/functions/sync-gcal/index.ts
    symbol: syncCalendar
    repo: acme/app-web          # opzionale
    section: "## Sincronizzazione"   # opzionale
    verified: { commit: '3f2a91c' }  # hash TRA APICI
```

```markdown
<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=3f2a91c -->
```

Se una sezione ha un'ancora, vale l'ancora (i `code_refs` con la stessa `section` si ignorano).

| Esito | Significato |
|---|---|
| `ok` | nessun commit sul codice dopo `verified`, oppure il file è cambiato ma il simbolo no |
| `drift` | il codice è cambiato: commit (hash e data) e diff ridotto al simbolo |
| `moved` | file rinominato (`git diff -M`) o simbolo definito in un altro file |
| `missing` | file o simbolo non esistono più |
| `unverified` | `verified` assente |
| `unresolvable` | repo non disponibile in locale, o commit di `verified` non presente |

Livello di risoluzione del simbolo (R4), sempre nel report: `regex` (definizione trovata e fine
del blocco per graffe, indentazione o `;`), `occurrences` (righe in cui compare il nome, es. una
variabile d'ambiente), `file`, `glob`. Il diff è troncato a 40 righe; le righe che sembrano
segreti e gli indirizzi email sono omessi (N4).

## impact — indice inverso (R6)

`mr impact <bersaglio>`: per un commit, un intervallo `a..b`, lo staged o un file, elenca
doc e sezioni da ricontrollare:
- link il cui file è toccato: «simbolo toccato» se le righe cambiate cadono nel simbolo, «file toccato (simbolo no)» altrimenti; più «simbolo non più trovato» e «file cancellato»;
- claim: path che corrispondono a un file toccato (solo file, un nome nudo solo se unico nel repo); nomi (env, simboli) nelle righe cambiate; tabelle come testo esatto o nei file di schema; endpoint nelle righe cambiate.

I `.md` toccati non contano (i legami doc ↔ doc sono di `mr-scanner`), salvo `--include-docs`.
`--fail` dà exit 1 se ci sono doc da ricontrollare. Pensato per un hook che avvisa: per ora resta
un comando manuale (decisione del maintainer).

## verify — verifica e aggiornamento di `verified` (R7)

`mr verify <doc>[#sezione]` mostra per ogni link: esito di R3, codice attuale del simbolo
(troncato, oscurato), diff dal commit verificato, e l'anteprima della modifica al doc. Con
`--write` aggiorna `verified` al commit corrente del repo del codice: hash tra apici singoli e
`date` = data di quel commit (nota A16). Solo per i link `ok`, `drift` o `unverified`. Rifiuta:
- `moved`: prima va aggiornato il path;
- `missing`, `unresolvable`;
- i file con modifiche non committate nel repo del codice.

Frontmatter riscritto con la Document API di `yaml` più un allineamento LCS: cambiano solo le righe
toccate (commenti e spazi conservati). Ancore modificate solo sulla loro riga; `_content_hash`
invariato. Exit 1 se qualche link non è verificabile. Il giro completo, con la rilettura della
sezione, è nella skill `mr-drift-review`.

## suggest-links — proposta di link (R8)

Parte dai claim `found` e propone ancore sotto il titolo di ogni sezione:
- **simbolo citato** → file che lo definisce + `symbol`;
- **README nella cartella di una funzione** (`functions/<nome>/README.md`, nota A19) → l'index di quella cartella, sotto il titolo principale, file intero;
- **soggetto del titolo** (nome tra backtick nel titolo che corrisponde a una cartella o a un file) → file d'ingresso (`index.*`, `mod.ts`…). **Eccezione A13**: se il file *è* quella funzione (index di una cartella-funzione, o file con una sola funzione esportata) il link è al file intero, «file = funzione» nel report; altrimenti ancorato a un simbolo che si risolve;
- **tabella, endpoint** → file + simbolo; **nomi in maiuscolo** solo se in un file solo o nella cartella del soggetto;
- **file citato** → un simbolo della sezione che si risolve in quel file, altrimenti il **file intero, dichiarato** con `livello=file` nell'ancora e «⚠️ file intero: motivo» nel report (nota A12).

Niente `verified` (collegare non è verificare), niente link verso `.md`, niente doc storici,
niente doppioni. **Diari esclusi per default** (nota A15): `hof-*.md`, `handoff/`, `segnalazioni/`,
`log/`; `--include-journals` per includerli. Con `--write` inserisce le ancore; `_content_hash` non cambia. Il giro con la
revisione è nella skill `mr-link`.

## remap — dopo una riscrittura della storia (nota A16)

`git filter-repo` lascia la mappa `old new` in `.git/filter-repo/commit-map`. `mr remap <doc|dir>
--commit-map <f>` riancora i `verified` in modo esatto: hash corto → sha vecchio → sha nuovo, con la
data del commit. Esiti: `presente` (commit ancora lì), `esatto`, `eliminato` (la riscrittura l'ha
tolto: riverificare), `ambiguo`, `ripiego`, `non_trovato`.
- **Ripiego** (senza mappa, o commit non in mappa): candidati per `verified.date` + file, con oggetto oscurato. Si applica **solo** con `--write --accept-fallback` e un candidato unico.
- Anteprima di default; `--write` applica gli esatti; exit 1 se restano link non risolti.

## coverage — codice non documentato (R9)

`mr coverage [<repo>]` elenca i punti d'ingresso che nessun doc nomina: funzioni (supabase,
netlify, `api/`, `pages/api`, SvelteKit), route nel codice, migration, workflow CI e cron, file di
deploy, variabili di `.env.example` (solo i nomi). «Citato» = nominato in un code span o in un
titolo di un doc non storico e non diario, o coperto da un link. File di test esclusi;
`mr.coverage.yaml` con `exclude: [glob]`. Informativo, exit 0: serve a scegliere cosa merita una
riga, non a pretendere che tutto sia documentato.

## Più repo: `--code-repo` e `mr.repos.yaml` (R10)

```yaml
# mr.repos.yaml, nella root del repo dei doc (oppure --repos-file <f>)
repos:                         # nome → path locale, relativo alla root del repo dei doc
  app-web: progetti/app-web
map:                           # vale la PRIMA regola che corrisponde al path del doc
  - docs: "_arch/segnalazioni/workspace/app-web/**"
    repos: [app-web, self]       # self = il repo dei doc
```

**Vincolo (nota A9):** un claim conta trovato solo nei repo mappati per il suo doc o la sua
cartella. Un doc senza regola usa solo il proprio repo. Precedenza: `--code-repo` > `--repos-file` >
`mr.repos.yaml` > repo dei doc. `impact` considera solo i doc mappati sul repo del codice.

### Repo non in locale: `scan --remote`

I link con `repo: owner/nome` senza un repo locale corrispondente si leggono da GitHub con
`gh api`: solo GET (`repos`, `contents`, `compare`), solo con `--remote`, mai clone. Esiti come R3
tranne `moved`; livelli `remote-*`.

### `--code-repo` (R10 minimo, 0.6-b)

I doc si leggono dal loro repo, il codice dai repo indicati con `--code-repo` (ripetibile):
- per i claim vale l'esito migliore;
- per i link, `repo: owner/nome` si abbina al remote `origin` di un `--code-repo`, e i link senza `repo` usano il primo.

Senza un repo locale corrispondente: `unresolvable`. La lettura via `gh api` e la mappa
`mr.repos.yaml` sono della fase 0.6-d.

## Doc storici (nota A7)

Piani chiusi (`docs/superpowers/plans/`), `status` superseded / deprecated / done / archived,
cartelle d'archivio (`_archive`, `archivio`, `old`, `legacy`, `ref`, …) e regole `storico:<glob>`:
gli esiti si calcolano, ma non danno segnali né exit code 1; nel report c'è una riga per doc.

## Sicurezza (N4)

- Mai letti: `.env*` (tranne `.env.example` / `.sample` / `.template`), `*.pem`, `*.key`, file
  con `SECRET` / `SEGRETI` nel nome. I doc con quei nomi si saltano e si dichiarano.
- Delle variabili d'ambiente si cerca solo il nome.

## Allow-list

`mr.claims.ignore` nella root del repo dei doc, oppure `--ignore-file`. Righe: testo esatto,
glob con `*`, `tipo:pattern` (es. `env:VITE_*`), `doc:<glob>`, `storico:<glob>`. Nel doc,
`<!-- mr:ignore-claim -->` esclude la riga.

## Prestazioni (N5)

Ricerche in blocco e indice degli identificatori in memoria. Su app-web (664 doc, 13.163 claim):
`claims`/`scan` circa 4 s, `impact HEAD` 0,55 s.

## Golden set e misure

`node tools/mr/golden.mjs --repos-root <dir>`, con i casi in
`tests/golden/cases.json` (non pubblicato: casi presi da repo privati). Risultati in
report interni (non pubblicati).

## Test

```bash
PATH="$PWD/.venv/bin:$PATH" npm test --prefix tools/mr   # claims, scan, redact, repomap, verify, remap
# test-remap usa git-filter-repo: .venv/bin/pip install -r tools/mr/requirements-test.txt
```

## Limiti noti

- `suggest-links` non vede le sezioni che non nominano codice: lì il link lo aggiunge una persona
  (skill `mr-link`). Misure in `report/0.6-c/`.
- **Dopo una riscrittura della storia del repo del codice**, `verified.commit` diventa `unresolvable`
  finché non si lancia `mr remap`.
- Su file molto attivi, un link a livello di file chiede verifiche frequenti: meglio il simbolo.
- Simboli con euristiche (livello 2). Tree-sitter (livello 1) non implementato: vedi la PR della 0.6-d.
