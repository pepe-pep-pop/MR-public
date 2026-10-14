---
name: mr-link
description: Collega un doc al codice che descrive. Fa proporre a `mr suggest-links` le ancore (alla funzione per default, al file intero solo se il simbolo non si risolve), le fa rivedere a te sezione per sezione, mostra il diff all'utente e le applica con --write solo dopo il suo ok; poi le verifica con mr-drift-review. Usala quando l'utente chiede di "collegare i doc al codice", "mettere le ancore", "adottare MR v0.6" su un doc o una cartella. Nessuna API esterna.
---

# mr-link — collegare un doc al codice

Obiettivo (PRD R8): adottare i link doc → codice su un repo esistente in un'ora, non in una giornata.

## Regole

- **Ancoraggio alla funzione per default** (nota A12). Il file intero solo se nessun simbolo
  della sezione si risolve; in quel caso l'ancora porta `livello=file`, e nel diff che mostri
  all'utente lo dici esplicitamente («file intero: …»).
- Mai `--write` senza l'ok dell'utente sul diff di quel doc.
- Niente `verified` in questa fase: collegare non è verificare. La verifica la fa `mr-drift-review`.
- Niente link nei doc storici; niente doc di altri workspace senza richiesta.

## Procedura

1. **Repo giusti.** Se il doc descrive codice di un altro repo, serve una mappa:
   `mr.repos.yaml` nella root del repo del doc, oppure `--repos-file <f>` per un pilota in sola
   lettura, oppure `--code-repo <dir>`. Senza mappa i claim si cercano solo nel repo del doc.

2. **Proposta deterministica:**

   ```bash
   node tools/mr/mr.mjs suggest-links <doc> [--repos-file <f> | --code-repo <dir>]
   ```

   Per ogni proposta: numero (colonna #), sezione, link proposto, livello (funzione / ⚠️ file
   intero), perché, da quale claim. Il numero serve a `--only` al passo 5.

3. **Revisione tua, sezione per sezione.** Leggi la sezione e decidi per ogni proposta:
   - **tieni**: la sezione descrive davvero quel codice;
   - **scarta**: il nome è citato di passaggio, o è un esempio;
   - **migliora**: un file intero ha un simbolo più preciso che la sezione descrive anche se non
     lo nomina. Proponi l'ancora con quel `symbol`, dopo aver controllato che si risolva
     (`mr scan` lo dirà: un simbolo che non si risolve dà `missing`).

   Aggiungi a mano solo i link che il tool non può vedere e che sono evidenti dal testo.

4. **Mostra all'utente il diff finale** (le righe `<!-- mr:code … -->` che verranno inserite
   sotto i titoli). Per ogni ancora al file intero scrivi accanto «file intero: <motivo>».

5. **Dopo l'ok:**
   - le proposte tenute così come sono: `node tools/mr/mr.mjs suggest-links <doc> --write --only <n,…>`
     con i numeri dell'anteprima e gli stessi argomenti (senza `--only` le scrive tutte);
   - le ancore migliorate o aggiunte a mano: con Edit, sotto il titolo della sezione.

   Le ancore non cambiano `_content_hash` del doc.

6. **Controllo:**

   ```bash
   node tools/mr/mr.mjs scan <doc>      # i link nuovi risultano unverified
   ```

   Poi passa a `mr-drift-review` per verificare le sezioni (`mr verify … --write` dopo la rilettura).

## Cosa non fare

- Non ancorare al file intero per comodità quando un simbolo si risolve.
- Non collegare tutto quello che compare: un link costa una verifica ogni volta che il codice
  cambia. Meglio pochi link, precisi, sulle sezioni che contano.
