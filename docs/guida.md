# Guida di MR

Come adottare MR in un repo e usarlo ogni giorno. Il formato completo è in [`matrix.md`](../matrix.md);
il dettaglio dei comandi è in [`tools/mr/README.md`](../tools/mr/README.md).

## 1. Le idee

- **Il frontmatter dice cosa è un doc.** Tipo, stato, proprietario, date, relazioni con altri doc. Il
  **profilo light** (matrix.md §1.8) è il minimo:
  - obbligatori: `mr_version`, `id`, `title`, `type`, `owner`, `status`, `created`, `last_updated`;
  - opzionali: `depends_on`, `superseded_by`, `staleness_threshold`, `code_refs`, `review_needed`.
- **Le relazioni inverse si calcolano.** `required_by` non si scrive a mano: lo scanner lo ricava dai
  `depends_on` degli altri doc e lo mette in `mr-status.json`.
- **Un doc invecchia.** Ogni tipo ha una soglia di freschezza (per esempio 30 giorni per `reference`,
  60 per `how-to`). Oltre la soglia il doc va riletto.
- **Un doc afferma cose sul codice.** Path, comandi, variabili d'ambiente, endpoint, tabelle, nomi di
  funzione. `mr claims` le cerca nel codice. Una sezione si può anche **ancorare** a una funzione con
  `<!-- mr:code path=… symbol=… verified=… -->`: quando la funzione cambia, l'ancora va in deriva.
- **Il giudizio resta a una persona** (o a un agente con il suo ok). Gli strumenti sono deterministici
  e non scrivono senza `--write`. Le skill di Claude Code propongono, chi le usa decide.

## 2. Adottare MR in un repo

1. **Le date.** `node tools/mr/mr.mjs date <cartella>` dà `created` e `last_updated` da git.
   - `last_updated` è l'ultimo commit che **cambia il testo**: non contano i commit che toccano solo il
     frontmatter o spostano il file.
   - **Commit di sola redazione** (per esempio dati personali tolti da molti doc insieme): si
     dichiarano nel file `mr.redazioni` alla radice del repo, uno sha per riga o
     `messaggio: <testo dell'oggetto>`, con un commento `# perché`.
   - **Repo nato da un import** (doc scritti prima e copiati in un solo commit): la riga
     `import: <sha>` fa leggere le date dal testo («Data:», «Scritto:», «Last updated:»).
2. **Quali doc.** `node tools/mr/mr.mjs vivi <repo> --senza-frontmatter` elenca i doc vivi senza
   frontmatter: gli stessi che il controllo periodico conta. Restano fuori gli storici per path
   (handoff, piani, report, cartelle datate), le cartelle nascoste e i doc esclusi
   nell'allow-list.
3. **Il frontmatter.** Con la skill `mr-tag` di Claude Code, un lotto piccolo alla volta: la skill
   propone, tu confermi, lei scrive e valida. Il `title` va sempre tra virgolette doppie.
   - **Catene di handoff:** il più recente è `active`, gli altri sono `superseded`, con `superseded_by`
     verso il successivo.
   - **Chiavi di altri strumenti** nello stesso blocco (`layout`, `pdf_options`…): restano,
     `mr-validate` dà solo un warning.
4. **La validazione:**

   ```bash
   node tools/mr-validate/mr-validate.mjs --profile light <cartella>
   ```

   Deve dare 0 errori e «0 saltati». Un frontmatter che il parser YAML non legge è un errore, con la
   riga.
5. **Il registro:** `node tools/mr-scanner/mr-scanner.mjs <cartella> --write --profile light`
   aggiorna la tabella di `matrix.md` (tra i marker `MR-REGISTRY-START/END`) e `mr-status.json`.
   Non tocca i doc.

## 3. Controllare i doc contro il codice

```bash
node tools/mr/mr.mjs claims docs/                     # affermazioni: found · not_found · ambiguous · external
node tools/mr/mr.mjs scan docs/                       # in più, la deriva delle ancore e dei code_refs
node tools/mr/mr.mjs claims docs/ --code-repo ../api  # il codice sta in un altro repo
```

