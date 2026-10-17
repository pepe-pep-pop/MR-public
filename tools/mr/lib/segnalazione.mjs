/**
 * segnalazione.mjs — output nel formato delle segnalazioni di arch (PRD v0.6 R11, nota A20).
 *
 * Una segnalazione `doc-stale` per ogni doc con segnali (claim not_found, link drift / moved /
 * missing), compatibile con `_arch/segnalazioni/_template/segnalazione.md`. Solo
 * testo su stdout: `mr` non scrive in `_arch` (nota A20), il file lo apre arch.
 *
 * Per ogni segnale: repo, path:riga del doc e, se si trova, il commit di codice che l'ha
 * causato (A20):
 *   - path non trovato → l'ultimo commit che l'ha cancellato o rinominato;
 *   - altri nomi → l'ultimo commit che ha cambiato il numero di occorrenze nel codice
 *     (`git log -S`, esclusi i .md);
 *   - link in deriva → i commit dopo verified (già nel risultato di R3).
 * I doc storici (nota A7) non producono segnalazioni.
 */

import { verifiedCause } from './cause.mjs';
import { verboLegato } from './verbo.mjs';

const MAX_CAUSES = 60;

// la riga racconta già la rimozione o il passato (0.6-g, ampliata nella 0.6-i con le righe
// false del giro 2): esito «storico», non una segnalazione
// 0.6-r: tolto/rimosso/eliminato/cancellato/sostituito non stanno più qui (valevano per tutti i nomi
// del paragrafo): li guarda verboLegato, legati al nome. Restano nel titolo della sezione.
// 0.6-s: lo stesso per deprecato/dismesso/sparito/superato e removed/deleted/deprecated/replaced
// 0.6-z5: «superato» nel titolo vale solo come «superato da/dall'…» (nel titolo «Test superati» o
// «Gate superato» vuol dire «passato», come nella riga: verbo.mjs, SUPERSEDED)
const PAST_VERBS = "\\b(rimoss[oaie]|tolt[oaie]|eliminat[oaie]|cancellat[oaie]|sostituit[oaie]|deprecat[oaie]|dismess[oaie]|sparit[oaie]|removed|deleted|deprecated|replaced)\\b|\\bsuperat[oaie]\\s+(?:da|dal|dalla|dallo|dai|dalle|dagli|dall['’])";
const NARRATIVE_PARTS = [
  "\\bno longer\\b",
  "non c'è più|non esiste più|non esistono più|non ci sono più",
  "\\b(il|la|i|le|del|della|dei|delle|al|alla|nel|nella) vecch[ioae]\\b",
  "se n'è andat[oaie]|se ne sono andat[ie]|\\bandat[oaie] via\\b",
  "\\bnessuno (lo |la |li |le )?(importava|usava|chiamava|leggeva)\\b",
  "\\bnon serv(e|ono|iva|ivano)\\b",
  "\\bfino (al|all'|a|ad)\\s*\\**\\d",
  "\\b(portava|portavano|aveva|avevano|c'era|c'erano) ancora\\b",
  "(^|\\n|\\s)[-*]\\s+via\\s",
  // 0.6-j (classi del giro 3): legacy, rebrand, versioni precedenti, «viene da … template»
  "\\b(il|del|nel|dal|al|col|nella|della) legacy\\b|\\(legacy\\)",
  "\\brebrand\\w*\\b[^.]*\\bda\\b",
  "\\bcon la v\\d+\\b|\\bce l'aveva(no)?\\b",
  "\\bvien[ei] da\\b[^.]*\\btemplate\\b",
];
const NARRATIVE = new RegExp(NARRATIVE_PARTS.join('|'), 'i');
// titolo della sezione («### File rimossi»): vale per tutta la sezione, verbi compresi
const NARRATIVE_SECTION = new RegExp([PAST_VERBS, ...NARRATIVE_PARTS].join('|'), 'i');

