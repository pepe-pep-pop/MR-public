/**
 * verbo.mjs — verbo di rimozione legato al nome (0.6-r).
 *
 * Fino alla 0.6-q bastava che la riga (o il paragrafo) contenesse «tolto», «sostituito» …
 * per scartare TUTTI i nomi della riga: «`Diagnostica.tsx` (pagina), `DiagnosticaAuditLog.tsx`
 * (sostituita da `/admin/log`)» scartava anche Diagnostica.tsx. Qui il verbo vale solo per il
 * nome a cui si riferisce:
 *   - stessa proposizione: frase (chiusa da . ; ! ? o da una nuova voce d'elenco), oppure la
 *     parentesi o l'inciso tra lineette che contiene il nome;
 *   - una parentesi subito dopo il nome parla di quel nome: «`X` (rimosso)»;
 *   - il gruppo di nomi più vicino al verbo, entro MAX_GAP parole: «`A`, `B` e `C` sono stati
 *     tolti» vale per tutti e tre; a parità di distanza prima/dopo non si scarta niente;
 *   - rinominato / diventato / sostituito: il nome vecchio sta prima («`X` sostituito da `Y`»);
 *     dopo il verbo solo se non c'è «da/in/con/…» in mezzo («sostituito `X` con `Y`»);
 *   - eliminato / cancellato: spesso dati («prenotazioni cancellate»), quindi solo per path e
 *     simboli (identifier);
 *   - «Rimossi:» chiude una riga e introduce un elenco: vale per le voci sotto;
 *   - (0.6-s) deprecato, dismesso, sparito e le forme inglesi come gli altri; sparito e replaced
 *     come i verbi di cambio nome; superato solo se seguito da «da/dall'…» e per il nome prima.
 *
 * Funzioni pure, nessun I/O.
 */

