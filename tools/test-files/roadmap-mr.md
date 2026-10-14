---
mr_version: '0.2'
id: mr/piano-rnd
title: Piano R&D — Metadati Relazionali
type: roadmap
owner: rnd
status: active
version: 0.1.0
created: 2026-02-28
last_updated: 2026-02-28
staleness_threshold: 30d
depends_on:
- id: mr/ppd-00
  reason: PPD fondazionale del progetto MR
  strength: strong
  rel_type: implements
required_by:
- id: mr/spike-3-bmad
  reason: Spike definito da questo piano
  strength: strong
  rel_type: references
- id: mr/spike-3b-arch
  reason: Spike definito da questo piano
  strength: strong
- id: mr/report-spike-0-obsidian
  reason: Richiesto da mr/report-spike-0-obsidian (inverso automatico)
- id: mr/report-spike-3c-ci-validation
  reason: Richiesto da mr/report-spike-3c-ci-validation (inverso automatico)
ai_summary: Piano spike diagnostici per validare l'approccio MR
ai_keywords:
- piano
- spike
- obsidian
- driftcheck
- bmad
- validation
priority: high
related_to:
- id: gcm/report-spike-4
  reason: Condivide il concetto 'spike' con mr/piano-rnd
  strength: weak
- id: mr/guida-parte-b-spike-0-e-1
  reason: Condivide il concetto 'spike' con mr/piano-rnd
  strength: weak
- id: gcm/handoff-02
  reason: Condivide il concetto 'spike' con mr/piano-rnd
  strength: weak
---
# Piano R&D — Metadati Relazionali

Contenuto del piano...
