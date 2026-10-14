---
mr_version: '0.6'
id: test/light-codice
title: Fixture — doc con code_refs (v0.6)
type: reference
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
staleness_threshold: never
code_refs:
  - path: src/lib/fees.ts
    symbol: calcolaQuota
    section: "## Quote"
    verified: { commit: '3f2a91c' }
  - path: supabase/functions/*/index.ts
    repo: acme/app-web
    verified: { commit: "3f2a91c", date: '2026-10-03' }
  - path: README.md
---

# Doc con code_refs

## Quote

<!-- mr:code path=src/lib/fees.ts symbol=calcolaQuota verified=3f2a91c -->
La quota si calcola così.
