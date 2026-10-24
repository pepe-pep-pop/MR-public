/**
 * claims.mjs — claim check di uno o più doc (PRD v0.6 R5) e allow-list `mr.claims.ignore`.
 *
 * Allow-list: file `mr.claims.ignore` nella root del repo del codice. Una voce per riga,
 * `#` per i commenti. Forme ammesse:
 *   VITE_PUBLIC_URL          testo esatto del claim (o della sua chiave)
 *   env:VITE_*               solo per un tipo; `*` = qualunque sequenza
 *   docs/old/*.md            glob sul testo
 *   doc:docs/spec-altro/*    tutti i claim dei doc che corrispondono (doc che descrivono
 *                            un altro repo)
 *   storico:docs/piani/*     doc storici in più rispetto alle regole di default (nota A7)
 *   esterno:hs_*   # fonte   nomi che vivono fuori dal repo (0.6-f): un not_found che
 *                            corrisponde diventa `external`, metodo `dichiarato`
 *   codice:input-reference/* file e cartelle che non sono codice di questo repo (0.6-m): escono
 *                            dalla ricerca (claim, suggest-links, impact, coverage); un path
 *                            citato per intero resta trovato
 * Un claim in allow-list ha esito `ignored`. Con `mr claims --ignore-file <path>` l'allow-list
 * si legge da un file esterno (per i piloti in sola lettura sui repo degli altri).
 */

import { extractClaims } from './extract.mjs';
import { readFrontmatter, historicalReason } from './frontmatter.mjs';
import { checkClaim, prefetchClaims } from './check.mjs';

export const IGNORE_FILE = 'mr.claims.ignore';

