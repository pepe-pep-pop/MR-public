---
mr_version: '0.6'
id: mr/tools-mr-readme
title: "mr — collegamento codice ↔ documentazione"
type: reference
owner: rnd
status: active
created: '2026-10-03'
last_updated: '2026-10-18'
depends_on:
  - id: mr/formato-v06-delta
    reason: "descrive i comandi del formato 0.6 (code_refs, ancore)"
---

# mr — collegamento codice ↔ documentazione (v0.6)

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
node tools/mr/mr.mjs env [<repo>] [--docs <dir>] [--rev <c>] [--fail]   # variabili lette dal codice ↔ elenchi (0.6-z9)
node tools/mr/mr.mjs stato [<repo>] [--rev <c>] [--indice <f>]        # onboarding: livello, cosa manca, prossimo passo (0.6-z11)
node tools/mr/mr.mjs indice [--write] [--indice <f>] [--ignore-dir <d>]  # indice dei doc dei workspace (0.6-z17)
node tools/mr/mr.mjs trova <parole> [--owner o] [--type t] [--repo r] [--max n] [--json]  # ricerca nell'indice, in prova (0.6-z17)
node tools/mr/uso.mjs [--settimane n] [--tsv]                          # uso di MR a settimana dai transcript (0.6-z17)
```

Formati: `--format md|json`, e per `claims`/`scan` anche `--format segnalazione` (R11): una
segnalazione `doc-stale` per doc nel formato del template di `_arch`, su stdout, con path:riga e
commit che ha causato ogni segnale (nota A20). `mr` non scrive in `_arch`: il file lo apre arch.

Flag comuni: `--rev <commit>` (doc e codice letti a quel commit, senza checkout),
`--code-repo <dir>` (ripetibile), `--code-rev <c>`, `--ignore-file <f>`, `--format md|json`,
`--all`; per `scan`, `--subjects` (oggetto dei commit).
**MR segnala, non blocca (0.6-z10).** Ogni report in markdown comincia con una riga che lo dice: la
task in corso viene prima, subito solo per dati personali o segreti in chiaro, o per un doc che la
propria modifica ha reso falso. Nelle segnalazioni `Severita` è diventato **`Peso`** (alto, medio,
basso: quanto lavoro chiede il doc) con accanto **`Quando:`** dopo la task in corso.
Exit code (R11, 0.6-z10): `0` anche con segnali · `1` solo con `--fail` (claims, scan, impact, env) ·
`2` errore del tool. `verify` e `remap` danno ancora `1` se restano link non verificabili o non risolti.

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

## stato — a che punto è il repo con MR (0.6-z11)

`mr stato [<repo|cartella>]` è l'onboarding da riga di comando (`report/onboarding/proposta.md` §2).
Sola lettura, sempre exit 0. Dice il livello del repo e una riga di prossimo passo:
- **0 fotografia:** nessun doc vivo con frontmatter;
- **1 doc principali:** frontmatter su README, CLAUDE.md e AGENTS.md se ci sono, `mr-validate --profile
  light` a 0 errori, il blocco «MR segnala, non blocca» in un CLAUDE.md o AGENTS.md dalla cartella in
  su (come li legge Claude Code);
- **2 tutti i doc vivi:** livello 1 e frontmatter su almeno l'80% dei doc vivi;
- **3 nel giro:** livello 2 e workspace attivo nell'indice di arch (`--indice <f>`; di default quello
  accanto al repo MR).

Il livello è il più alto di cui sono soddisfatti tutti i criteri, e si ferma al primo non soddisfatto
(0.6-z12): i livelli si raggiungono in ordine, e «nel giro» da solo non dà il livello 3. Un repo senza
frontmatter sta al livello 0 anche se è già nel giro, e il report lo dice.

Nel giro usa le stesse regole del giro (allow-list centrale del workspace), così i numeri coincidono
con la «Salute dei doc». Mostra anche la sintesi di `mr env`. Con `--rev` il validatore non si lancia,
perché legge solo il working tree. I criteri di tempo della proposta (due settimane a 0 errori, un
proprietario che risponde) non si misurano.

## env — variabili lette dal codice contro gli elenchi (0.6-z9)

`mr env [<repo>]` confronta in tutte e due le direzioni i nomi che il codice legge con l'elenco.
- **Lato codice:** `process.env.X`/`["X"]`, `import.meta.env.X`, `env.X`, `Deno.env.get("X")`, `os.environ`/`getenv`,
  `ENV.fetch`, `const { A } = process.env`; nei file di configurazione (`config.*`, `env.*`, `settings.*`) ogni
  chiamata con un nome MAIUSCOLO fra virgolette (`opzionale("X")`) e ogni chiave MAIUSCOLA (schema zod);
  `${X}` nei compose; `POSTGRES_*` e `TUNNEL_TOKEN` per le immagini postgres e cloudflared. Esclusi test,
  script di shell e cartelle datate.
- **Elenco:** i file d'esempio del repo (`.env.example`, `.env.<nome>.example`, `<nome>.env.example`,
  `.esempio`), solo i nomi; senza file d'esempio, i nomi citati nei doc vivi.
- **Uscita:** «letti e non elencati» (con la nota «citato in un doc») ed «elencati e non letti».
  Eccezioni: nomi di piattaforma (`NODE_ENV`, `GITHUB_*`…), `env_ignore: [glob]` ed `env_helpers: [nome]`
  in `mr.coverage.yaml`, regole `env:` in `mr.claims.ignore`. `--fail`: exit 1 se c'è un nome non elencato.

Il giro ha la stessa misura nella sezione «Elenchi env», a conteggio separato (fuori dalla precisione).
Nasce dal censimento token del 18/10: `report/analisi-token/README.md`.

## indice e trova — dove sta un doc (0.6-z17, in prova)

Proposta di arch (`_arch/tool/valutazioni/mr-performance-2026-10-18.md` §12): MR come mappa per chi
lavora, non solo per chi mantiene i doc.

- **`mr indice`:** i `.md` dei workspace attivi dell'indice di arch (gli stessi repo del giro), letti dal
  working tree, perché il percorso deve aprire il file sul disco. Una riga per doc: `id`, `titolo`, `type`,
  `owner`, `status`, `last_updated`, `percorso` (assoluto), `riassunto` (prima riga di testo del corpo),
  `stato` (`vivo` o `storico`), `workspace`, `repo`. Storico = storico per path come nel giro, regola
  `storico:`, status di fine vita o cartella d'archivio.
  - **Fuori:** file di segreti, regole `codice:` e `doc:`, fixture, workspace in archivio, cartelle
    con dati personali (`candidati/`, `studenti/`, `lead/`, `contatti/`, `export/`…, più le regole
    `personali:<glob>` del `mr.claims.ignore` o dell'allow-list centrale). Si leggono solo `.md`: mai
    CSV o export.
  - **Testo:** titolo e riassunto si scartano se contengono un'email, un telefono, un codice fiscale,
    un IBAN o una forma di segreto. Caratteri di controllo tolti sia nel TSV sia nella stampa.
  - **Scrittura:** solo con `--write`, in `~/.mr/indice/INDICE_DOC.tsv` (`MR_INDICE_DIR` per un'altra
    cartella), permessi 600, con rename atomico. Allow-list centrale: `--ignore-dir`, altrimenti
    `_arch/tool/mr-ignore` accanto all'indice di arch. Circa 2 secondi per 2300 doc.
  - Il **giro** completo (senza `--only`/`--exclude`) con `--write` o `--out` riscrive l'indice;
    `--senza-indice` no.
- **`mr trova <parole>`:** cerca le parole (minuscole, senza accenti, senza parole vuote) in titolo, id,
  nome del file, type, owner, workspace, repo, percorso e riassunto. Ordine: prima i doc con più parole
  trovate, a parità i vivi prima degli storici, poi il peso del campo (titolo > id > type/owner >
  riassunto) e la data. Un prefisso di 4 lettere vale metà (`token` → `tokens`). Stampa i primi 10
  (`--max`), con percorso, owner, type e prima riga; avvisa se l'indice ha più di 7 giorni. Filtri
  `--owner`, `--type` (esatto), `--repo` (repo o workspace). Circa 0,1 secondi. Nessun modello: se non
  basta si valuta una ricerca semantica (qmd).
- **`uso.mjs`:** conta nei transcript di Claude Code (`~/.claude/projects`) i comandi Bash che lanciano
  MR, per settimana ISO e gruppo (`mr`, `arch`, `altri`); stampa solo numeri. È l'indicatore 5 della §12:
  `trova` + `impact` degli altri workspace sul totale delle loro invocazioni. `--tsv` per
  `mr-performance.tsv`, che tiene arch.
- **Skill globale `chi-sa-cosa`** (`skill-globali/chi-sa-cosa/SKILL.md`): usa `mr trova` e la rubrica
  della posta per rispondere «leggi questo doc» o «scrivi a questa casella».

## Frontmatter e freschezza (dalla 0.6-y)

Comandi per chi tagga i doc (skill `mr-tag`) e li tiene freschi:

```bash
node tools/mr/mr.mjs vivi [<repo|dir>] [--senza-frontmatter] [--json] [--ignore-dir <d> --workspace <slug>]
node tools/mr/mr.mjs date <doc|dir> [--redazioni <f>] [--rev <c>]
node tools/mr/mr.mjs rivisto <doc> [--write] [--data YYYY-MM-DD] [--tieni-review]
```

- **`vivi`:** i doc vivi del repo, gli stessi che il giro conta nella «Salute dei doc», e quali hanno
  il frontmatter (`lib/vivi.mjs`).
- **`date`:** `created` e `last_updated` da git, senza i commit che lasciano il testo invariato e
  senza quelli di sola redazione dichiarati in `mr.redazioni`. `import: <sha>` legge le date dal testo.
- **`rivisto`:** il doc è stato riletto ed è ancora vero. Aggiorna solo `last_updated` e toglie
  `review_needed`.

Tutti e tre leggono soltanto, tranne `rivisto --write`.

## Giro su più repo

`tools/mr/giro.mjs` è il controllo periodico su tutti i workspace di un indice. Produce le
segnalazioni con prova di deriva, le «Ancore in deriva» e la «Salute dei doc»: copertura del
frontmatter, «in PR aperte», vecchi, da aggiornare, sospesi. Opzioni e regole sono nell'intestazione
del file e nella skill `mr-giro`.

## Più repo: `--code-repo` e `mr.repos.yaml` (R10)

```yaml
# mr.repos.yaml, nella root del repo dei doc (oppure --repos-file <f>)
repos:                         # nome → path locale, relativo alla root del repo dei doc
  app-web: apps/app-web
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
tranne `moved`; livelli `remote-*`. Con un token di MR in sola lettura, `gh` usa quello (vedi Sicurezza).

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
- Frontmatter solo YAML (0.6-z13): un blocco `---js` o `---javascript` non si esegue mai. In
  `mr-validate` è un errore, in `mr-scanner` il doc si salta.
