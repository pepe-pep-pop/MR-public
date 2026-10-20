#!/bin/bash
# token-gh.sh — token GitHub in sola lettura per MR, nel portachiavi di macOS (0.6-z13, R8).
#
# MR li usa solo per i processi `gh` che lancia lui (scan --remote, PR aperte nel giro): li legge
# dal portachiavi al momento della chiamata e li passa come GH_TOKEN solo a quel processo.
# Lo script non tocca l'autenticazione di gh, il profilo della shell o i settings di Claude Code.
#
# Uso (da un terminale, non da un agente: il token lo incolla solo chi lo possiede):
#   tools/mr/token-gh.sh carica <owner> [<owner>…]     chiede il token di ogni owner e lo salva
#   tools/mr/token-gh.sh verifica <owner>/<repo> [...]  lettura (deve riuscire) e scrittura (deve fallire)
#   tools/mr/token-gh.sh elenco                         owner con un token salvato (mai i valori)
#   tools/mr/token-gh.sh togli <owner> [<owner>…]       toglie il token dal portachiavi
#
# Il valore non passa mai da argomenti (ps), cronologia della shell, file o output:
#   - `carica` lascia a `security` la richiesta del valore (opzione -w in fondo: lo chiede due
#     volte sul terminale, senza mostrarlo);
#   - `verifica` lo tiene in una variabile della shell e lo dà come GH_TOKEN solo al processo gh.
# Voce del portachiavi: servizio «mr-gh-token», account = owner in minuscolo.

set -euo pipefail

SERVIZIO="mr-gh-token"

errore() { echo "errore: $*" >&2; exit 2; }

[ "$(uname)" = "Darwin" ] || errore "serve macOS (portachiavi). Altrove usa la variabile MR_GH_TOKEN_<OWNER> nel solo processo di MR."
command -v security >/dev/null || errore "manca il comando security"

owner_valido() { [[ "$1" =~ ^[A-Za-z0-9_.-]+$ ]] || errore "owner non valido: $1"; }

carica() {
  [ $# -ge 1 ] || errore "uso: $0 carica <owner> [<owner>…]"
  for owner in "$@"; do
    owner_valido "$owner"
    local account
    account=$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')
    echo "Token in sola lettura per «${owner}»: incollalo quando security lo chiede (due volte, non si vede)."
    # -U aggiorna una voce già presente; -w in fondo: il valore lo chiede security, non passa da argv
    security add-generic-password -U -s "$SERVIZIO" -a "$account" -l "MR: token gh in sola lettura ($account)" -w
    echo "  salvato nel portachiavi (servizio $SERVIZIO, account $account)"
  done
  echo "Ora: $0 verifica <owner>/<repo> per ogni owner."
}

verifica() {
  [ $# -ge 1 ] || errore "uso: $0 verifica <owner>/<repo> [...]"
  command -v gh >/dev/null || errore "manca gh"
  local esito=0
  for slug in "$@"; do
    [[ "$slug" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || errore "repo non valido: $slug (serve owner/repo)"
    local owner account token
    owner=${slug%%/*}
    account=$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')
    if ! token=$(security find-generic-password -s "$SERVIZIO" -a "$account" -w 2>/dev/null); then
      echo "❌ $slug: nessun token per $account (prima: $0 carica $owner)"; esito=1; continue
    fi
    # 1. lettura: deve riuscire
    if GH_TOKEN="$token" gh api "repos/$slug" --jq .full_name >/dev/null 2>&1; then
      echo "✅ $slug: lettura riuscita con il token di MR"
    else
      echo "❌ $slug: lettura fallita con il token di MR (repo fuori dal token, o token scaduto)"; esito=1
    fi
    # 2. scrittura: deve fallire. Si chiede di creare un branch verso uno sha che non esiste: con il
    #    permesso di scrittura GitHub risponde 422 (sha inesistente) e non crea niente; con la sola
    #    lettura risponde 403. In nessun caso cambia qualcosa nel repo.
    local out
    out=$(GH_TOKEN="$token" gh api -X POST "repos/$slug/git/refs" -f ref=refs/heads/mr-prova-sola-lettura -f sha=0000000000000000000000000000000000000000 2>&1 || true)
    if [[ "$out" == *"HTTP 403"* || "$out" == *"HTTP 404"* ]]; then
      echo "✅ $slug: scrittura rifiutata (il token è in sola lettura)"
    elif [[ "$out" == *"HTTP 422"* ]]; then
      echo "❌ $slug: il token ha il permesso di scrittura (GitHub ha risposto 422, non 403): rifallo in sola lettura"; esito=1
    else
      echo "⚠️  $slug: risposta inattesa alla prova di scrittura, controlla a mano"; esito=1
    fi
    unset token
  done
  return $esito
}

elenco() {
  # solo gli account, mai i valori: dump-keychain senza -d non stampa i segreti
  security dump-keychain 2>/dev/null | awk -v s="\"$SERVIZIO\"" '
    /"acct"<blob>=/ { a = $0; sub(/.*"acct"<blob>="/, "", a); sub(/".*/, "", a) }
    /"svce"<blob>=/ { if (index($0, s)) print "  " a }' | sort -u
}

togli() {
  [ $# -ge 1 ] || errore "uso: $0 togli <owner> [<owner>…]"
  for owner in "$@"; do
    owner_valido "$owner"
    local account
    account=$(printf '%s' "$owner" | tr '[:upper:]' '[:lower:]')
    if security delete-generic-password -s "$SERVIZIO" -a "$account" >/dev/null 2>&1; then
      echo "tolto: $account"
    else
      echo "nessun token per $account"
    fi
  done
}

comando=${1:-}
[ $# -gt 0 ] && shift
case "$comando" in
  carica) carica "$@" ;;
  verifica) verifica "$@" ;;
  elenco) elenco ;;
  togli) togli "$@" ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