function wildcardToRegex(pattern) {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`);
}

export function parseIgnore(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('#'))
    .map((raw) => {
      const fonte = (raw.match(/\s#\s*(.*)$/) || [])[1]?.trim();
      const l = raw.replace(/\s+#.*$/, '').trim();
      const m = l.match(/^(path|env|table|endpoint|command|symbol|identifier|doc|storico|esterno|codice|personali|registro):(.+)$/);
      if (m && m[1] === 'esterno') return { kind: 'esterno', re: wildcardToRegex(m[2]), ...(fonte ? { fonte } : {}) };
      return m ? { kind: m[1], re: wildcardToRegex(m[2]) } : { kind: null, re: wildcardToRegex(l) };
    })
    .filter((r) => r.re.source !== '^$');
}

/** Carica l'allow-list del repo (al commit della vista, se c'è). */
export function loadIgnore(repo) {
  if (!repo.hasFile(IGNORE_FILE)) return [];
  return parseIgnore(repo.readFile(IGNORE_FILE));
}

function isIgnored(rules, claim, docRel) {
  return rules.some((r) => {
    if (r.kind === 'storico' || r.kind === 'esterno' || r.kind === 'codice') return false;
    if (r.kind === 'doc') return r.re.test(docRel);
    return (!r.kind || r.kind === claim.kind) && (r.re.test(claim.text) || r.re.test(claim.key));
  });
}

// tipi di claim che possono vivere in un altro repo o in un sistema esterno (0.6-f)
const EXTERNAL_KINDS = new Set(['identifier', 'symbol', 'env', 'table']);

function declaredExternal(rules, claim) {
  return rules.find((r) => r.kind === 'esterno' && (r.re.test(claim.text) || r.re.test(claim.key)));
}

/** regex delle regole `codice:` (0.6-m) */
export function codeExcludes(rules) {
  return (rules || []).filter((r) => r.kind === 'codice').map((r) => r.re);
}

/**
 * Claim check di un doc.
 * @param {import('./repo.mjs').RepoView} repo - repo del codice (e del doc)
 * @param {string} docRel - path del doc relativo alla root del repo
 * @param {{ ignore?: Array, cache?: object }} [opts]
 * @returns {Array<object>} un record per claim
 */
export function checkDoc(repo, docRel, opts = {}) {
  return checkDocs(repo, [docRel], opts);
}

/**
 * Claim check di più doc dello stesso repo: estrae tutti i claim, prepara le ricerche
 * in blocco (prefetchClaims), poi decide ogni claim dalle risposte in memoria.
 */
const RANK = { found: 0, ambiguous: 1, not_found: 2 };

/**
 * @param {import('./repo.mjs').RepoView} docRepo - repo da cui si leggono i doc
 * @param {string[]} docRels
 * @param {{ ignore?: Array, codeRepos?: import('./repo.mjs').RepoView[],
 *           codeReposFor?: (docRel: string) => import('./repo.mjs').RepoView[] }} [opts]
 *        codeRepos: repo su cui si controllano i claim di tutti i doc (default: il repo dei doc);
 *        codeReposFor: repo per doc (mappa mr.repos.yaml, nota A9): un claim conta trovato
 *        solo nei repo del suo doc. Con più repo vale l'esito migliore (found > ambiguous >
 *        not_found); il record dice quale.
 *        externalReposFor: repo esterni per doc (mr.repos.yaml `esterni`, --external-repo):
 *        un not_found trovato lì diventa `external` (metodo `repo-esterno`).
 */
export function checkDocs(docRepo, docRels, opts = {}) {
  const rules = opts.ignore ?? loadIgnore(docRepo);
  const fixed = opts.codeRepos?.length ? opts.codeRepos : [docRepo];
  const reposFor = opts.codeReposFor ?? (() => fixed);
  const excl = codeExcludes(rules);
  const perDoc = docRels.map((d) => {
    const text = docRepo.readFile(d);
    const repos = reposFor(d);
    // cartelle che non sono codice (codice:<glob>): fuori dalla ricerca in tutti i repo del doc
    for (const r of repos) r.excludeCode(excl);
    return [d, extractClaims(text), historicalReason(d, readFrontmatter(text), rules), repos];
  });

  // prefetch per repo, con i soli claim dei doc mappati su quel repo
  const caches = new Map();
  const claimsByRepo = new Map();
  for (const [d, cs, , repos] of perDoc) {
    const active = cs.filter((c) => !isIgnored(rules, c, d));
    for (const r of repos) {
      if (!claimsByRepo.has(r.root)) claimsByRepo.set(r.root, { repo: r, claims: [] });
      claimsByRepo.get(r.root).claims.push(...active);
    }
  }
  for (const { repo, claims } of claimsByRepo.values()) {
    const cache = {};
    prefetchClaims(repo, claims, cache);
    caches.set(repo.root, cache);
  }

  const externalFor = opts.externalReposFor ?? (() => []);
  const out = [];
  const pendingExternal = []; // [record, claim, docRel, repos esterni]
  for (const [docRel, claims, historical, repos] of perDoc) {
    for (const claim of claims) {
      const base = { doc: docRel, line: claim.line, section: claim.section, kind: claim.kind, claim: claim.text, key: claim.key };
      // doc storici (nota A7): esiti calcolati, ma nessun segnale doc-stale
      if (historical) base.historical = historical;
      if (isIgnored(rules, claim, docRel)) {
        out.push({ ...base, status: 'ignored', method: 'allow-list', evidence: [] });
        continue;
      }
      let best = null;
      for (const r of repos) {
        const res = checkClaim(r, claim, docRel, caches.get(r.root), r.root === docRepo.root);
        if (!best || RANK[res.status] < RANK[best.res.status]) best = { res, repo: r };
      }
      const extra = repos.length > 1 || best.repo.root !== docRepo.root ? { code_repo: best.repo.root.split('/').pop() } : {};
      const rec = { ...base, ...best.res, ...extra };
      out.push(rec);
      if (rec.status !== 'not_found' || !EXTERNAL_KINDS.has(claim.kind)) continue;
      const decl = declaredExternal(rules, claim);
      if (decl) {
        Object.assign(rec, { status: 'external', method: 'dichiarato', evidence: [], ...(decl.fonte ? { note: decl.fonte } : {}) });
        continue;
      }
      const ext = externalFor(docRel).filter((r) => !repos.some((x) => x.root === r.root));
      if (ext.length) pendingExternal.push([rec, claim, docRel, ext]);
    }
  }
  resolveExternal(pendingExternal);
  return out;
}

/** not_found da cercare nei repo esterni: ricerche in blocco per repo, poi esito */
function resolveExternal(pending) {
  if (!pending.length) return;
  const byRepo = new Map();
  for (const [, claim, , ext] of pending) {
    for (const r of ext) {
      if (!byRepo.has(r.root)) byRepo.set(r.root, { repo: r, claims: [], cache: {} });
      byRepo.get(r.root).claims.push(claim);
    }
  }
  for (const b of byRepo.values()) prefetchClaims(b.repo, b.claims, b.cache);
  for (const [rec, claim, docRel, ext] of pending) {
    for (const r of ext) {
      const res = checkClaim(r, claim, docRel, byRepo.get(r.root).cache, false);
      if (res.status !== 'found') continue;
      Object.assign(rec, { status: 'external', method: 'repo-esterno', evidence: res.evidence, external_repo: r.root.split('/').pop() });
      break;
    }
  }
}

/**
 * Conteggi. I not_found e gli ambiguous dei doc storici vanno in `historical_*` e non
 * contano per l'exit code (nota A7).
 */
export function summarize(records) {
  const counts = { found: 0, not_found: 0, ambiguous: 0, ignored: 0, historical_not_found: 0, historical_ambiguous: 0 };
  for (const r of records) {
    const key = r.historical && (r.status === 'not_found' || r.status === 'ambiguous') ? `historical_${r.status}` : r.status;
    counts[key] = (counts[key] || 0) + 1;
  }
  return { total: records.length, ...counts };
}
