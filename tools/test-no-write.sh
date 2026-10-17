#!/usr/bin/env bash
# test-no-write.sh — criterio di chiusura v0.5.1: nessun tool scrive senza --write.
#
# Copia le fixture (tools/test-files, mr-validate/test-files, mr-scanner/test-files)
# in un repo git temporaneo con un commit iniziale, lancia ogni tool SENZA --write
# con la copia come cwd (così si vedono anche i file di output di default) e
# confronta `git status --porcelain` prima e dopo. Deve restare identico (vuoto).
# Ogni esecuzione deve finire con exit 0 o 1 e senza stacktrace: un crash fa fallire.
#
# Uso (dalla root del repo MR, dopo npm ci nei tool e il venv in .venv):
#   bash tools/test-no-write.sh
# Variabile PYTHON per un interprete diverso da .venv/bin/python.

set -euo pipefail

MR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-$MR_ROOT/.venv/bin/python}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

COPY="$WORK/copia"
mkdir -p "$COPY"
# nomi senza "test-files": lo scanner salta quelle cartelle nel walk
cp -R "$MR_ROOT/tools/test-files" "$COPY/fixture-validate"
cp -R "$MR_ROOT/tools/mr-validate/test-files" "$COPY/fixture-light"
cp -R "$MR_ROOT/tools/mr-scanner/test-files" "$COPY/fixture-scanner"
# un matrix.md con i marker, perché lo scanner calcoli anche il registry
cat > "$COPY/matrix.md" <<'MATRIX'
---
mr_version: '0.5'
id: test/matrix-copia
title: Matrix della copia di test
type: spec
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
---
# Matrix

<!-- MR-REGISTRY-START -->
<!-- MR-REGISTRY-END -->
MATRIX

git -C "$COPY" init -q
git -C "$COPY" add -A
git -C "$COPY" -c user.name=test -c user.email=test@example.invalid commit -q -m "fixture"

BEFORE="$(git -C "$COPY" status --porcelain --untracked-files=all)"

FAILED_RUNS=0
LOG="$WORK/run.log"

# Esegue un tool con la copia come cwd. Ammessi solo exit 0 o 1 (1 = errori voluti
# delle fixture); qualunque altro codice o uno stacktrace (Node o Python) fa fallire
# il test, così un tool che va in crash non passa per "non ha scritto".
run() {
  echo "▶ $*"
  local code=0
  ( cd "$COPY" && "$@" ) >"$LOG" 2>&1 || code=$?
  if [ "$code" -ne 0 ] && [ "$code" -ne 1 ]; then
    echo "  ❌ exit $code (ammessi 0 o 1)"
    sed 's/^/     /' "$LOG" | tail -20
    FAILED_RUNS=$((FAILED_RUNS + 1))
  elif grep -qE '^Traceback \(most recent call last\)|^[[:space:]]+at .+:[0-9]+:[0-9]+\)?$|^node:internal' "$LOG"; then
    echo "  ❌ stacktrace nell'output (exit $code)"
    sed 's/^/     /' "$LOG" | tail -20
    FAILED_RUNS=$((FAILED_RUNS + 1))
  else
    echo "  exit $code"
  fi
}

run node "$MR_ROOT/tools/mr-validate/mr-validate.mjs" .
run node "$MR_ROOT/tools/mr-validate/mr-validate.mjs" --profile light .
run node "$MR_ROOT/tools/mr-scanner/mr-scanner.mjs" .
run node "$MR_ROOT/tools/mr-scanner/mr-scanner.mjs" --profile light .
run node "$MR_ROOT/tools/mr-scanner/mr-scanner.mjs" --dry-run fixture-scanner fixture-light
run node "$MR_ROOT/tools/mr/mr.mjs" claims .
run node "$MR_ROOT/tools/mr/mr.mjs" claims . --format json --all
run node "$MR_ROOT/tools/mr/mr.mjs" claims fixture-light --rev HEAD
run node "$MR_ROOT/tools/mr/mr.mjs" scan . --format json --subjects
run node "$MR_ROOT/tools/mr/mr.mjs" impact HEAD
run node "$MR_ROOT/tools/mr/mr.mjs" impact matrix.md --fail
run node "$MR_ROOT/tools/mr/mr.mjs" suggest-links .
run node "$MR_ROOT/tools/mr/mr.mjs" verify fixture-light/light-ok/codice.md
run node "$MR_ROOT/tools/mr/mr.mjs" remap .
run node "$MR_ROOT/tools/mr/mr.mjs" rivisto matrix.md
run node "$MR_ROOT/tools/mr/mr.mjs" date matrix.md
run node "$MR_ROOT/tools/mr/mr.mjs" vivi .
# giro settimanale: indice FUORI dalla copia, che punta alla copia; senza --write non scrive
printf '**Archivio:** `vecchio`.\n\n| Slug | Gruppo | Path | Nota |\n|---|---|---|---|\n| `copia` | software | `%s` | — |\n| `vecchio` | software | `%s` | — |\n' "$COPY" "$COPY" > "$WORK/indice.md"
run node "$MR_ROOT/tools/mr/giro.mjs" --indice "$WORK/indice.md"
run node "$MR_ROOT/tools/mr/giro.mjs" --precisione --giro-dir "$WORK/giro-vuota"
run "$PYTHON" "$MR_ROOT/tools/mr-kg/build_kg.py" --dir .
run "$PYTHON" "$MR_ROOT/tools/mr-kg/build_kg.py" --dir . --extract-headings

# graph_report e kg_query leggono un .ttl: lo si costruisce FUORI dalla copia
"$PYTHON" "$MR_ROOT/tools/mr-kg/build_kg.py" --dir "$COPY" --write --output "$WORK/kg.ttl" --no-verify >/dev/null
run "$PYTHON" "$MR_ROOT/tools/mr-kg/graph_report.py" --kg "$WORK/kg.ttl"
run "$PYTHON" "$MR_ROOT/tools/mr-kg/kg_query.py" --kg "$WORK/kg.ttl" --schema
run "$PYTHON" "$MR_ROOT/tools/mr-kg/kg_query.py" --kg "$WORK/kg.ttl" -q 'SELECT ?id WHERE { ?d mr:id ?id }'

AFTER="$(git -C "$COPY" status --porcelain --untracked-files=all)"

echo "git status --porcelain prima: '${BEFORE}'"
echo "git status --porcelain dopo:  '${AFTER}'"
STATUS=0
if [ "$BEFORE" != "$AFTER" ]; then
  echo "❌ qualche tool ha scritto senza --write"
  STATUS=1
fi
if [ "$FAILED_RUNS" -gt 0 ]; then
  echo "❌ $FAILED_RUNS esecuzioni con exit non ammesso o stacktrace"
  STATUS=1
fi
[ "$STATUS" -eq 0 ] && echo "✅ nessuna scrittura senza --write, nessun crash"
exit "$STATUS"
