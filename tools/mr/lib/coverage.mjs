/**
 * coverage.mjs — punti d'ingresso del codice che nessun doc cita (PRD v0.6 R9).
 *
 * Serve a trovare il codice non documentato, non a pretendere che sia documentato tutto.
 *
 * Punti d'ingresso di default:
 *   function   supabase/functions/<nome>/index.*, netlify/functions/*, api/**​/route.*, pages/api/**,
 *              src/routes/**​/+server.*            (nome = cartella o file)
 *   route      app|router|server.get/post/put/patch/delete/all('/path') nel codice
 *   migration  file sotto una cartella migrations/
 *   ci         .github/workflows/*.yml, file con «cron» nel path
 *   deploy     Dockerfile*, docker-compose*.yml, compose*.yml, deploy*.sh, scripts/deploy*, deploy/**​/*.sh
 *   env        nomi in .env.example (mai i valori)
 *
 * Configurazione per repo: `mr.coverage.yaml` nella root, con `exclude: [glob, …]`.
 *
 * Un punto è «citato» se un doc (non storico, non diario) lo nomina: path o nome in un code
 * span o in un titolo, oppure un link code_refs/ancora che lo copre.
 */

import { parse as parseYaml } from 'yaml';
import { readCodeRefs } from './coderefs.mjs';
import { readFrontmatter, historicalReason } from './frontmatter.mjs';

export const COVERAGE_FILE = 'mr.coverage.yaml';

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function stripExt(name) {
  return name.replace(/\.[^.]+$/, '');
}

// file di test: mai punti d'ingresso
const TEST_FILE = /(^|\/)(tests?|__tests__|fixtures?)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test-[^/]*\.[cm]?js$/;

/** punti d'ingresso del repo */
export function entryPoints(repo, excludes = []) {
  const ex = [...excludes.map(globToRegex), TEST_FILE];
  const files = repo.listFiles().filter((f) => !ex.some((r) => r.test(f)) && !f.split('/').includes('node_modules'));
  const out = [];
  const add = (kind, name, path, line) => out.push({ kind, name, path, ...(line ? { line } : {}) });

  for (const f of files) {
    const segs = f.split('/');
    const base = segs[segs.length - 1];
    let m;
    if ((m = f.match(/(?:^|\/)supabase\/functions\/([^/]+)\/index\.[cm]?[jt]sx?$/)) && !m[1].startsWith('_')) add('function', m[1], f);
    else if ((m = f.match(/(?:^|\/)netlify\/(?:edge-)?functions\/([^/]+?)(?:\/index)?\.[cm]?[jt]sx?$/))) add('function', m[1], f);
    else if ((m = f.match(/(?:^|\/)(?:app\/)?api\/(.+)\/route\.[cm]?[jt]sx?$/))) add('function', `/api/${m[1]}`, f);
    else if ((m = f.match(/(?:^|\/)pages\/api\/(.+?)\.[cm]?[jt]sx?$/))) add('function', `/api/${m[1].replace(/\/index$/, '')}`, f);
    else if ((m = f.match(/(?:^|\/)src\/routes\/(.*)\/\+server\.[jt]s$/))) add('function', `/${m[1]}`, f);
    if (/(?:^|\/)migrations\/[^/]+\.sql$/.test(f)) add('migration', stripExt(base), f);
    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /cron/i.test(f)) add('ci', base, f);
    if (/^Dockerfile/.test(base) || /^(docker-)?compose.*\.ya?ml$/.test(base) || /^deploy.*\.sh$/.test(base) || /(?:^|\/)scripts\/deploy/.test(f) || /(?:^|\/)deploy\/.+\.sh$/.test(f)) add('deploy', base, f);
    if (/(^|\/)\.env\.(example|sample|template)$/.test(f)) {
      try {
        repo.readFile(f).split('\n').forEach((l, i) => {
          const e = l.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
          if (e) add('env', e[1], f, i + 1);
        });
      } catch {
        // file non leggibile: si salta
      }
    }
  }
  // route nel codice (un solo grep in blocco)
  const hits = repo.grepMatches([`(app|router|server|api|hono|r)\\.(get|post|put|patch|delete|all)\\([[:space:]]*['"\`]/[^'"\`]*['"\`]`]);
  const seen = new Set();
  for (const h of hits) {
    if (ex.some((r) => r.test(h.path))) continue;
    const p = h.match.match(/\(\s*['"`](\/[^'"`]*)['"`]/);
    const method = (h.match.match(/\.(get|post|put|patch|delete|all)\(/) || [])[1];
    if (!p) continue;
    const key = `${method} ${p[1]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add('route', `${method.toUpperCase()} ${p[1]}`, h.path, h.line);
  }
  return out;
}

/** testo citato dai doc: code span, titoli, path dei link */
export function mentions(docRepo, docs, rules = []) {
  const spans = new Set();
  const refPaths = [];
  let used = 0;
  for (const d of docs) {
    const text = docRepo.readFile(d);
    if (historicalReason(d, readFrontmatter(text), rules)) continue;
    used++;
    for (const m of text.matchAll(/`([^`\n]{2,200})`/g)) spans.add(m[1].trim());
    for (const m of text.matchAll(/^#{1,6}\s+(.+)$/gm)) spans.add(m[1].trim());
    for (const r of readCodeRefs(text).refs) refPaths.push(r.path);
  }
  return { spans: [...spans], refPaths, docsUsed: used };
}

function isMentioned(ep, m) {
  if (m.refPaths.some((p) => (p.includes('*') ? globToRegex(p).test(ep.path) : ep.path === p || ep.path.startsWith(p.replace(/\/+$/, '') + '/') || ep.path.endsWith('/' + p)))) return 'link';
  const name = ep.name;
  for (const s of m.spans) {
    if (s === name || s === ep.path || s.endsWith('/' + ep.path) || ep.path.endsWith('/' + s)) return 'citato';
    if (ep.kind === 'route' && s.includes(name.split(' ')[1])) return 'citato';
    if (ep.kind !== 'route' && ep.kind !== 'env' && name.length >= 4) {
      // nome come parola dentro uno span più lungo (es. `supabase/functions/sync-gcal/`)
      const parts = s.split(/[\s/`'"()#,:]+/);
      if (parts.includes(name) || parts.includes(stripExt(name))) return 'citato';
    }
    if (ep.kind === 'env' && new RegExp(`(?:^|[^A-Z0-9_])${name}(?:[^A-Z0-9_]|$)`).test(s)) return 'citato';
  }
  return null;
}

export function loadCoverageConfig(repo) {
  if (!repo.hasFile(COVERAGE_FILE)) return { exclude: [] };
  const data = parseYaml(repo.readFile(COVERAGE_FILE), { schema: 'failsafe' }) || {};
  return { exclude: Array.isArray(data.exclude) ? data.exclude.map(String) : [] };
}

export function coverage(codeRepo, docRepo, docs, rules = []) {
  const cfg = loadCoverageConfig(codeRepo);
  const eps = entryPoints(codeRepo, cfg.exclude);
  const m = mentions(docRepo, docs, rules);
  return {
    docs_used: m.docsUsed,
    exclude: cfg.exclude,
    entries: eps.map((ep) => ({ ...ep, covered: isMentioned(ep, m) })),
  };
}