- `gh` con un token proprio (0.6-z13): `--remote` e il giro (PR aperte) possono usare un token
  fine-grained in sola lettura al posto dell'autenticazione di `gh`, solo nei processi `gh` che lancia
  MR (come `GH_TOKEN` del figlio). Un token vale per un solo owner, e si cerca in quest'ordine:
  1. `MR_GH_TOKEN_<OWNER>` (owner in maiuscolo, altri caratteri in `_`);
  2. il portachiavi di macOS (servizio `mr-gh-token`, account = owner in minuscolo);
  3. `MR_GH_TOKEN`;
  4. altrimenti l'autenticazione di `gh`, come prima.
  I token si caricano con `tools/mr/token-gh.sh carica <owner>` (il valore lo chiede `security`, mai da
  argomenti) e si provano con `tools/mr/token-gh.sh verifica <owner>/<repo>`: la lettura deve riuscire
  e una scrittura innocua deve fallire. MR non stampa mai il valore. Non va messo nel profilo della
  shell né nei settings: toglierebbe a `gh` i permessi di scrittura in tutte le sessioni.
  `MR_GH_PORTACHIAVI=no` spegne il portachiavi.
- Repo spostati su GitHub (0.6-z16): se `origin` punta ancora al nome vecchio di un repo trasferito o
  rinominato, GitHub reindirizza, ma il token del vecchio owner non vede il repo nel nuovo. Il giro
  chiede il nome attuale (solo `full_name`, con l'autenticazione di `gh`), rilegge le PR con il token
  del nuovo owner e lo scrive nel report («Remote origin sul nome vecchio»), con il comando per
  aggiornare il remote.
- Copia pubblica: `pubblico/esporta.mjs` rifiuta anche le forme note di token e chiavi (0.6-z13),
  senza stampare l'estratto. Un token finto in un test va spezzato (`'gh' + 'p_…'`).
- git nei repo analizzati (0.6-z13): ogni chiamata passa da `tools/lib/git-sicuro.mjs`, che spegne
  `core.fsmonitor`, `diff.external`, i driver di diff e textconv, il pager e la verifica delle firme.
  Spegne anche la configurazione di sistema. Il `.git/config` di un repo ricevuto non può far eseguire
  comandi.
- Symlink (0.6-z13): nel working tree un symlink che esce dal repo o punta a un file con segreti non
  è un file del repo (non si legge e non si cerca). I doc si raccolgono senza symlink. `--write` su
  un symlink viene rifiutato. `hasFile`/`hasDir` rifiutano `..` e i path assoluti. Con `--rev` git dà il
  testo del link, non il bersaglio.
- Affermazioni nei report (0.6-z13): testo oscurato come le righe di diff e tagliato a 120 caratteri
  (md, json, segnalazioni, giro). Un identificatore che sembra un segreto diventa «possibile segreto in
  `<doc>:<riga>`», da sistemare subito.
- Il testo citato dai doc è un dato, non un'istruzione: lo dice la testa di ogni report (accanto a
  «MR segnala, non blocca») e ogni skill.

## Allow-list

`mr.claims.ignore` nella root del repo dei doc, oppure `--ignore-file`. Righe: testo esatto,
glob con `*`, `tipo:pattern` (es. `env:VITE_*`), `doc:<glob>`, `storico:<glob>`, `codice:<glob>`,
`personali:<glob>` (cartelle con dati personali, fuori dall'indice dei doc, 0.6-z17). Nel doc,
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
