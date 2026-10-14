/**
 * remote.mjs — deriva dei link verso repo non presenti in locale, via `gh api` (PRD v0.6 R10).
 *
 * Solo letture GET (repos/{o}/{r}, contents, compare), solo con `--remote` esplicito (N2).
 * Mai clone. Esiti come R3 (ok, drift, missing, unverified, unresolvable); niente `moved`
 * (servirebbe la ricerca nel repo remoto). Livelli `remote-regex`, `remote-occurrences`,
 * `remote-file`. Diff ridotto al simbolo e oscurato come in locale.
 *
 * `MR_GH_BIN` permette di sostituire `gh` (test senza rete).
 */

import { execFileSync } from 'node:child_process';
import { findSymbol, normalizeBody } from './symbols.mjs';
import { lineDiff, redactLine } from './drift.mjs';

const MAX_DIFF = 40;

function gh(args) {
  const bin = process.env.MR_GH_BIN || 'gh';
  return execFileSync(bin, ['api', ...args], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function is404(err) {
  return /404|Not Found/i.test(String(err.stderr || '') + String(err.message || ''));
}

export class RemoteRepos {
  constructor() {
    this.branches = new Map();
    this.contents = new Map();
  }

  defaultBranch(slug) {
    if (!this.branches.has(slug)) {
      try {
        this.branches.set(slug, gh([`repos/${slug}`, '--jq', '.default_branch']).trim() || null);
      } catch {
        this.branches.set(slug, null);
      }
    }
    return this.branches.get(slug);
  }

  /** contenuto del file a un ref; null se 404; lancia per altri errori */
  content(slug, path, ref) {
    const k = `${slug}|${path}|${ref}`;
    if (!this.contents.has(k)) {
      try {
        const enc = path.split('/').map(encodeURIComponent).join('/');
        this.contents.set(k, gh(['-H', 'Accept: application/vnd.github.raw', `repos/${slug}/contents/${enc}?ref=${encodeURIComponent(ref)}`]));
      } catch (err) {
        if (is404(err)) this.contents.set(k, null);
        else throw err;
      }
    }
    return this.contents.get(k);
  }

  /** commit tra due ref che toccano il path (dal compare) */
  commitsTouching(slug, from, to, path) {
    try {
      const out = gh([`repos/${slug}/compare/${from}...${to}`, '--jq', `[.commits[] | {hash: .sha[0:8], date: .commit.author.date[0:10]}] as $c | [.files[]?.filename] as $f | if ($f | index("${path.replace(/"/g, '')}")) then $c else [] end`]);
      return JSON.parse(out || '[]').slice(-10);
    } catch {
      return [];
    }
  }
}

function truncate(lines) {
  const red = lines.map(redactLine);
  return red.length > MAX_DIFF ? [...red.slice(0, MAX_DIFF), `… (${red.length - MAX_DIFF} righe omesse)`] : red;
}

/** valuta un link con repo: owner/nome su GitHub */
export function evaluateRemoteRef(ref, remote) {
  const base = {
    path: ref.path,
    ...(ref.symbol ? { symbol: ref.symbol } : {}),
    repo: ref.repo,
    ...(ref.verified ? { verified: ref.verified.commit } : {}),
    code_repo: `${ref.repo} (remoto)`,
  };
  if (ref.path.includes('*')) return { ...base, status: 'unresolvable', level: 'n/a', note: 'glob non supportati in remoto' };
  const branch = remote.defaultBranch(ref.repo);
  if (!branch) return { ...base, status: 'unresolvable', level: 'n/a', note: 'repo remoto non leggibile con gh (accesso o nome?)' };
  let head;
  try {
    head = remote.content(ref.repo, ref.path, branch);
  } catch (err) {
    return { ...base, status: 'unresolvable', level: 'n/a', note: `gh api: ${String(err.message).split('\n')[0]}` };
  }
  if (head === null) return { ...base, status: 'missing', level: 'remote-file', note: `file non presente su ${branch}` };
  const symHead = ref.symbol ? findSymbol(head, ref.symbol, ref.path) : null;
  if (ref.symbol && !symHead) return { ...base, status: 'missing', level: 'remote-file', note: `simbolo ${ref.symbol} non trovato su ${branch}` };
  const level = symHead ? `remote-${symHead.level}` : 'remote-file';
  if (!ref.verified) return { ...base, status: 'unverified', level };
  const old = remote.content(ref.repo, ref.path, ref.verified.commit);
  if (old === null) return { ...base, status: 'unresolvable', level, note: `commit ${ref.verified.commit} o file non presenti nel repo remoto` };
  if (symHead) {
    const symOld = findSymbol(old, ref.symbol, ref.path);
    if (symOld && normalizeBody(symOld.body) === normalizeBody(symHead.body)) return { ...base, status: 'ok', level };
    const diff = symOld ? lineDiff(normalizeBody(symOld.body), normalizeBody(symHead.body)) : ['@@ simbolo assente al commit verificato @@'];
    return { ...base, status: 'drift', level, commits: remote.commitsTouching(ref.repo, ref.verified.commit, branch, ref.path), diff: truncate(diff) };
  }
  if (old === head) return { ...base, status: 'ok', level };
  return { ...base, status: 'drift', level, commits: remote.commitsTouching(ref.repo, ref.verified.commit, branch, ref.path), diff: truncate(lineDiff(old, head)) };
}
