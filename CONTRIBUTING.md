# Contribuire a MR

Grazie dell'interesse. Prima di tutto, come funziona questo repo.

## Come arrivano le modifiche

Questo repo è la **copia pubblica** di un repo di sviluppo privato e **si aggiorna da lì ogni
giorno, in automatico**. Ogni aggiornamento sovrascrive i file pubblicati. Quindi:

- una pull request **non viene mergiata qui**: il maintainer la porta nel repo di sviluppo, con
  l'attribuzione (`Co-authored-by:` nel commit), e la modifica torna in questo repo con
  l'aggiornamento successivo;
- quando la modifica è arrivata, la PR si chiude con un rimando al commit che la contiene;
- `main` è protetto: niente push diretti, solo l'aggiornamento automatico.

## Prima di aprire una PR

- **Una modifica, una PR.** Per una modifica grande, apri prima una issue e parliamone.
- **I test devono passare** (sono gli stessi della CI):

  ```bash
  npm test --prefix tools/mr-validate
  npm test --prefix tools/mr-scanner
  PATH="$PWD/.venv/bin:$PATH" npm test --prefix tools/mr
  .venv/bin/python -m unittest discover -s tools/mr-kg/tests
  bash tools/test-no-write.sh
  ```

- **Un test per ogni regola nuova**, e il test deve fallire sul codice di prima.
- **Le regole del progetto** (le trovi anche in [`CLAUDE.md`](CLAUDE.md)):
  - nessuno strumento scrive su disco senza `--write`;
  - nessuna chiamata a API LLM o a servizi esterni (l'unica rete ammessa è `scan --remote`, in sola
    lettura, tramite `gh api`);
  - nessun server in ascolto;
  - dipendenze nuove solo se indispensabili, fissate nei lockfile.
- **Niente dati personali o segreti** nei test, nei fixture e negli esempi: usa nomi finti
  (`acme/app-web`, `nome.cognome@example.com`).
- **Lingua:** codice, commenti, messaggi e documentazione sono in italiano. Le issue in inglese
  vanno benissimo.
- **Messaggi di commit:** `tipo(ambito) descrizione`, per esempio `fix(mr) claims: …` o
  `docs(guida) …`.

## Licenza dei contributi

Inviando un contributo accetti che sia distribuito con la licenza del progetto,
[Apache License 2.0](LICENSE) (sezione 5 della licenza).