// 0.6-s: anche deprecato, dismesso, sparito, superato e le forme inglesi (prima in NARRATIVE, sul paragrafo)
const VERB = /^(tolt[oaie]|rimoss[oaie]|rinominat[oaie]|diventat[oaie]|sostituit[oaie]|eliminat[oaie]|cancellat[oaie]|deprecat[oaie]|dismess[oaie]|sparit[oaie]|superat[oaie]|removed|deleted|deprecated|replaced)$/i;
const SUBJECT_VERB = /^(rinominat|diventat|sostituit|sparit|superat|replaced)/i;
// «superato» vuol dire spesso «passato» (test, gate, soglia): vale solo come «superato da/dall'…»
const SUPERSEDED = /^superat/i;
const DA = /^(da|dal|dall['’]\S*|dalla|dallo|dai|dalle|dagli)$/i;
// 0.6-y: la rimozione detta con un sostantivo vale come il verbo, ma solo per i nomi del suo elenco
const NOUN = /^(rimozion[ei]|eliminazion[ei]|sostituzion[ei]|cancellazion[ei])$/i;
const DATA_NOUN = /^(eliminazion|cancellazion)/i;
const PREP = /^(di|del|della|dello|dei|degli|delle|dal|dalla|il|la|i|le|gli|lo|l['’]\S*)$/i;
const DATA_VERB = /^(eliminat|cancellat)/i;
const DATA_KINDS = new Set(['path', 'identifier']);
const CONNECTOR = /^(e|ed|o|od|oppure|né)$/i;
const AFTER_NEW = /^(da|dal|dalla|dai|dalle|dallo|dall['’]\S*|in|con|col|a|al|alla|nel|nella|come|by|from|with|into|to)$/i;
const AUX = /^(è|e'|é|sono|stat[oaie]|vien[ei]|vengono|era|erano|ha|hanno|già|poi|ora|anche|ormai|definitivamente)$/i;
const MAX_GAP = 5;

const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+/;

/** token di una riga: code, word, open, close, dash, end, colon, comma, slash, pipe */
function tokenize(line) {
  const out = [];
  const re = /`[^`]+`|[\wàèéìòùÀÈÉÌÒÙ'’-]+(?:\.[\w]+)*|\(|\)|\s[—–]\s|[.;!?](?=\s|$)|:|,|\/|\+|&|\|/g;
  let m;
  while ((m = re.exec(line))) {
    const v = m[0];
    if (v[0] === '`') out.push({ t: 'code', v: v.slice(1, -1) });
    else if (v === '(') out.push({ t: 'open' });
    else if (v === ')') out.push({ t: 'close' });
    else if (/^\s[—–]\s$/.test(v)) out.push({ t: 'dash' });
    else if (v === ':') out.push({ t: 'colon' });
    else if (v === ',') out.push({ t: 'comma' });
    else if (v === '/' || v === '+' || v === '&') out.push({ t: 'slash' });
    // in una riga di tabella le celle sono separatori deboli: «| `x.ts` | rimosso |» parla di x.ts
    else if (v === '|') out.push({ t: 'pipe' });
    else if (/^[.;!?]$/.test(v)) out.push({ t: 'end' });
    else if (v === '-' || v === '–' || v === '—') continue;
    else out.push({ t: 'word', v });
  }
  return out;
}

/** «verbo:» (al più 3 parole in mezzo, «rimosso il vecchio modulo:»): i due punti non chiudono la frase, introducono i nomi */
function colonAfterVerb(toks, i) {
  for (let j = i - 1, words = 0; j >= 0 && words <= 3; j--) {
    if (toks[j].t !== 'word') return false;
    if (VERB.test(toks[j].v)) return true;
    words++;
  }
  return false;
}

/**
 * @param {{ lines: string[], at: number }} par - righe del paragrafo e indice della riga del nome
 * @param {string} claim
 * @param {string} kind - tipo del claim (path, identifier, env, …)
 * @returns {string|null} il verbo legato al nome, o null
 */
export function verboLegato(par, claim, kind) {
  if (!par || !par.lines || !par.lines.length) return null;
  const okVerb = (v) => VERB.test(v) && (!DATA_VERB.test(v) || DATA_KINDS.has(kind));
  // citazioni: «> - voce» è una voce d'elenco come «- voce»
  const all = par.lines.map((l) => l.replace(/^\s*(?:>\s?)+/, ''));
  const table = /^\s*\|/.test(all[par.at] || '');
  const lines = table ? [all[par.at]] : all;
  const at = table ? 0 : par.at;

  // elenco introdotto da «Rimossi:» a fine riga, sopra la voce del nome
  if (!table && ITEM.test(lines[at])) {
    let i = at - 1;
    while (i >= 0 && ITEM.test(lines[i])) i--;
    const intro = i >= 0 ? lines[i].replace(/`[^`]*`/g, ' ').match(/((?:[\wàèéìòù'’-]+\s+){0,3}[\wàèéìòù'’-]+)\s*:\s*$/i) : null;
    const v = intro && intro[1].split(/\s+/).find((w) => okVerb(w));
    if (v) return v;
  }

  // token del paragrafo; una nuova voce d'elenco chiude la frase, un a capo semplice no
  const toks = [];
  let claimIdx = -1;
  lines.forEach((line, li) => {
    if (li > 0 && (ITEM.test(line) || /^\s*\|/.test(line))) toks.push({ t: 'end' });
    let src = line.replace(ITEM, '');
    // nome scritto senza backtick: lo si tratta come un code span
    if (li === at && !src.includes(`\`${claim}\``) && src.includes(claim)) src = src.replace(claim, `\`${claim}\``);
    for (const tk of tokenize(src)) {
      if (li === at && claimIdx < 0 && tk.t === 'code' && (tk.v === claim || tk.v.includes(claim))) claimIdx = toks.length;
      toks.push(tk);
    }
  });
  if (claimIdx < 0) return null;
  toks.forEach((tk, i) => { if (tk.t === 'colon') { tk.colon = true; tk.t = colonAfterVerb(toks, i) ? 'comma' : 'end'; } });

  // frase che contiene il nome: un punto o un «;» dentro una parentesi più interna non la chiude
  const pd = [];
  for (let i = 0, d = 0; i < toks.length; i++) {
    if (toks[i].t === 'close') d = Math.max(0, d - 1);
    pd[i] = d;
    if (toks[i].t === 'open') d++;
  }
  const cuts = (i) => toks[i].t === 'end' && pd[i] <= pd[claimIdx];
  // un nome dentro una parentesi non esce dalla parentesi, anche se dentro c'è un punto («(es. `x`)»)
  let s = claimIdx;
  while (s > 0 && !cuts(s - 1) && !(toks[s - 1].t === 'open' && pd[s - 1] < pd[claimIdx])) s--;
  let e = claimIdx;
  while (e < toks.length && !cuts(e) && !(toks[e].t === 'close' && pd[e] < pd[claimIdx])) e++;

  // parentesi e incisi: profondità e intervalli
  const depth = [];
  const groups = []; // [start, end) dei contenuti di una parentesi o di un inciso
  const stack = [];
  let dashOpen = -1;
  for (let i = s; i < e; i++) {
    const tk = toks[i];
    if (tk.t === 'open') stack.push(i);
    else if (tk.t === 'close' && stack.length) groups.push([stack.pop() + 1, i]);
    else if (tk.t === 'dash') {
      if (dashOpen < 0) dashOpen = i;
      else { groups.push([dashOpen + 1, i]); dashOpen = -1; }
    }
    depth[i] = stack.length + (dashOpen >= 0 && i > dashOpen ? 1 : 0);
  }
  if (dashOpen >= 0) groups.push([dashOpen + 1, e]);
  const inner = groups.filter(([a, b]) => a <= claimIdx && claimIdx < b).sort((x, y) => (y[0] - x[0]))[0];
  const [ps, pe] = inner || [s, e];
  const base = depth[claimIdx];

  // sequenza della proposizione: solo i token al livello del nome; le parentesi annidate fuori
  const seq = [];
  for (let i = ps; i < pe; i++) {
    const tk = toks[i];
    if (depth[i] !== base || ['open', 'close', 'dash'].includes(tk.t)) continue;
    seq.push({ ...tk, i });
  }

  // gruppi di nomi: code span uniti da virgole, «e/o/oppure», «/», «+», o vicini. Le parentesi
  // annidate non sono nella sequenza: «`A` (descrizione), `B` (descrizione)» è un gruppo solo
  const units = []; // { t: 'group', idx: [indici dei token] } | { t: 'word', v }
  let glue = false;
  for (const tk of seq) {
    const last = units[units.length - 1];
    if (tk.t === 'code') {
      if (last && last.t === 'group' && (glue || last.adjacent)) last.idx.push(tk.i);
      else units.push({ t: 'group', idx: [tk.i] });
      units[units.length - 1].adjacent = true;
      glue = false;
      continue;
    }
    const conn = tk.t === 'comma' || tk.t === 'slash' || (tk.t === 'word' && CONNECTOR.test(tk.v));
    if (last && last.t === 'group' && conn) { glue = true; last.adjacent = false; continue; }
    if (last && last.t === 'group') last.adjacent = false;
    glue = false;
    if (tk.t === 'word') units.push({ t: 'word', v: tk.v, next: toks[tk.i + 1] });
  }
  const mine = units.find((u) => u.t === 'group' && u.idx.includes(claimIdx));

  // un verbo della proposizione legato al gruppo del nome?
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    if (u.t !== 'word' || !okVerb(u.v)) continue;
    if (SUPERSEDED.test(u.v) && !(u.next && u.next.t === 'word' && DA.test(u.next.v))) continue;
    let before = null;
    let gapB = 0;
    const wordsB = [];
    for (let j = k - 1; j >= 0; j--) {
      if (units[j].t === 'group') { before = units[j]; break; }
      wordsB.push(units[j].v);
      gapB++;
    }
    // eliminato / cancellato: tra il nome e il verbo solo ausiliari («`x` è stato eliminato»)
    if (DATA_VERB.test(u.v) && before && !wordsB.every((w) => AUX.test(w))) before = null;
    let after = null;
    let gapA = 0;
    const between = [];
    for (let j = k + 1; j < units.length; j++) {
      if (units[j].t === 'group') { after = units[j]; break; }
      between.push(units[j].v);
      gapA++;
    }
    let bound = null;
    if (SUPERSEDED.test(u.v)) {
      if (before && gapB <= MAX_GAP) bound = before;
    } else if (SUBJECT_VERB.test(u.v)) {
      if (before && gapB <= MAX_GAP) bound = before;
      else if (after && gapA <= MAX_GAP && !between.some((w) => AFTER_NEW.test(w))) bound = after;
    } else {
      // dopo il verbo, con «da/in/con…» in mezzo, il nome è il luogo o l'agente, non l'oggetto
      if (between.some((w) => AFTER_NEW.test(w)) || (DATA_VERB.test(u.v) && between.length)) after = null;
      const b = before && gapB <= MAX_GAP ? gapB : Infinity;
      const a = after && gapA <= MAX_GAP ? gapA : Infinity;
      if (b < a) bound = before;
      else if (a < b) bound = after;
      // a parità vince il nome prima se in mezzo ci sono solo ausiliari («`x` è deprecato, usa `y`»)
      else if (b !== Infinity && wordsB.every((w) => AUX.test(w)) && !between.every((w) => AUX.test(w))) bound = before;
    }
    if (bound && bound === mine) return u.v;
  }

  // soggetto del verbo scritto come pezzo distintivo del nome, ovunque nella frase: «la V1.5 è
  // diventata V1.6» per `PRD_funzionale_V1.5_IT.md` (pezzo con cifra, «_» o «.», almeno 3 caratteri)
  for (let i = 0; i < toks.length; i++) {
    const tk = toks[i];
    if (tk.t !== 'word' || !okVerb(tk.v)) continue;
    if (SUPERSEDED.test(tk.v) && !(toks[i + 1] && toks[i + 1].t === 'word' && DA.test(toks[i + 1].v))) continue;
    for (let j = i - 1, gap = 0; j >= 0 && gap <= MAX_GAP; j--) {
      const w = toks[j];
      if (w.t === 'code' || w.t === 'open' || w.t === 'close' || w.t === 'dash' || w.t === 'end') break;
      if (w.t !== 'word') continue;
      if (w.v.length >= 3 && /[\d_.]/.test(w.v) && claim.includes(w.v)) return tk.v;
      gap++;
    }
  }

  // sostantivo di rimozione con il suo elenco (0.6-y, giro 5-bis): «dopo la rimozione del 20/08
  // (`f23eb2ef`: `A`, `B`, `C`)», «rimozione di `A` e `B`». Vale solo per i nomi di quell'elenco: la
  // parentesi che segue entro 4 parole, oppure i nomi subito dopo; per «sostituzione» si ferma a «con»
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'word' || !NOUN.test(t.v)) continue;
    if (DATA_NOUN.test(t.v) && !DATA_KINDS.has(kind)) continue;
    let j = i + 1;
    let words = 0;
    while (j < toks.length && words <= 4 && (toks[j].t === 'word' || toks[j].t === 'slash') && !(toks[j].t === 'word' && /^con$/i.test(toks[j].v))) {
      if (toks[j].t === 'word') words++;
      j++;
    }
    if (toks[j] && toks[j].t === 'open') {
      // i nomi dentro la parentesi, allo stesso livello
      let d = 0;
      for (let k = j; k < toks.length; k++) {
        if (toks[k].t === 'open') d++;
        else if (toks[k].t === 'close') { if (--d === 0) break; }
        else if (k === claimIdx && d === 1) return t.v;
      }
      continue;
    }
    // nomi subito dopo il sostantivo (con le sole preposizioni in mezzo), uniti da virgole o «e»
    let k = i + 1;
    while (k < toks.length && toks[k].t === 'word' && PREP.test(toks[k].v)) k++;
    for (; k < toks.length; k++) {
      const x = toks[k];
      if (x.t === 'code') { if (k === claimIdx) return t.v; continue; }
      if (x.t === 'comma' || x.t === 'slash' || (x.t === 'word' && CONNECTOR.test(x.v))) continue;
      break;
    }
  }

  // verbo lontano che riprende il nome con una parola (0.6-w, giro 5): «… pagina di consenso
  // `/x` (`OAuthConsent.tsx`, …). … tolti rotta, pagina, `src/lib/mcp/`, …». Il verbo sta nella
  // stessa frase o in quella subito dopo; il suo elenco di oggetti contiene una parola (5+ lettere)
  // che sta tra le 4 parole subito prima del nome
  {
    const before = [];
    for (let j = claimIdx - 1; j >= 0 && before.length < 4; j--) {
      const t = toks[j];
      if (t.t === 'end') break;
      if (t.t === 'word') before.push(t.v.toLowerCase());
    }
    const intro = new Set(before.filter((w) => w.length >= 5));
    let sentences = 0;
    for (let i = claimIdx + 1; i < toks.length && intro.size; i++) {
      const t = toks[i];
      if (t.t === 'end') { if (!t.colon && ++sentences > 1) break; continue; }
      if (t.t !== 'word' || !okVerb(t.v) || SUBJECT_VERB.test(t.v)) continue;
      // elenco degli oggetti: parole e code span dopo il verbo, fino alla fine della frase
      for (let k = i + 1; k < toks.length && toks[k].t !== 'end'; k++) {
        if (toks[k].t === 'word' && intro.has(toks[k].v.toLowerCase())) return t.v;
      }
    }
  }

  // parentesi o inciso subito dopo il gruppo del nome: parla di quel nome
  if (mine) {
    // solo la parentesi subito dopo il nome stesso, non dopo un altro nome del gruppo
    const lastTok = claimIdx;
    const g = groups.find(([a]) => a - 2 === lastTok && depth[lastTok] === base);
    if (g) {
      const inside = [];
      for (let i = g[0]; i < g[1]; i++) if (depth[i] === base + 1) inside.push(toks[i]);
      for (let k = 0; k < inside.length; k++) {
        const tk = inside[k];
        if (tk.t !== 'word' || !okVerb(tk.v)) continue;
        if (SUPERSEDED.test(tk.v) && !(inside[k + 1] && inside[k + 1].t === 'word' && DA.test(inside[k + 1].v))) continue;
        // un altro nome nella parentesi, prima del verbo, se lo prende lui
        if (inside.slice(0, k).some((x) => x.t === 'code')) continue;
        if (!SUBJECT_VERB.test(tk.v)) {
          const near = inside.slice(k + 1).findIndex((x) => x.t === 'code');
          const wordsTo = near < 0 ? Infinity : inside.slice(k + 1, k + 1 + near).filter((x) => x.t === 'word').length;
          if (wordsTo <= k) continue;
        }
        return tk.v;
      }
    }
  }
  return null;
}
