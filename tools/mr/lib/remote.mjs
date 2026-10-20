/**
 * remote.mjs — deriva dei link verso repo non presenti in locale, via `gh api` (PRD v0.6 R10).
 *
 * Solo letture GET (repos/{o}/{r}, contents, compare), solo con `--remote` esplicito (N2).
 * Mai clone. Esiti come R3 (ok, drift, missing, unverified, unresolvable); niente `moved`
 * (servirebbe la ricerca nel repo remoto). Livelli `remote-regex`, `remote-occurrences`,
 * `remote-file`. Diff ridotto al simbolo e oscurato come in locale.
 *
 * `MR_GH_BIN` permette di sostituire `gh` (test senza rete). Token in sola lettura (0.6-z13): vedi `ghEsegui`.
 */

import { execFileSync } from 'node:child_process';
import { findSymbol, normalizeBody } from './symbols.mjs';
import { lineDiff, redactLine } from './drift.mjs';

const MAX_DIFF = 40;

/**
 * Ogni chiamata di MR a `gh` passa da qui (0.6-z13, R8 del report di sicurezza). MR può usare un token
 * fine-grained in sola lettura al posto dell'autenticazione di `gh`, solo per i processi `gh` che
 * lancia lui: il token va come `GH_TOKEN` nell'ambiente del figlio e basta. Un token fine-grained vale
 * per un solo owner, quindi si cerca, in ordine:
 *   1. la variabile `MR_GH_TOKEN_<OWNER>` (owner in maiuscolo, ogni altro carattere in `_`);
 *   2. il portachiavi di macOS: servizio `mr-gh-token`, account = owner in minuscolo
 *      (lo carica `tools/mr/token-gh.sh`); `MR_GH_PORTACHIAVI=no` lo spegne (test, CI);
 *   3. la variabile `MR_GH_TOKEN`, valida per tutti gli owner;
 *   4. niente: `gh` usa la sua autenticazione, come prima della z13.
 * Il valore non si stampa mai, nemmeno negli errori: resta in memoria nel processo di MR.
 */
export const SERVIZIO_PORTACHIAVI = 'mr-gh-token';

/** nome della variabile del token di un owner: mia-org → MR_GH_TOKEN_MIA_ORG */
export function variabileOwner(owner) {
  return `MR_GH_TOKEN_${String(owner).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

const tokenInMemoria = new Map();

function dalPortachiavi(owner) {
  if (process.platform !== 'darwin' || process.env.MR_GH_PORTACHIAVI === 'no') return null;
  try {
    const t = execFileSync('/usr/bin/security', ['find-generic-password', '-s', SERVIZIO_PORTACHIAVI, '-a', owner.toLowerCase(), '-w'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return t || null;
  } catch {
    return null; // nessuna voce per questo owner
  }
}

/** token da usare per un owner (o null: autenticazione di gh); mai da stampare */
function tokenPer(owner) {
  const k = owner ? owner.toLowerCase() : '';
  if (!tokenInMemoria.has(k)) {
    const t = (owner && (process.env[variabileOwner(owner)] || dalPortachiavi(owner))) || process.env.MR_GH_TOKEN || null;
    tokenInMemoria.set(k, t);
  }
  return tokenInMemoria.get(k);
}

/** owner dagli argomenti di gh: `repos/<owner>/…` per gh api, `--repo <owner>/<repo>` per gh pr */
function ownerDegliArgomenti(args) {
  const i = args.indexOf('--repo');
  const slug = i >= 0 ? args[i + 1] : args.find((a) => typeof a === 'string' && a.startsWith('repos/'))?.slice('repos/'.length);
  const owner = slug && slug.split('/')[0];
  return owner && /^[A-Za-z0-9_.-]+$/.test(owner) ? owner : null;
}

/** opzioni di execFileSync; `autenticazioneGh: true` salta il token di MR (solo per risolvere un nome) */
export function ghEsegui(args, opzioni = {}) {
  const { autenticazioneGh, ...resto } = opzioni;
  const token = autenticazioneGh ? null : tokenPer(ownerDegliArgomenti(args));
  const env = token ? { ...process.env, GH_TOKEN: token } : process.env;
  return execFileSync(process.env.MR_GH_BIN || 'gh', args, { encoding: 'utf-8', ...resto, env });
}

/**
 * Nome attuale di un repo trasferito o rinominato (0.6-z16): GitHub reindirizza il nome vecchio, ma
 * un token fine-grained del vecchio owner non vede il repo nel nuovo. Si chiede solo `full_name`, con
 * l'autenticazione di gh (una GET di metadati, come prima della z14). null se non si risolve.
 */
export function nomeCanonico(slug) {
  try {
    const n = ghEsegui(['api', `repos/${slug}`, '--jq', '.full_name'], { stdio: ['ignore', 'pipe', 'ignore'], autenticazioneGh: true }).trim();
    return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(n) ? n : null;
  } catch {
    return null;
  }
}

function gh(args) {
  return ghEsegui(['api', ...args], { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
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
