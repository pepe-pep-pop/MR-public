---
mr_version: "0.3"
id: test/target-b
title: "Test fixture — target B (intermedio, ha a sua volta propagate_staleness_to)"
type: explanation
owner: rnd
status: active
created: 2026-04-12
last_updated: 2026-04-12
propagate_staleness_to:
  - id: test/target-d
    reason: "D dipende da B — ma NON deve essere raggiunto dalla propagazione di A (vincolo D5.1.b single-hop)"
ai_summary: "Fixture target intermedio: A propaga a B, ma B NON deve propagare automaticamente a D a cascata"
priority: low
---

# Test fixture: target-b

> **Scopo**: target di propagazione da `test/source-a`, ma anche sorgente teorica verso `test/target-d`.
>
> **Test critico (D5.1.b single-hop)**: quando `test/source-a` cambia hash, `propagateStaleness` deve emettere un evento `source-a → target-b`, ma **NON** un evento chained `source-a → target-d` via `target-b`. La propagazione è single-hop only.