- **Un `not_found` non è per forza un errore.** Il nome può vivere in un altro sistema, o il doc
  racconta una rimozione. MR scarta da solo le righe al passato («tolto `x`», «sostituito da…»), le
  righe di esempio e i doc storici (status `superseded`/`deprecated`, cartelle d'archivio).
- **Eccezioni** in `mr.claims.ignore`, alla radice del repo dei doc. Una regola per riga:
  - testo esatto, o glob con `*`;
  - `tipo:pattern` (per esempio `env:VITE_*`);
  - `doc:<glob>` (doc esclusi) e `storico:<glob>` (doc solo informativi);
  - `codice:<glob>` (cartelle che non sono codice del repo, per esempio una copia di riferimento di
    un altro progetto).

  Nel doc, `<!-- mr:ignore-claim -->` esclude una riga.
- **Più repo di codice:** `mr.repos.yaml` dice quali repo valgono per quali doc; `esterni:` elenca i
  repo dove un nome può vivere legittimamente (il claim diventa `external`).

**Ancorare una sezione a una funzione** (skill `mr-link`):

```bash
node tools/mr/mr.mjs suggest-links docs/guida.md            # anteprima numerata
node tools/mr/mr.mjs suggest-links docs/guida.md --write --only 1,4
node tools/mr/mr.mjs verify docs/guida.md --write           # verified al commit corrente
```

Quando un'ancora va in deriva, la skill `mr-drift-review` rilegge la sezione e il diff, e propone di
correggere il doc oppure di confermarlo con `verify --write`.

## 4. Dopo una modifica al codice

```bash
node tools/mr/mr.mjs impact --staged          # prima del commit: quali doc citano o ancorano ciò che cambi
node tools/mr/mr.mjs impact HEAD~3..HEAD      # su un intervallo
node tools/mr/mr.mjs impact --staged --fail   # per un hook: exit 1 solo se è toccata un'ancora
```

`impact` guarda i token cambiati, non le righe: un nome conta se cambia lui. Le modifiche al solo
numero di versione in `package.json` e nei lockfile non contano.

## 5. Freschezza

- **Il doc risulta vecchio e l'hai riletto: è ancora vero.** Allora
  `node tools/mr/mr.mjs rivisto <doc> --write`, che aggiorna solo `last_updated` e toglie
  `review_needed`.
- **Non è più vero.** Correggilo. Se non puoi farlo subito, scrivi
  `review_needed: "<motivo breve>"`: il doc resta `active` e viene contato come «da aggiornare».
- **È chiuso.** Gli stati ammessi sono solo `active`, `draft`, `deprecated`, `superseded` e `paused`:
  - `superseded` con `superseded_by`, se un altro doc lo sostituisce;
  - `deprecated`, se non ha un successore;
  - una fotografia datata ancora valida resta `active`, con `staleness_threshold: never`.

Mai `rivisto --write` senza aver riletto il doc.

## 6. Più repo: il giro

`tools/mr/giro.mjs` controlla molti repo insieme e produce un unico report: le sole affermazioni con
prova di deriva, le ancore in deriva e la «salute dei doc» (copertura del frontmatter, doc vecchi o
da aggiornare). Legge un **indice** in markdown, una riga per workspace:

```markdown
| Slug | Gruppo | Path | Nota |
|---|---|---|---|
| `app-web` | software | `/home/utente/lavoro/app-web` | — |
| `vecchio` | archivio | `/home/utente/lavoro/vecchio` | non letto |
```

```bash
node tools/mr/giro.mjs --indice indice.md --out giro.md   # sola lettura dei repo, su origin/<default>
node tools/mr/giro.mjs --precisione --file giro.md        # dopo aver compilato la colonna «esito»
```

Nelle skill, **arch** è chi coordina il giro (una persona o un agente): lancia il giro, compila
la colonna «esito» e gira le segnalazioni a chi mantiene ogni repo.

Ogni repo è letto alla versione di `origin/<branch di default>`, senza checkout. I doc toccati da una
PR aperta risultano «già in correzione» (serve `gh`; `--senza-pr` per farne a meno).

## 7. Knowledge graph

`tools/mr-kg` costruisce un grafo RDF deterministico dai frontmatter e lo interroga in SPARQL. La
skill `mr-query` traduce le domande («cosa dipende da X?», «cosa leggo per primo?») in query.

```bash
.venv/bin/python tools/mr-kg/build_kg.py --dir <cartella> --write --output /tmp/mr-kg.ttl
.venv/bin/python tools/mr-kg/kg_query.py --kg /tmp/mr-kg.ttl -q "SELECT …"
```

## 8. Cosa MR non vede

- **Cambi fuori dal repo:** nome dell'organizzazione o dell'immagine, secrets della CI, impostazioni
  di servizi esterni. Un doc che li descrive può diventare falso senza segnali: dopo un cambio del
  genere serve una verifica a mano.
- **Regole descritte solo a parole**, senza nominare file o funzioni: si collegano con un'ancora. Non
  esiste un «collegamento per concetto», perché non sarebbe deterministico.
- **Tutto ciò che il doc non nomina.** Per i punti d'ingresso del codice (funzioni, route, migration,
  CI, deploy, env) che nessun doc cita c'è `mr coverage`.
