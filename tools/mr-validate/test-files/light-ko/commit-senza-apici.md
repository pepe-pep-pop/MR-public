---
mr_version: '0.6'
id: test/light-commit-senza-apici
title: Fixture — hash di commit senza apici
type: reference
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
code_refs:
  - path: src/a.ts
    verified: { commit: 0164750 }
  - path: src/b.ts
    verified:
      commit: 3e45123
  - path: src/c.ts
    verified: { commit: 'abc1234' }
---

# Hash senza apici

<!-- mr:code path=src/d.ts verified=0164750 -->
Le ancore sono esenti.