// opzioni e proposte, non stato (0.6-k: «si torna a …», «se è un problema …», «decisione …, non tecnica»)
const OPTION = /\bsi torna a\b|\bse (è|e'|é) un problema\b|\bdecisione\b[^.]*\bnon tecnica\b|\bin alternativa\b|\bsi potrebbe\b/i;

// colonne di un registro di lavoro fatto (0.6-k: «Punto | Chi | Prova» con un commit nella riga)
const LOG_HEADER = /\|\s*(chi|prova|commit|fatto|esito|verifica)\s*\|/i;
const COMMIT_IN_ROW = /`[0-9a-f]{7,40}`|\b[0-9a-f]{7,40}\b(?=[^|]*\|)/;

// cosa che ancora non esiste (0.6-j): esito «planned», non not_found
const PLANNED = /\(futur[oaie]\)|\bin futuro\b|\bda creare\b/i;

// la riga introduce un esempio, o la sezione è una convenzione di nomi (0.6-i): fuori dal giro
const EXAMPLE_LINE = /\b(esempio|esempi|ad es\.|per es\.|es\.|e\.g\.)(?=\s|:|—|-|,|$)/i;
const EXAMPLE_SECTION = /\bnaming\b|convenzion[ie] (di|dei|per i) nom|\besempi\b/i;

// tipi ammessi nel giro (0.6-g): con prova di deriva; identifier solo con prova anche lui
export const GIRO_KINDS = new Set(['path', 'command', 'env', 'endpoint', 'table', 'identifier']);

/** causa verificata nel primo repo che la dà (0.6-g: il nome c'era ed è sparito) */
function causeOfClaim(repos, r) {
  for (const repo of repos) {
    const c = verifiedCause(repo, r);
    if (c) return `${c.hash} ${c.date}`;
  }
  return null;
}

function severity(nf, refSignals) {
  const strong = refSignals.filter((r) => r.status === 'missing' || r.status === 'moved').length;
  if (strong || nf >= 5) return 'alta';
  if (refSignals.length || nf >= 2) return 'media';
  return 'bassa';
}

/**
 * @param {object} meta - meta di runClaims / runScan
 * @param {Array<object>} records - claim
 * @param {Array<object>} refs - link (scan), [] per claims
 * @param {(name: string|undefined) => object} repoFor - RepoView dal nome del repo (code_repo) o default
 * @param {{ workspace?: string, today?: string, reposForCause?: object[], onlyCaused?: boolean }} opts
 *        reposForCause: repo in cui cercare la causa (default: quello del claim);
 *        onlyCaused (giro, 0.6-g): nelle segnalazioni solo i claim di GIRO_KINDS con causa
 *        verificata, senza limite di cause; il resto torna in `appendix` (non conteggiato);
 *        lineText(doc, line): testo della riga, per scartare chi dice già «rimosso», «non c'è più»;
 *        reposForDoc(doc): repo del codice di quel doc (giro 0.6-i, mappa per cartella);
 *        tableHeader(doc, line): intestazione della tabella che contiene la riga, o '' (0.6-k);
 *        rawLine(doc, line): la sola riga, per le regole «sulla stessa riga» (0.6-q);
 *        paragraph(doc, line): { lines, at } righe del paragrafo e indice della riga, per legare
 *        il verbo di rimozione al nome (0.6-r); senza, si usa la sola riga
 */
export function toSegnalazioni(meta, records, refs, repoFor, opts = {}) {
  if (opts.onlyCaused) return toSegnalazioniCausate(meta, records, repoFor, opts);
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const workspace = opts.workspace || meta.repo.toLowerCase();
  const docs = new Map();
  for (const r of records) {
    if (r.historical || r.status !== 'not_found') continue;
    if (!docs.has(r.doc)) docs.set(r.doc, { claims: [], refs: [] });
    docs.get(r.doc).claims.push(r);
  }
  for (const r of refs || []) {
    if (r.historical || !['drift', 'moved', 'missing'].includes(r.status)) continue;
    if (!docs.has(r.doc)) docs.set(r.doc, { claims: [], refs: [] });
    docs.get(r.doc).refs.push(r);
  }
  let causes = 0;
  const out = [];
  for (const [doc, { claims, refs: rs }] of [...docs.entries()].sort()) {
    const L = [];
    L.push(`# Segnalazione — ${doc}: ${claims.length + rs.length} affermazioni non più vere`, '');
    L.push(`**Data:** ${today}`);
    L.push(`**Workspace:** ${workspace}`);
    L.push('**Tipo:** doc-stale');
    L.push(`**Severita:** ${severity(claims.length, rs)}`);
    L.push('**Stato:** aperta', '');
    L.push('## Osservato', '');
    L.push(`Path letto (non modificato): \`${meta.repo}/${doc}\``, '');
    L.push(`Cosa non torna (rilevato da \`${meta.tool}\`${meta.rev ? ` al commit ${meta.rev}` : ''}, sola lettura):`, '');
    for (const r of [...rs].sort((a, b) => a.line - b.line)) {
      const commits = (r.commits || []).map((c) => `${c.hash} ${c.date}`).join(', ');
      L.push(`- riga ${r.line}${r.section ? ` (${r.section})` : ''}: link \`${r.path}${r.symbol ? '#' + r.symbol : ''}\` → **${r.status}**${r.moved_to ? ` (ora in \`${r.moved_to}\`)` : ''}${r.code_repo ? ` · repo ${r.code_repo}` : ''}${commits ? ` · commit: ${commits}` : ''}${r.note ? ` · ${r.note}` : ''}`);
    }
    for (const r of [...claims].sort((a, b) => a.line - b.line)) {
      let cause = null;
      if (causes < MAX_CAUSES) {
        causes++;
        cause = causeOfClaim(opts.reposForCause || [repoFor(r.code_repo)], r);
      }
      L.push(`- riga ${r.line}${r.section ? ` (${r.section})` : ''}: ${r.kind} \`${r.claim}\` non trovato${r.code_repo ? ` in ${r.code_repo}` : ''}${cause ? ` · causato da ${cause}` : ''}`);
    }
    L.push('', '## Chi deve agire', '', `Agente del workspace \`${workspace}\`. Arch non applica la patch.`, '');
    L.push('## Cosa fare', '');
    L.push('1. Rileggere le righe elencate contro il codice attuale e correggere il doc (o togliere il riferimento).');
    if (rs.length) L.push('2. Per i link in deriva: `mr verify <doc>#<sezione>`, poi `--write` dopo la correzione (skill `mr-drift-review`).');
    L.push(`${rs.length ? 3 : 2}. Rilanciare \`mr scan\` sul doc: nessun segnale atteso.`, '');
    L.push('## Cosa non fare', '');
    L.push('- Non aggiornare `verified` senza aver letto il diff.');
    L.push('- Non cambiare il codice per far tornare vero il doc.');
    out.push(L.join('\n'));
  }
  return out.length ? out.join('\n\n---\n\n') : '';
}

/**
 * Giro (0.6-g): una segnalazione per doc con almeno un claim provato; tutti gli altri
 * not_found nell'appendice, una riga per claim, senza esito.
 * @returns {{ text: string, appendix: Array<{doc, line, kind, claim, reason}> }}
 */
function toSegnalazioniCausate(meta, records, repoFor, opts) {
  // repo in cui cercare la causa: quelli del doc (mappa del giro), o quelli dati, o quello del claim
  const repos = (r) => opts.reposForDoc?.(r.doc) || opts.reposForCause || [repoFor(r.code_repo)];
  const proved = new Map();
  const appendix = [];
  for (const r of records) {
    if (r.historical || r.status !== 'not_found') continue;
    if (!GIRO_KINDS.has(r.kind)) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'tipo fuori dal giro' });
      continue;
    }
    // le parole si cercano fuori dai code span (`src/tolto.ts` non dice che qualcosa è stato tolto)
    const prose = (t) => (t || '').replace(/`[^`]*`/g, ' ');
    const text = opts.lineText ? opts.lineText(r.doc, r.line) : '';
    // verbo di rimozione legato al nome (0.6-r; nella 0.6-q bastava il verbo sulla riga), «prima
    // [la whitelist] \`x\`», «(ex \`x\`)» (0.6-q, giro 4)
    const raw = opts.rawLine ? opts.rawLine(r.doc, r.line) : '';
    const par = opts.paragraph ? opts.paragraph(r.doc, r.line) : (raw ? { lines: [raw], at: 0 } : null);
    const esc = r.claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const verbo = raw ? verboLegato(par, r.claim, r.kind) : null;
    if (verbo) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: `storico: «${verbo}» riguarda questo nome`, verbo });
      continue;
    }
    // «Rebrand B.0 2026-04-24 da \`x\`» (0.6-r): il nome dopo «da» è quello vecchio, solo lui; un punto
    // dentro una sigla o una versione non chiude la frase
    if (raw && new RegExp(`\\brebrand\\w*\\b(?:[^.|]|\\.(?!\\s)){0,80}?\\bda\\s+\`${esc}\``, 'i').test(raw)) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'storico: «rebrand … da» davanti al nome' });
      continue;
    }
    if (raw && (new RegExp(`\\bprima\\s+(?:(?:il|la|lo|i|le|gli|l')\\s+)?(?:[\\wàèéìòù'-]+\\s+)?\`${esc}\``, 'i').test(raw)
      || new RegExp(`\\bex\\s+\`${esc}\``, 'i').test(raw))) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'storico: «prima» o «ex» davanti al nome' });
      continue;
    }
    if (NARRATIVE.test(prose(text))) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'storico: la riga racconta già la rimozione o il passato' });
      continue;
    }
    if (NARRATIVE_SECTION.test(prose(r.section))) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'storico: il titolo della sezione racconta la rimozione o il passato' });
      continue;
    }
    // rename documentato: `vecchio` → `nuovo` (0.6-k)
    const escClaim = r.claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`\`${escClaim}\`\\s*(→|->|=>)\\s*\``).test(text)) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'storico: la riga documenta il cambio di nome' });
      continue;
    }
    // riga di una tabella-registro (lavoro già fatto, con commit)
    const header = opts.tableHeader ? opts.tableHeader(r.doc, r.line) : '';
    if (header && LOG_HEADER.test(header) && COMMIT_IN_ROW.test(text)) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'storico: riga di un registro di lavoro fatto' });
      continue;
    }
    if (OPTION.test(prose(text))) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'opzione: la riga propone, non descrive' });
      continue;
    }
    if (PLANNED.test(prose(text))) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'planned: la riga lo dà come futuro' });
      continue;
    }
    // il doc dice che NON è quel nome (`non \`user_metadata\``): non è un'affermazione (0.6-j)
    // anche «né \`x\`», «né scorciatoia \`x\`», «nessun file \`x\`» (0.6-o). Dopo «non» niente parole in
    // mezzo: «non modificare \`x\`» è un'istruzione che presuppone x (vera nel giro 3)
    if (new RegExp(`(?:\\bnon\\s+|(?:^|[\\s(])né\\s+(?:[\\wàèéìòù'-]+\\s+)?|\\bnessun[ao]?\\s+(?:[\\wàèéìòù'-]+\\s+)?)\`${r.claim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``, 'i').test(text)) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'negato: la riga dice che non è questo nome' });
      continue;
    }
    if (EXAMPLE_LINE.test(prose(text)) || EXAMPLE_SECTION.test(prose(r.section))) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'esempio' });
      continue;
    }
    const cause = causeOfClaim(repos(r), r);
    if (!cause) {
      appendix.push({ doc: r.doc, line: r.line, kind: r.kind, claim: r.claim, reason: 'nessuna prova che sia esistito' });
      continue;
    }
    if (!proved.has(r.doc)) proved.set(r.doc, []);
    proved.get(r.doc).push({ ...r, cause });
  }
  const out = [];
  for (const [doc, claims] of [...proved.entries()].sort()) {
    const L = [];
    L.push(`# Segnalazione — ${doc}: ${claims.length} affermazioni non più vere`, '');
    L.push(`**Data:** ${opts.today || new Date().toISOString().slice(0, 10)}`);
    L.push(`**Workspace:** ${opts.workspace || meta.repo.toLowerCase()}`);
    L.push('**Tipo:** doc-stale');
    L.push(`**Severita:** ${claims.length >= 3 ? 'alta' : claims.length === 2 ? 'media' : 'bassa'}`);
    L.push('**Stato:** aperta', '');
    L.push('## Osservato', '');
    L.push(`Path letto (non modificato): \`${meta.repo}/${doc}\``, '');
    L.push(`Ogni riga ha la prova di deriva: il nome c'era nel codice al commit indicato e lì è sparito (\`${meta.tool}\`, sola lettura).`, '');
    for (const r of claims.sort((a, b) => a.line - b.line)) {
      L.push(`- riga ${r.line}${r.section ? ` (${r.section})` : ''}: ${r.kind} \`${r.claim}\` non trovato${r.code_repo ? ` in ${r.code_repo}` : ''} · causato da ${r.cause}`);
    }
    L.push('', '## Chi deve agire', '', `Agente del workspace \`${opts.workspace || meta.repo.toLowerCase()}\`. Arch non applica la patch.`, '');
    L.push('## Cosa fare', '', '1. Per ogni riga: guardare il commit indicato e correggere il doc (o togliere il riferimento).', '2. Rilanciare `mr claims` sul doc: nessun segnale atteso.', '');
    L.push('## Cosa non fare', '', '- Non cambiare il codice per far tornare vero il doc.');
    out.push(L.join('\n'));
  }
  return { text: out.join('\n\n---\n\n'), appendix };
}
