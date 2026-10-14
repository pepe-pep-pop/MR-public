---
mr_version: "0.3"
id: test/source-a
title: "Test fixture — source A per propagateStaleness (Spike 6 C.3)"
type: explanation
owner: rnd
status: active
created: 2026-04-12
last_updated: 2026-04-12
propagate_staleness_to:
  - id: test/target-b
    reason: "B dipende semanticamente dai contenuti di A"
  - id: test/target-c
    reason: "C cita i dati di A"
ai_summary: "Fixture di test per C.3 propagateStaleness — sorgente A con 2 target B+C"
priority: low
---

# Test fixture: source-a

> **Scopo**: sorgente di propagazione per i test unitari di `propagateStaleness()` in Step C.3 di Spike 6.
>
> **Uso**: il test script simula diversi valori di `previousState` e verifica che la funzione emetta gli eventi di propagazione corretti verso `test/target-b` e `test/target-c` quando l'hash cambia.
>
> **Mai modificare questo file a mano senza aggiornare i test hash hardcoded**, se ce ne sono.

## Corpo del documento

Questo è il contenuto testuale del test file. Cambiarlo fa cambiare `_content_hash`.
