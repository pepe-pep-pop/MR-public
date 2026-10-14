---
name: mr-tag
description: Propone e, solo dopo un ok esplicito, scrive il frontmatter MR (profilo light) in testa a un documento markdown, poi lo valida con mr-validate. Usala quando l'utente chiede di "taggare", "mettere sotto MR", "aggiungere al sistema MR" uno o più doc .md. Sostituisce mr_tag.py della v0.5 (che usava DeepSeek): qui l'analisi la fai tu, nessuna API esterna.
---

# mr-tag — frontmatter MR proposto da Claude, scritto solo con ok

Sei tu a leggere il doc e a proporre il frontmatter. Nessuna chiamata a servizi esterni,
nessuno script con LLM dentro.

## Regole

- **Un doc alla volta**, o un lotto piccolo con un diff per ogni file. Mai scrivere senza ok.
- **Profilo light di default** (matrix.md §1.8). Il profilo full (`ai_summary`, `ai_keywords`,
  `related_to`, `priority`…) solo se l'utente lo chiede esplicitamente.
- **Mai `required_by`** nel file: si calcola dai `depends_on` degli altri doc (scanner, mr-status.json).
- **Mai scrivere nei file di altri doc** per "simmetria": tocchi solo il doc che stai taggando.
- Non leggere né taggare: `.env*` (eccetto `.env.example`), `*.pem`, `*.key`, file con
  `SECRET`/`SEGRETI` nel nome, nulla dentro `node_modules`, `dist`, `build`, cartelle nascoste,
  repo annidati, file ignorati da git.
- Se il doc sta in un repo che non è quello su cui l'utente ti ha chiesto di lavorare, fermati
  e chiedi.

## Procedura

1. **Contesto.** Trova il `matrix.md` del progetto (risalendo fino alla root del repo, mai oltre).
   Leggi il registry (§4.1, tra i marker `MR-REGISTRY-START/END`) per gli id esistenti e la
   convenzione di namespace. Se non c'è un `matrix.md`, chiedi quale namespace usare.

2. **Leggi il doc** per intero. Se ha già un frontmatter:
   - frontmatter MR (`mr_version`) → stai modificando, non taggando: segui matrix.md §5.4;
   - frontmatter di altro tipo (Astro, Jekyll, Front Matter CMS, `pdf_options` di md-to-pdf…) →
     fermati e chiedi: non mescolare i due schemi senza decisione dell'utente. Se l'utente dice di
     sì, aggiungi le chiavi MR **senza toccare le sue**: nel profilo light ogni chiave non MR è un
     warning «chiave di un altro strumento», non un errore (dalla 0.6-z1).

3. **Ricava le date da git, non a occhio:** `node tools/mr/mr.mjs date <file|cartella>` (sola
   lettura) dà `created` e `last_updated` per ogni doc.
   - `created` è il commit che ha aggiunto il file, seguendo i rename.
   - `last_updated` è l'ultimo commit che **cambia il contenuto**. Non contano:
     - i commit che lasciano il testo invariato: solo frontmatter (il tag stesso, `rivisto`, uno
       status) o solo spostamento del file;
     - i **commit di sola redazione** (dati personali tolti, segreti oscurati), dichiarati nel file
       `mr.redazioni` alla radice del repo: uno sha per riga (almeno 7 caratteri) oppure
       `messaggio: <testo dell'oggetto>`, con un commento `# perché`. Esempio: in app-web il commit di
       redazione del 03/10 fa sembrare aggiornati quel giorno 127 doc.
   - Se un commit di redazione non è nel file, aggiungilo prima di taggare, e dillo nel report del
     lotto con lo sha.
   - **Repo nato da un import** (doc scritti prima e copiati in un solo commit, es. portale-b il
     03/09): riga `import: <sha>` in `mr.redazioni`. Per i doc nati lì `mr date` legge la data
     dichiarata nelle prime righe del testo: «Data:», «Scritto:», «Generato:» danno `created`,
     «Last updated:» o «Aggiornato:» danno `last_updated` (colonna «fonte»). Se il testo non ha una
     data, la data è «sconosciuta»: scegli tu, leggendo il doc, e dillo nel report del lotto. Un commit che ha cambiato davvero il testo (anche solo in parte) non è di
     redazione: se il doc è rimasto indietro, usa `review_needed` (vedi «Freschezza»).
   - `last_updated` è l'ultima modifica, non l'ultima lettura: un doc appena taggato può risultare
     «vecchio» nel giro; se lo hai riletto ed è vero, `mr rivisto <file> --write`.
   - Fuori da git, o file mai committato: data odierna, e dillo nel diff.

