---
mr_version: "0.3"
id: test/target-d
title: "Test fixture — target D (foglia teorica, raggiungibile solo via B)"
type: explanation
owner: rnd
status: active
created: 2026-04-12
last_updated: 2026-04-12
ai_summary: "Fixture target per test single-hop: NON deve ricevere propagazione da source-a indirettamente via target-b"
priority: low
---

# Test fixture: target-d

> **Scopo**: foglia teorica. È target di `test/target-b`, ma **NON** deve essere raggiunto dalla propagazione di `test/source-a` — la propagazione è single-hop only (vincolo D5.1.b di Spike 6).
