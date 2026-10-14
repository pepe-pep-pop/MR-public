# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica. Usa la segnalazione privata di GitHub: scheda **Security** →
**Report a vulnerability** (GitHub Security Advisories). Indica:

- la versione (`tools/mr/package.json`) o il commit;
- il comando e i file che servono a riprodurre il problema, con dati finti;
- l'effetto: per esempio una scrittura senza `--write`, la lettura di un file di segreti, l'esecuzione
  di codice preso dai doc o dal repo analizzato.

Il progetto è mantenuto da una persona sola: la risposta è *best effort*, di solito entro una
settimana. Una volta corretto il problema, la segnalazione viene pubblicata con il riconoscimento a
chi l'ha fatta, se lo desidera.

## Cosa MR garantisce per progetto

- Nessuno strumento scrive senza `--write`, e solo nei doc indicati. Il test `tools/test-no-write.sh`
  lo controlla in CI.
- Nessuna chiamata a API LLM o a servizi esterni. `scan --remote` legge soltanto, con `gh api`.
- Nessun server in ascolto.
- I file `.env*`, `*.pem`, `*.key` e quelli con `SECRET` o `SEGRETI` nel nome non vengono letti, e i
  valori che sembrano segreti vengono oscurati nei diff mostrati da `verify`.

Una violazione di uno di questi punti è una vulnerabilità.
