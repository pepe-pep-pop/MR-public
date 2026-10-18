/**
 * backlog.mjs — freschezza di un doc `type: backlog` (MR 0.6-z6, rilievo 6 dello sprint).
 *
 * Un backlog (schema: `_arch/tool/piattaforme-interne/proposta-1-report-backlog.md` §4) si aggiorna
 * riga per riga: la data del file non dice se è fermo. Qui la freschezza si misura sulle righe
 * aperte della sezione «In corso»: una voce è ferma se la sua colonna «Aggiornato» è più vecchia
 * della soglia (date 2026-10-16, 16/10/2026 o 16/10 senza anno; default 14 giorni; `staleness_threshold: Nd` nel frontmatter la cambia, `never` la
 * spegne). Le altre sezioni (Prossimi, In attesa, Idee, Fatto) non contano.
 *
 * Usato da mr-validate, mr-scanner e dalla «Salute dei doc» del giro. Funzione pura, nessun I/O.
 */

export const SOGLIA_BACKLOG = 14;

/** soglia in giorni per le voci «In corso»: Infinity se `never` */
export function sogliaBacklog(staleness) {
  if (staleness === 'never') return Infinity;
  const m = typeof staleness === 'string' ? staleness.match(/^(\d+)d$/) : null;
  return m ? Number(m[1]) : SOGLIA_BACKLOG;
}

// date: 2026-10-16, 16/10/2026, 16/10/26 e anche 16/10 senza anno (come nei backlog pilota):
// senza anno vale quello di oggi, o il precedente se la data cadrebbe nel futuro
function data(s, oggi) {
  const t = String(s || '').replace(/[*_`]/g, '').trim();
  let y, mo, d;
  let m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) [, y, mo, d] = m.map(Number);
  else {
    m = t.match(/(?:^|[^\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/);
    if (!m) return null;
    d = Number(m[1]);
    mo = Number(m[2]);
    if (m[3]) {
      y = Number(m[3]);
      if (y < 100) y += 2000;
    } else {
      const o = new Date(oggi);
      y = o.getUTCFullYear();
      if (Date.UTC(y, mo - 1, d) > o.getTime() + 86400000) y -= 1;
    }
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

const celle = (riga) => riga.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());

/**
 * voci della sezione «In corso» ferme da più di `soglia` giorni, e quelle senza una data leggibile
 * @param {string} testo - il doc (frontmatter compreso)
 * @param {string|Date} oggi
 * @returns {{ voci: number, ferme: Array<{id: string, giorni: number}>, senzaData: string[], sezione: boolean, giorniVoci: number[] }}
 */
export function vociFerme(testo, oggi, soglia = SOGLIA_BACKLOG) {
  const out = { voci: 0, ferme: [], senzaData: [], sezione: false, giorniVoci: [] };
  const righe = testo.replace(/\r\n?/g, '\n').split('\n');
  const t0 = new Date(oggi).getTime();
  let dentro = false;
  let header = null;
  for (const l of righe) {
    const h = l.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      dentro = /^in corso\b/i.test(h[1].replace(/[*_`]/g, '').trim());
      if (dentro) out.sezione = true;
      header = null;
      continue;
    }
    if (!dentro || !/^\s*\|/.test(l)) continue;
    const c = celle(l);
    if (!header) { header = c.map((x) => x.toLowerCase()); continue; }
    if (c.every((x) => /^:?-+:?$/.test(x))) continue;
    const iAgg = header.findIndex((x) => /^aggiornat[oa]\b/.test(x));
    const iId = header.findIndex((x) => x === 'id');
    const id = (iId >= 0 ? c[iId] : c[0]) || '?';
    if (c.every((x) => !x)) continue;
    out.voci++;
    const dt = iAgg >= 0 ? data(c[iAgg], oggi) : null;
    if (!dt) { out.senzaData.push(id); continue; }
    const giorni = Math.floor((t0 - dt.getTime()) / 86400000);
    out.giorniVoci.push(giorni);
    if (giorni > soglia) out.ferme.push({ id, giorni });
  }
  return out;
}

/** testo breve per un warning o un problema: «2 voci «In corso» ferme da più di 14 giorni: B-003 (20 g), …» */
export function descriviFerme(r, soglia) {
  const parti = [];
  if (r.ferme.length) parti.push(`${r.ferme.length} ${r.ferme.length === 1 ? 'voce «In corso» ferma' : 'voci «In corso» ferme'} da più di ${soglia} giorni: ${r.ferme.map((f) => `${f.id} (${f.giorni} g)`).join(', ')}`);
  if (r.senzaData.length) parti.push(`${r.senzaData.length} senza una data leggibile in «Aggiornato»: ${r.senzaData.join(', ')}`);
  return parti.join('; ');
}
