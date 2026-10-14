#!/usr/bin/env node
/**
 * test-verbo.mjs — verbo di rimozione legato al nome (MR 0.6-r, lib/verbo.mjs).
 *
 * Nella 0.6-q bastava «tolto/rimosso/sostituito…» sulla riga per scartare tutti i nomi della riga.
 * Qui ogni caso dice se il verbo riguarda proprio quel nome (true = scartato come storico).
 *
 * Invocazione: node tools/mr/test-verbo.mjs   (exit 0 = tutti pass)
 */

import { verboLegato } from './lib/verbo.mjs';

console.log('\ntest-verbo.mjs\n');

const C = [
  // [righe, indice, claim, kind, atteso (true = scartato)]
  [['- `Diagnostica.tsx` (pagina), `DiagnosticaAuditLog.tsx` (sostituita da `/admin/log`)'], 0, 'Diagnostica.tsx', 'path', false],
  [['- `Diagnostica.tsx` (pagina), `DiagnosticaAuditLog.tsx` (sostituita da `/admin/log`)'], 0, 'DiagnosticaAuditLog.tsx', 'path', true],
  [['- `Diagnostica.tsx` (pagina), `DiagnosticaAuditLog.tsx` (sostituita da `/admin/log`)'], 0, '/admin/log', 'endpoint', false],
  [['`RESET_ADMINS` è stata rinominata `ADMIN_EMAILS` il 12/09.'], 0, 'RESET_ADMINS', 'env', true],
  [['`RESET_ADMINS` è stata rinominata `ADMIN_EMAILS` il 12/09.'], 0, 'ADMIN_EMAILS', 'env', false],
  [['Le funzioni `A`, `B` e', '`C` sono stati tolti il 20/08.'], 0, 'A', 'identifier', true],
  [['Le funzioni `A`, `B` e', '`C` sono stati tolti il 20/08.'], 1, 'C', 'identifier', true],
  [['Rimossi:', '- `vecchio.ts`', '- `altro.ts`'], 2, 'altro.ts', 'path', true],
  [['- `x.ts` rimosso'], 0, 'x.ts', 'path', true],
  [['Tolto `menu-vecchio.tsx` dal menu, aggiunto `menu.tsx`.'], 0, 'menu.tsx', 'path', false],
  [['Tolto `menu-vecchio.tsx` dal menu, aggiunto `menu.tsx`.'], 0, 'menu-vecchio.tsx', 'path', true],
  [['Il bottone è stato tolto da `Header.tsx`.'], 0, 'Header.tsx', 'path', false],
  [['La tabella `bookings` contiene le prenotazioni cancellate.'], 0, 'bookings', 'table', false],
  [['La funzione `pulisci` contiene le righe cancellate.'], 0, 'pulisci', 'identifier', false],
  [['`cleanup.ts` è stato eliminato.'], 0, 'cleanup.ts', 'path', true],
  [['Le prenotazioni cancellate finiscono in `bookings_log`.'], 0, 'bookings_log', 'table', false],
  [['Non modificare `src/integrations/lovable/index.ts`.'], 0, 'src/integrations/lovable/index.ts', 'path', false],
  [['Il form usa `submit.ts`; il vecchio flusso è stato sostituito.'], 0, 'submit.ts', 'path', false],
  [['`a.ts` resta — `b.ts` rimosso — e `c.ts` invariato'], 0, 'a.ts', 'path', false],
  [['`a.ts` resta — `b.ts` rimosso — e `c.ts` invariato'], 0, 'b.ts', 'path', true],
  [['abbiamo sostituito `old.ts` con `new.ts`'], 0, 'old.ts', 'path', true],
  [['abbiamo sostituito `old.ts` con `new.ts`'], 0, 'new.ts', 'path', false],
  [['| `x.ts` | rimosso | 3 |'], 0, 'x.ts', 'path', true],
  [['| `y.ts` | attivo | `z.ts` rimosso |'], 0, 'y.ts', 'path', false],
  // forme trovate nella misura della 0.6-r: citazione con voci d'elenco, «+», elenco con descrizioni
  [['> - Nessuna API: rimossi `a.py`, `b.py`. Nuovo `k.py`, che rifiuta `SERVICE` e `FROM`', '> - Rimosso `kg_server.py` (endpoint di rete) e `mr_enhance.py` (scriveva nei file)'], 1, 'mr_enhance.py', 'path', true],
  [['> - Nessuna API: rimossi `a.py`, `b.py`. Nuovo `k.py`, che rifiuta `SERVICE` e `FROM`', '> - Rimosso `kg_server.py` (endpoint di rete) e `mr_enhance.py` (scriveva nei file)'], 0, 'k.py', 'path', false],
  [['- Cleanup F.4:', '  rimossi `playwright.config.ts` + `playwright-fixture.ts` Lovable,'], 1, 'playwright-fixture.ts', 'path', true],
  [['Rimossi: `mr_tag.py` e `nsparql.py` (chiamate → skill', '`mr-tag` e `mr-query`), `kg_server.py` (endpoint),', '`benchmark_global.py` (dipendeva), `mr_enhance.py`', '(scriveva), `.env.local.example`. Dettagli in `d.md`.'], 3, '.env.local.example', 'path', true],
  [['Rimossi: `mr_tag.py` e `nsparql.py` (chiamate → skill', '`mr-tag` e `mr-query`), `kg_server.py` (endpoint),', '`benchmark_global.py` (dipendeva), `mr_enhance.py`', '(scriveva), `.env.local.example`. Dettagli in `d.md`.'], 3, 'd.md', 'path', false],
  // 0.6-s: deprecato, dismesso, sparito, superato, forme inglesi (forme del campione della misura)
  [["| Wrapper iOS | stessa storia, cartella `ios/` | Superato dall'app nativa C |"], 0, 'ios/', 'path', true],
  [['Typecheck `tsc` e build superati.'], 0, 'tsc', 'command', false],
  [['Eseguita e superata il 2026-07-29: perdita totale di `data/` simulata.'], 0, 'data/', 'path', false],
  [['| Backup + restore | ✅ **superato** — perdita totale di `data/` simulata |'], 0, 'data/', 'path', false],
  [['Il pilota ha segnalato claim in un piano già superato: piani chiusi (es. `docs/plans/`)'], 0, 'docs/plans/', 'path', false],
  [['- **Sigle deprecate**: `FE2G` non si usa più.'], 0, 'FE2G', 'identifier', true],
  [['`vecchio.ts` è deprecato, usa `nuovo.ts`.'], 0, 'vecchio.ts', 'path', true],
  [['`vecchio.ts` è deprecato, usa `nuovo.ts`.'], 0, 'nuovo.ts', 'path', false],
  [['`cron.sh` è dismesso dal 10/09.'], 0, 'cron.sh', 'path', true],
  [['Il bottone `Esporta` è sparito dal menu.'], 0, 'Esporta', 'identifier', true],
  [['`old_fn` was removed in v2.'], 0, 'old_fn', 'identifier', true],
  [['The banner was removed from `config.ts`.'], 0, 'config.ts', 'path', false],
  [['`legacy.ts` replaced by `core.ts`.'], 0, 'core.ts', 'path', false],
  [['`legacy.ts` replaced by `core.ts`.'], 0, 'legacy.ts', 'path', true],
  [['Piani chiusi, `status` superseded / deprecated / done, cartelle `_archive/`.'], 0, '_archive/', 'path', false],
  // 0.6-w: verbo lontano che riprende il nome con una parola (giro 5, landing-eventi AGENTS.md:38)
  [['pagina di consenso `/.lovable/oauth/consent` (`OAuthConsent.tsx`, login via broker). Senza quel progetto non', 'funziona: tolti rotta, pagina, `src/lib/mcp/`, plugin Vite e pacchetto. Il bundle resta.'], 0, 'OAuthConsent.tsx', 'path', true],
  [['qui c\'era un magic link a token firmato (`/r/$token`,', 'secret `ORDINI_X`): **tolto per intero** il 02-10, secret compreso.'], 1, 'ORDINI_X', 'env', true],
  // la parola non è nell'elenco del verbo: niente
  [['La pagina di prova `Home.tsx` resta com\'è. Tolti i vecchi link e il banner.'], 0, 'Home.tsx', 'path', false],
  // il verbo sta due frasi dopo: niente
  [['La pagina di prova `Home.tsx` resta. Il resto è uguale. Tolta la pagina vecchia.'], 0, 'Home.tsx', 'path', false],
  // 0.6-y: sostantivo di rimozione con il suo elenco (giro 5-bis, chiusura-rdp.md:5-7)
  [['Riscritto il 13/10/2026 contro', 'il codice di oggi, dopo la rimozione del 20/08 (`f23eb2ef`: `CheckupBookingFlow.tsx`, `CheckupPercorsoStep.tsx`,', '`CU_PERCORSO_DESCRIPTIONS`).'], 2, 'CU_PERCORSO_DESCRIPTIONS', 'env', true],
  [['Riscritto il 13/10/2026 contro', 'il codice di oggi, dopo la rimozione del 20/08 (`f23eb2ef`: `CheckupBookingFlow.tsx`, `CheckupPercorsoStep.tsx`,', '`CU_PERCORSO_DESCRIPTIONS`).'], 1, 'CheckupBookingFlow.tsx', 'path', true],
  [['La rimozione di `vecchio.ts` e `altro.ts` è del 02/10; resta `nuovo.ts`.'], 0, 'altro.ts', 'path', true],
  [['La rimozione di `vecchio.ts` e `altro.ts` è del 02/10; resta `nuovo.ts`.'], 0, 'nuovo.ts', 'path', false],
  [['Sostituzione di `old.ts` con `new.ts`.'], 0, 'new.ts', 'path', false],
  [['Sostituzione di `old.ts` con `new.ts`.'], 0, 'old.ts', 'path', true],
  // nomi fuori dall'elenco: niente
  [['Dopo la rimozione del 20/08 (`f23eb2ef`: `A.tsx`) il flusso usa `Booking.tsx`.'], 0, 'Booking.tsx', 'path', false],
  // cancellazione di dati: solo path e simboli
  [['La cancellazione delle prenotazioni (`bookings`) è manuale.'], 0, 'bookings', 'table', false],
];

let ok = 0;
for (const [lines, at, claim, kind, exp] of C) {
  const got = !!verboLegato({ lines, at }, claim, kind);
  if (got === exp) {
    ok++;
    console.log(`  ✅ ${exp ? 'scartato' : 'tenuto'}: ${claim} — ${lines[at]}`);
  } else console.log(`  ❌ atteso ${exp ? 'scartato' : 'tenuto'}: ${claim} — ${lines.join(' / ')}`);
}
console.log(`\nRisultato: ${ok}/${C.length} ${ok === C.length ? 'PASS' : 'FAIL'}`);
process.exitCode = ok === C.length ? 0 : 1;
