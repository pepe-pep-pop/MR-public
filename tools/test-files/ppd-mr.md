---
mr_version: '0.2'
id: mr/ppd-00
title: Product Proposal Document — MR
type: ppd
owner: rnd
status: active
created: 2026-02-28
required_by:
- id: mr/piano-rnd
  reason: Piano R&D derivato da questo PPD
  strength: strong
  rel_type: implements
- id: mr/handoff-freshness-check-01
  reason: Richiesto da mr/handoff-freshness-check-01 (inverso automatico)
- id: mr/piano-spike4
  reason: Richiesto da mr/piano-spike4 (inverso automatico)
- id: mr/piano-spike5
  reason: Richiesto da mr/piano-spike5 (inverso automatico)
- id: mr/prd-v01
  reason: Richiesto da mr/prd-v01 (inverso automatico)
- id: mr/glossario
  reason: Richiesto da mr/glossario (inverso automatico)
- id: mr/report-spike-0-obsidian
  reason: Richiesto da mr/report-spike-0-obsidian (inverso automatico)
- id: mr/report-spike-4
  reason: Richiesto da mr/report-spike-4 (inverso automatico)
- id: mr/spike-5-step-b-evidenze
  reason: Richiesto da mr/spike-5-step-b-evidenze (inverso automatico)
- id: mr/report-landscape-analysis
  reason: Richiesto da mr/report-landscape-analysis (inverso automatico)
ai_summary: Proposta per sistema di metadati relazionali tra documenti
ai_keywords:
- metadati
- relazionali
- dipendenze
- freshness
- documentazione
priority: high
propagate_staleness_to:
- id: mr/piano-rnd
  reason: Cambiamenti a mr/ppd-00 invalidano questa roadmap
- id: mr/piano-spike5
  reason: Cambiamenti a mr/ppd-00 invalidano questa roadmap
---
# PPD — Metadati Relazionali

Contenuto del PPD...
