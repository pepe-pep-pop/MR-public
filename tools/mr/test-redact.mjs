#!/usr/bin/env node
/**
 * test-redact.mjs — oscuramento nei diff e negli oggetti dei commit (PRD v0.6 N4, nota A10).
 * Invocazione: node tools/mr/test-redact.mjs   (exit 0 = tutti pass)
 */

import { redactLine } from './lib/drift.mjs';

const cases = [
  // [input, atteso]
  ['+  tel: 3471234567', '+  tel: [telefono]'],
  ['+  tel: 347 123 4567', '+  tel: [telefono]'],
  ['+  tel: 347-123-4567', '+  tel: [telefono]'],
  ['+  tel: 347.1234567', '+  tel: [telefono]'],
  ['+  tel: +39 347 123 4567', '+  tel: [telefono]'],
  ['+  tel: +393471234567', '+  tel: [telefono]'],
  ['+  tel: 0039 3471234567', '+  tel: [telefono]'],
  ['+  tel: +39-347-1234567', '+  tel: [telefono]'],
  ['-  due: 3331234567, 3209876543', '-  due: [telefono], [telefono]'],
  ['+  contatto: nome.cognome@example.com', '+  contatto: [email]'],
  ['+  const token = "abc"', '+ [riga omessa: possibile segreto]'],
  // da NON toccare
  ['+  return importo * 3;', '+  return importo * 3;'],
  ['+  const ts = 1727988123456;', '+  const ts = 1727988123456;'], // timestamp: più di 10 cifre
  ['+  id: 63434020871', '+  id: 63434020871'], // id HubSpot che inizia con 6
  ['+  porta 3000, timeout 30000', '+  porta 3000, timeout 30000'],
  ['+  fisso 02 1234 5678', '+  fisso 02 1234 5678'], // fissi: fuori dalla regola (solo cellulari)
  ['+  versione 3.12.4', '+  versione 3.12.4'],
  // 0.6-t: si guarda il valore, non il nome (verify su auth.server.ts di dashboard-b)
  ['+  idToken: string,', '+  idToken: string,'],
  ['+  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();', '+  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();'],
  ['+  if (sessionSecret!.length < 32) {', '+  if (sessionSecret!.length < 32) {'],
  ['+  const token = await getToken(code);', '+  const token = await getToken(code);'],
  ['+  headers: { Authorization: `Bearer ${accessToken}` },', '+  headers: { Authorization: `Bearer ${accessToken}` },'],
  ['+  SESSION_SECRET=<quello generato sopra>', '+  SESSION_SECRET=<quello generato sopra>'],
  ['+  password: "hunter2hunter2"', '+ [riga omessa: possibile segreto]'],
  ['+  API_TOKEN=a1b2c3d4e5f6g7h8i9', '+ [riga omessa: possibile segreto]'],
  ['+  const k = "sk_live_51HxYz0123456789abcd";', '+ [riga omessa: possibile segreto]'],
  ['+  auth: "ghp_abcdefghijklmnopqrstuvwxyz0123"', '+ [riga omessa: possibile segreto]'],
  ['+  Authorization: Bearer abcdefghijklmnop0123456789', '+ [riga omessa: possibile segreto]'],
  ['+  url = postgres://app:s3cretPass@db:5432/x', '+ [riga omessa: possibile segreto]'],
  ['+  hash 0123456789abcdef0123456789abcdef01234567', '+ [riga omessa: possibile segreto]'],
  // regola ibrida (maintainer, 07/10): nome da segreto + letterale → sempre oscurato, anche corto
  ['+  password: hunter', '+ [riga omessa: possibile segreto]'],
  ['+Per provare usa password: hunter.', '+ [riga omessa: possibile segreto]'],
  ['+DB_PASSWORD=ciao2024', '+ [riga omessa: possibile segreto]'],
  ["+  secret = 'x'", '+ [riga omessa: possibile segreto]'],
  ['+  const cfg = { user: "app", pwd: "abc" };', '+ [riga omessa: possibile segreto]'],
  ['+  credentials: s3cr3t', '+ [riga omessa: possibile segreto]'],
  // innocui: tipi, chiamate, proprietà, template, segnaposto, espressioni, stringa vuota, numero
  ['+  password: string;', '+  password: string;'],
  ['+  token?: string | null,', '+  token?: string | null,'],
  ['+  const tokens = getTokens(req)', '+  const tokens = getTokens(req)'],
  ['+  password: input.password,', '+  password: input.password,'],
  ["+  secret = ''", "+  secret = ''"],
  ['+  maxTokens: 1000,', '+  maxTokens: 1000,'],
  ['+  if (token === undefined) return;', '+  if (token === undefined) return;'],
  ['+  const ok = secret == expected;', '+  const ok = secret == expected;'],
  ['+  PASSWORD=<la password del db>', '+  PASSWORD=<la password del db>'],
  // misura su dashboard-b (07/10): righe innocue che oscuravano anche la 0.6-s e la 0.6-t
  ['+  sessionSecret: Uint8Array;', '+  sessionSecret: Uint8Array;'],
  ['+  token_endpoint: "https://oauth2.googleapis.com/token",', '+  token_endpoint: "https://oauth2.googleapis.com/token",'],
  ['+// --- Configurazione -----------------------------------------------------------', '+// --- Configurazione -----------------------------------------------------------'],
  ['+  "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem]",', '+  "z-50 max-h-(--radix-context-menu-content-available-height) min-w-[8rem]",'],
  ['+  const d = await hsFetch(`/crm/v4/associations/deals/contacts/batch/read`, {', '+  const d = await hsFetch(`/crm/v4/associations/deals/contacts/batch/read`, {'],
  ['+  image: postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252aa1', '+  image: postgres@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252aa1'],
  ['+  commit 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08', '+ [riga omessa: possibile segreto]'],
];

let failed = 0;
for (const [input, expected] of cases) {
  const got = redactLine(input);
  if (got !== expected) {
    failed++;
    console.log(`  ❌ ${JSON.stringify(input)}\n     atteso:  ${JSON.stringify(expected)}\n     ottenuto: ${JSON.stringify(got)}`);
  }
}
console.log(`\ntest-redact.mjs\n\nRisultato: ${cases.length - failed}/${cases.length} PASS`);
process.exit(failed ? 1 : 0);