4. **Proponi il frontmatter** (profilo light):

   ```yaml
   ---
   mr_version: '0.5'
   id: <namespace>/<slug>        # ^[a-z0-9][a-z0-9/_-]*[a-z0-9]$, max 80, niente punti
   title: "<dal titolo # del doc>"   # SEMPRE tra virgolette doppie
   type: <uno dei tipi di matrix.md §1.1>
   owner: <chi mantiene il doc: chiedilo se non è evidente>
   status: active                 # draft | deprecated | superseded | paused se il testo lo dice
   created: 'YYYY-MM-DD'
   last_updated: 'YYYY-MM-DD'
   depends_on:                    # SOLO con evidenza nel testo, verso id ESISTENTI nel registry
     - id: <id>
       reason: <perché, in una riga>
   superseded_by: <id>            # obbligatorio se status: superseded
   review_needed: <motivo breve>  # opzionale: valido ma con parti non più vere (vedi «Freschezza»)
   staleness_threshold: 90d       # opzionale: solo se il default del tipo (matrix.md §1.1) non va bene
   ---
   ```

   - **`title` sempre tra virgolette doppie**, anche se sembra non servire: un titolo con i due
     punti (`Runbook — Bivio pool quiz: opzione A`) senza virgolette rompe il frontmatter, e il doc
     sparisce da validatore, scanner e giro (caso portale-b, 0.6-z3). Le virgolette doppie dentro
     il titolo si scrivono `\"`. Vale anche per `review_needed` e per ogni valore con `: ` o `#`.
   - L'`id` non deve collidere con il registry. Se collide, proponi una variante.
   - **Slug dal path, non solo dal nome del file**, quando il nome si ripete. In `_arch` ci sono
     più di 20 `README.md`: `arch/readme` per la radice, `arch/segnalazioni/readme`,
     `arch/tool/readme`… e per le cartelle con una serie (`hof/`) l'id porta la cartella:
     `arch/hof/hof-arch-x12`. Niente punti né maiuscole (`x12`, non `X12`).
   - **Catene di handoff** (`hof`): il più recente `active`, gli altri `superseded` con
     `superseded_by` verso il successivo **che esiste** (se un anello manca, come `X10`, punta
     al primo successivo esistente e dillo). Un handoff verso un altro agente il cui lavoro è
     chiuso, senza successore: `deprecated`.
   - `depends_on` verso un doc `superseded` (es. «prima read: l'hof precedente»): aggiungi
     `strength: weak`, altrimenti `mr-validate` dà errore.
   - Lo stato di un doc lo decide chi lo possiede: per gli `hof` e per le roadmap chiuse
     proponi, e fai confermare.
   - `depends_on` verso un id che non esiste: non inventarlo; segnala il riferimento e chiedi.
   - `propagate_staleness_to` solo se l'utente lo indica o il doc lo dice in modo esplicito
     ("se cambia questo, aggiornare quello").

5. **Mostra il diff** (frontmatter da inserire in testa, nient'altro cambia) e **aspetta l'ok**.

6. **Scrivi** con Edit: il frontmatter va in testa, prima di qualunque contenuto.

7. **Valida:**

   ```bash
   node tools/mr-validate/mr-validate.mjs --profile light <file-taggato> <cartella-del-progetto>
   ```

   (il path di `mr-validate.mjs` è quello del repo MR). Riporta errori e warning con il
   comando e l'output; se ci sono errori, proponi la correzione e ripeti dal punto 5. Controlla
   anche la riga «File con frontmatter non leggibile (saltati)»: deve essere 0 per i doc del lotto.

8. **Registry.** Mostra cosa cambierebbe con lo scanner in sola lettura:

   ```bash
   node tools/mr-scanner/mr-scanner.mjs <cartella-del-progetto>
   ```

   Solo con un secondo ok: `--write --profile light` (riscrive il registry di `matrix.md` e
   `mr-status.json`, non tocca i doc).

## Freschezza: quando un doc risulta vecchio (regola del 13/10)

Il giro, nella sezione «Salute dei doc», segnala i doc il cui `last_updated` supera la soglia del
loro tipo. Per ognuno:

1. **rileggi il doc** contro il codice e lo stato di oggi;
2. **se è ancora vero**: `node tools/mr/mr.mjs rivisto <doc> --write`. Aggiorna solo `last_updated`
   alla data di oggi e toglie `review_needed`, se c'è (`--tieni-review` per lasciarlo). Senza
   `--write` mostra il cambio e non scrive, e rifiuta un doc senza frontmatter MR;
3. **se non è più vero**: correggi il testo. `last_updated` si aggiorna nello stesso commit, a mano o
   con `rivisto --write` dopo la correzione.
   - **Se la correzione non si può fare adesso** (serve verificare sul codice, è lunga, la decide
     un altro): lascia `status: active` e aggiungi `review_needed: "<motivo breve>"`, al più 200
     caratteri e senza dati personali. Esempio: `review_needed: "elenco fermo a 52 funzioni, oggi
     93"`. Il giro lo conta e lo elenca in «Salute dei doc». Dopo la correzione, `rivisto --write`
     lo toglie;
4. **se il doc è chiuso**: non va più rinfrescato. Gli stati ammessi sono solo `active`, `draft`,
   `deprecated`, `superseded` e `paused`:
   - sostituito da un altro doc (handoff superato, nuova versione): `superseded` con `superseded_by`;
   - lavoro chiuso senza successore (piano finito, spike, handoff verso un lavoro chiuso): `deprecated`;
   - fotografia datata ancora valida (analisi, ricerca, specifica immutabile): resta `active` con
     `staleness_threshold: never`.

Mai `rivisto --write` senza aver riletto il doc: è come `verify --write` per le ancore.

## Lotti non presidiati (`claude -p`)

Per un lotto grande si può lanciare Claude Code in modalità headless, che usa l'abbonamento e
non una API key. **Solo per produrre proposte**, mai per scrivere: l'output va rivisto da una
persona prima di applicarlo con questa skill.

```bash
claude -p "Usa la skill mr-tag in sola proposta (non scrivere nessun file) per ogni .md in docs/: per ciascuno stampa path e frontmatter proposto."
```

Non è il default: per pochi doc si lavora in sessione, con il diff davanti.

## Ollama

Opzionale e mai automatico: nessuno script MR lo chiama. Se un giorno servisse un modello
locale per lotti offline, va aggiunto come scelta esplicita, mai come fallback verso il cloud.
