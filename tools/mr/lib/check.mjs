/**
 * check.mjs — verifica dei claim sul repo (PRD v0.6 R5).
 *
 * Esiti: found | not_found | ambiguous (| ignored, assegnato da chi applica l'allow-list).
 * Ogni esito porta `method` (come è stato deciso, così si sa quanto fidarsi) ed
 * `evidence` (al massimo 3 posizioni path:riga, mai il contenuto delle righe).
 * Le ricerche nel codice passano da `Lookup` (lookup.mjs), che le fa in blocco.
 */

import { posix } from 'node:path';
import { Lookup, escapeRe } from './lookup.mjs';

const MAX_EVIDENCE = 3;

function result(status, method, evidence = [], note = '') {
  return { status, method, evidence: evidence.slice(0, MAX_EVIDENCE), ...(note ? { note } : {}) };
}

// ── path ────────────────────────────────────────────────────────────────────

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += '[^/]*';
    else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

export function checkPath(repo, claim, docRel, lookup, sameRepo = true) {
  const key = claim.key.replace(/^\.\//, '');
  const isDir = key.endsWith('/');
  const clean = key.replace(/\/+$/, '');
  const candidates = [clean];
  // relativo alla cartella del doc: ha senso solo se doc e codice stanno nello stesso repo
  const fromDoc = sameRepo ? posix.normalize(posix.join(posix.dirname(docRel), clean)) : null;
  if (fromDoc && !fromDoc.startsWith('..') && fromDoc !== clean) candidates.push(fromDoc);
  // path che contiene il nome del repo (ordini/server/…, monorepo/progetti/app-web/…):
  // vale quello che segue il nome
  const repoName = repo.root.split('/').pop();
  const segs = clean.split('/');
  const at = segs.lastIndexOf(repoName);
  if (at >= 0 && at < segs.length - 1) candidates.push(segs.slice(at + 1).join('/'));

  if (clean.includes('*')) {
    const res = candidates.map(globToRegex);
    const hits = repo.listFiles().filter((f) => res.some((r) => r.test(f)));
    return hits.length
      ? result('found', 'glob', hits.map((p) => ({ path: p })))
      : result('not_found', 'glob');
  }

  for (const c of candidates) {
    const how = c === clean ? '' : c === fromDoc ? '-from-doc' : '-repo-prefix';
    if (!isDir && repo.hasFile(c)) return result('found', `exists${how}`, [{ path: c }]);
    if (repo.hasDir(c)) return result('found', `exists-dir${how}`, [{ path: c + '/' }]);
  }

  const files = repo.listFiles();
  if (clean.includes('/')) {
    // suffisso su confine di segmento: docs che omettono un prefisso (es. supabase/)
    const suffix = '/' + clean;
    const fileHits = isDir ? [] : files.filter((f) => f.endsWith(suffix));
    const dirHits = [...repo.listDirs()].filter((d) => d.endsWith(suffix));
    const hits = [...fileHits, ...dirHits.map((d) => d + '/')];
    if (hits.length === 1) return result('found', 'suffix', [{ path: hits[0] }]);
    if (hits.length > 1) return result('ambiguous', 'suffix', hits.map((p) => ({ path: p })), 'più file corrispondono al suffisso');
    if (lookup.isIgnored(clean)) return result('ambiguous', 'gitignored', [], 'path ignorato da git: non verificabile');
    // due segmenti senza estensione: può essere owner/repo, un branch, un'etichetta
    const segs = clean.split('/');
    if (segs.length === 2 && !/\.\w+$/.test(segs[1])) {
      return result('ambiguous', 'two-segments', [], 'due segmenti senza estensione (owner/repo, branch?)');
    }
    return result('not_found', 'exists');
  }

  // solo nome di file: basta che esista un file con quel nome
  const base = files.filter((f) => f === clean || f.endsWith('/' + clean));
  if (base.length) return result('found', 'basename', base.map((p) => ({ path: p })));
  if (lookup.isIgnored(clean)) return result('ambiguous', 'gitignored', [], 'path ignorato da git: non verificabile');
  return result('not_found', 'basename');
}

// ── env ─────────────────────────────────────────────────────────────────────

export function checkEnv(lookup, claim) {
  const hits = lookup.word(claim.key);
  return hits.length ? result('found', 'grep-word', hits) : result('not_found', 'grep-word');
}

// ── symbol ──────────────────────────────────────────────────────────────────

export function checkSymbol(lookup, claim) {
  const defs = lookup.definition(claim.key);
  if (defs.length) return result('found', 'definition', defs);
  const sqlDefs = lookup.sqlDefinition(claim.key);
  if (sqlDefs.length) return result('found', 'definition-sql', sqlDefs);
  const uses = lookup.word(claim.key);
  if (uses.length) return result('ambiguous', 'usage-only', uses, 'usato ma senza definizione riconosciuta (libreria esterna?)');
  return result('not_found', 'definition');
}

// ── identifier ──────────────────────────────────────────────────────────────

// file che non contano come codice (stesse esclusioni di git grep, più i doc)
const NOT_CODE = /\.(md|mdx)$|(^|\/)(node_modules|dist|build)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$|(^|\/)\.env(\.|$)/i;

/**
 * Identificatore snake_case (0.6-e): parola intera nei file che non sono doc. Copre codice,
 * chiavi di output (outputFields dei custom code HubSpot, chiavi JSON) e colonne SQL.
 */
export function checkIdentifier(repo, lookup, claim) {
  if (!repo.listFiles().some((f) => !NOT_CODE.test(f))) {
    return result('ambiguous', 'no-code', [], 'nessun file di codice nel repo: non verificabile');
  }
  const schema = lookup.schemaWord(claim.key);
  if (schema.length) return result('found', 'schema', schema);
  const hits = lookup.word(claim.key);
  if (hits.length) return result('found', 'code-word', hits);
  // nome di un file senza estensione (es. email_templates/conferma_docente.html, 0.6-f)
  const stems = repo.listFiles().filter((f) => !NOT_CODE.test(f) && f.split('/').pop().replace(/\.[^.]+$/, '') === claim.key);
  return stems.length ? result('found', 'file-stem', stems.map((p) => ({ path: p }))) : result('not_found', 'word');
}

// ── table ───────────────────────────────────────────────────────────────────

export function isSchemaFile(path) {
  return (
    /\.(sql|prisma)$/.test(path) ||
    /(^|\/)migrations?\//.test(path) ||
    /(^|\/)(database|supabase|db)?[._-]?types\.ts$/.test(path) ||
    /(^|\/)schema\.(ts|js|py|rb)$/.test(path)
  );
}

export function checkTable(lookup, claim) {
  // 1) espressione presente così com'è nel codice (es. un campo usato in TS)
  const literal = lookup.literal(claim.key);
  if (literal.length) return result('found', 'literal', literal);

  if (!lookup.schemaFiles().length) {
    return result('ambiguous', 'no-schema', [], 'nessun file di schema/migration nel repo: non verificabile');
  }
  const last = claim.parts[claim.parts.length - 1];
  const first = claim.parts[0];
  const lastHits = lookup.schemaWord(last);
  if (!lastHits.length) return result('not_found', 'schema');
  const firstFiles = new Set(lookup.schemaWord(first).map((h) => h.path));
  const both = lastHits.filter((h) => firstFiles.has(h.path));
  if (both.length) return result('found', 'schema', both);
  return result('ambiguous', 'schema-partial', lastHits, `"${last}" c'è, "${first}" non nello stesso file`);
}

// ── endpoint ────────────────────────────────────────────────────────────────

/** prefissi fissi di un endpoint, dal più lungo al più corto ammesso */
export function endpointPrefixes(key) {
  const path = key.split(/[?#]/)[0];
  const staticSegs = [];
  for (const seg of path.split('/').filter(Boolean)) {
    if (/^[:{[<*]/.test(seg) || /[{}<>]/.test(seg)) break;
    staticSegs.push(seg);
  }
  const min = staticSegs.length === 1 ? 1 : Math.max(2, Math.ceil(staticSegs.length / 2));
  const out = [];
  for (let n = staticSegs.length; n >= min && n > 0; n--) out.push(staticSegs.slice(0, n));
  return { staticSegs, prefixes: out };
}

export function checkEndpoint(repo, claim, lookup) {
  const { staticSegs, prefixes } = endpointPrefixes(claim.key);
  if (!staticSegs.length) return result('ambiguous', 'no-static-path', [], 'path senza parte fissa');

  // edge function Supabase: /functions/v1/<nome>
  if (staticSegs[0] === 'functions' && staticSegs[1] === 'v1' && staticSegs[2]) {
    const dir = `supabase/functions/${staticSegs[2]}`;
    if (repo.hasDir(dir)) return result('found', 'edge-function', [{ path: dir + '/' }]);
    return result('not_found', 'edge-function');
  }

  // dal più lungo al più corto: con 1 segmento fisso serve quello; con 2 o più,
  // almeno 2 e almeno metà (un prefisso come /api da solo direbbe poco)
  for (const segs of prefixes) {
    const hits = lookup.literal('/' + segs.join('/'));
    if (hits.length) return result('found', segs.length === staticSegs.length ? 'route-literal' : 'route-prefix', hits);
    // routing per file (Next/SvelteKit/Astro, api/...)
    const routeDir = segs.join('/');
    const fileHit = repo.listFiles().find((f) => f.includes(`/${routeDir}/`) || f.startsWith(`${routeDir}/`));
    if (fileHit) return result('found', 'route-file', [{ path: fileHit }]);
  }
  return result('not_found', 'route');
}

// ── command ─────────────────────────────────────────────────────────────────

function packageScripts(repo) {
  const scripts = new Map(); // nome → [package.json]
  for (const f of repo.listFiles()) {
    if (!/(^|\/)package\.json$/.test(f) || f.split('/').includes('node_modules')) continue;
    try {
      const pkg = JSON.parse(repo.readFile(f));
      for (const name of Object.keys(pkg.scripts || {})) {
        if (!scripts.has(name)) scripts.set(name, []);
        scripts.get(name).push(f);
      }
    } catch {
      // package.json non valido: si ignora
    }
  }
  return scripts;
}

export function checkCommand(repo, claim, cache) {
  if (claim.runner === 'package.json') {
    cache.scripts ??= packageScripts(repo);
    const where = cache.scripts.get(claim.key);
    if (where) return result('found', 'package-script', where.map((p) => ({ path: p })));
    if (!repo.listFiles().some((f) => /(^|\/)package\.json$/.test(f))) {
      return result('not_found', 'package-script', [], 'nessun package.json nel repo');
    }
    return result('not_found', 'package-script');
  }
  if (claim.runner === 'make') {
    const makefiles = repo.listFiles().filter((f) => /(^|\/)(GNU)?[Mm]akefile$/.test(f));
    const target = new RegExp(`^${escapeRe(claim.key)}[ \\t]*:(?!=)`, 'm');
    for (const mf of makefiles) {
      if (target.test(repo.readFile(mf))) return result('found', 'make-target', [{ path: mf }]);
    }
    return result('not_found', 'make-target');
  }
  if (claim.runner === 'deno') {
    for (const f of repo.listFiles().filter((p) => /(^|\/)deno\.jsonc?$/.test(p))) {
      try {
        const cfg = JSON.parse(repo.readFile(f).replace(/^\s*\/\/.*$/gm, ''));
        if (cfg.tasks && claim.key in cfg.tasks) return result('found', 'deno-task', [{ path: f }]);
      } catch {
        // configurazione non valida: si ignora
      }
    }
    return result('not_found', 'deno-task');
  }
  return result('ambiguous', 'unknown-runner');
}

/**
 * Verifica un claim. `cache` è condiviso tra i claim dello stesso repo.
 */
export function checkClaim(repo, claim, docRel, cache = {}, sameRepo = true) {
  cache.lookup ??= new Lookup(repo, isSchemaFile);
  const lookup = cache.lookup;
  switch (claim.kind) {
    case 'path': return checkPath(repo, claim, docRel, lookup, sameRepo);
    case 'env': return checkEnv(lookup, claim);
    case 'symbol': return checkSymbol(lookup, claim);
    case 'table': return checkTable(lookup, claim);
    case 'endpoint': return checkEndpoint(repo, claim, lookup);
    case 'command': return checkCommand(repo, claim, cache);
    case 'identifier': return checkIdentifier(repo, lookup, claim);
    default: return result('ambiguous', 'unknown-kind');
  }
}

/**
 * Prepara in blocco le ricerche che serviranno ai claim (una manciata di git grep
 * invece di uno o più per claim).
 */
export function prefetchClaims(repo, claims, cache) {
  cache.lookup ??= new Lookup(repo, isSchemaFile);
  const q = { words: [], literals: [], defs: [], ignoredPaths: [] };
  for (const c of claims) {
    if (c.kind === 'env' || c.kind === 'identifier') q.words.push(c.key);
    else if (c.kind === 'symbol') q.defs.push(c.key);
    else if (c.kind === 'table') { q.literals.push(c.key); q.words.push(c.parts[0], c.parts[c.parts.length - 1]); }
    else if (c.kind === 'endpoint') for (const segs of endpointPrefixes(c.key).prefixes) q.literals.push('/' + segs.join('/'));
    else if (c.kind === 'path') q.ignoredPaths.push(c.key.replace(/^\.\//, '').replace(/\/+$/, ''));
  }
  cache.lookup.prefetch(q);
}
