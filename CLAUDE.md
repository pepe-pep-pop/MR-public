# CLAUDE.md — MR (Metadati Relazionali)

Istruzioni per Claude Code, e per chiunque, quando si lavora su questo repo.

## Prima di tutto

Leggi [`matrix.md`](matrix.md): schema, vocabolario, regole e istruzioni operative del formato. La
guida d'uso è [`docs/guida.md`](docs/guida.md).

## Interpretazione dei file

I `.md` con frontmatter YAML tra `---` e `mr_version` usano il formato MR. Ogni file ha un `id`
univoco (`namespace/slug`) e può dichiarare relazioni con `depends_on`, `superseded_by` e
`propagate_staleness_to`. Nel profilo light (matrix.md §1.8) `required_by` non si scrive: lo calcola
lo scanner.

## Strumenti

Nessuno strumento chiama API LLM esterne, e nessuno scrive su disco senza `--write`. Esclusioni di
default: `node_modules`, `.git`, `dist`, `build`, cartelle nascoste, repo annidati, `.gitignore`.

```bash
npm ci --prefix tools/mr-validate && npm ci --prefix tools/mr-scanner && npm ci --prefix tools/mr
python3 -m venv .venv && .venv/bin/pip install -r tools/mr-kg/requirements.txt -r tools/mr/requirements-test.txt

node tools/mr-validate/mr-validate.mjs [--profile light] <path>
node tools/mr-scanner/mr-scanner.mjs <path> [--write [--profile light]]
node tools/mr/mr.mjs claims|scan|impact|verify|suggest-links|remap|coverage|rivisto|date …
node tools/mr/giro.mjs --indice <file> [--out <file>]
.venv/bin/python tools/mr-kg/build_kg.py --dir <path> --write --output /tmp/mr-kg.ttl
```

Skill di Claude Code (`.claude/skills/`):
- `mr-tag`: frontmatter proposto e scritto con l'ok;
- `mr-link`: ancore doc → codice;
- `mr-drift-review`: derive rilette e verificate;
- `mr-giro`: controllo periodico su più repo;
- `mr-query`: domande sul grafo.

## Test

```bash
npm test --prefix tools/mr-validate
npm test --prefix tools/mr-scanner
PATH="$PWD/.venv/bin:$PATH" npm test --prefix tools/mr   # serve git-filter-repo (requirements-test.txt)
.venv/bin/python -m unittest discover -s tools/mr-kg/tests
bash tools/test-no-write.sh
```

La CI (`.github/workflows/test.yml`) esegue gli stessi comandi.

## Regole

- **Sicurezza:**
  - nessuna API LLM esterna, nessuna chiave nei file, nessun server in ascolto;
  - non leggere `.env*` (tranne `.env.example`, solo per i nomi delle variabili), `*.pem`, `*.key`,
    né file con `SECRET` o `SEGRETI` nel nome.
- **Dati:** test, fixture ed esempi senza dati personali né segreti; nomi finti (`acme/app-web`,
  `nome.cognome@example.com`).
- **Git:**
  - un branch e una PR per compito;
  - niente force push e niente riscrittura della storia;
  - commit in italiano, nel formato `tipo(ambito) descrizione`.
- **Lavoro:**
  - ogni «funziona» va accompagnato dal comando e dal suo output; un test non eseguito si dichiara;
  - ogni regola nuova ha un test che fallisce sul codice di prima.
- **Questo repo è una copia pubblica, aggiornata in automatico da un repo di sviluppo privato.** Le
  PR si portano lì (vedi `CONTRIBUTING.md`).
