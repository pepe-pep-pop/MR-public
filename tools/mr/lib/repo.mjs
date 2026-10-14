/**
 * repo.mjs — vista in sola lettura di un repo git, nel working tree o a un commit.
 *
 * Tutto passa da git: `ls-files` / `ls-tree` per l'elenco, `show` per leggere a un
 * commit, `grep` per cercare. Nessun checkout, nessuna scrittura: si può usare sui
 * repo degli altri workspace (regole dell'agente, CLAUDE.md).
 *
 * Sicurezza (PRD v0.6 N4):
 *   - non si leggono mai `.env*` (eccetto .env.example/.sample/.template), `*.pem`,
 *     `*.key`, file con SECRET o SEGRETI nel nome: readFile li rifiuta;
 *   - grep li esclude sempre, e non restituisce mai il contenuto delle righe:
 *     solo path e numero di riga.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { findRepoRoot, hasExcludedSegment } from '../../lib/discover.mjs';

const ENV_EXAMPLE = /(^|\/)\.env\.(example|sample|template)$/;

/** true se il path non va mai letto (segreti) */
export function isSecretPath(relPath) {
  const base = relPath.split('/').pop();
  if (ENV_EXAMPLE.test(relPath)) return false;
  if (/^\.env(\.|$)/.test(base)) return true;
  if (/\.(pem|key)$/i.test(base)) return true;
  if (/SECRET|SEGRETI/i.test(base)) return true;
  return false;
}

// Esclusioni della ricerca nel codice: doc, lockfile, cartelle di build, segreti.
// Le cartelle nascoste sono escluse tranne .github (workflow CI = codice).
const GREP_EXCLUDES = [
  ':(exclude,glob)**/*.md',
  ':(exclude,glob)**/*.mdx',
  ':(exclude,glob)**/node_modules/**',
  ':(exclude,glob)**/dist/**',
  ':(exclude,glob)**/build/**',
  ':(exclude,glob)**/package-lock.json',
  ':(exclude,glob)**/pnpm-lock.yaml',
  ':(exclude,glob)**/yarn.lock',
  ':(exclude,glob)**/bun.lockb',
  ':(exclude,glob)**/.env',
  ':(exclude,glob)**/.env.*',
  ':(exclude,glob)**/*.pem',
  ':(exclude,glob)**/*.key',
  ':(exclude,glob)**/*SECRET*',
  ':(exclude,glob)**/*secret*',
  ':(exclude,glob)**/*SEGRETI*',
  ':(exclude,glob)**/*segreti*',
];
const ENV_EXAMPLE_SPECS = [
  ':(glob)**/.env.example',
  ':(glob)**/.env.sample',
  ':(glob)**/.env.template',
];

export class RepoView {
  /**
   * @param {string} root - root del repo git
   * @param {string|null} rev - commit da leggere; null = working tree
   */
  constructor(root, rev = null) {
    this.root = resolve(root);
    this.rev = rev;
    this._files = null;
    this._fileSet = null;
    this._dirs = null;
    this._allDirs = null;
    this._filtered = null;
    this.codeExcludes = [];
  }

  /**
   * Cartelle o file da non trattare come codice di questo repo (0.6-m, `codice:<glob>` in
   * mr.claims.ignore o nell'allow-list centrale): spariscono da listFiles, listDirs e dalle
   * ricerche. Un path esatto (hasFile/hasDir) resta vero: se un doc lo nomina per intero, esiste.
   * @param {RegExp[]} regexes
   */
  excludeCode(regexes) {
    const nuove = (regexes || []).filter((r) => !this.codeExcludes.some((x) => x.source === r.source));
    if (!nuove.length) return this;
    this.codeExcludes = [...this.codeExcludes, ...nuove];
    this._filtered = null;
    this._dirs = null;
    return this;
  }

  isExcludedCode(relPath) {
    return this.codeExcludes.some((r) => r.test(relPath));
  }

  /** RepoView del repo che contiene `path` (file o cartella), o null */
  static forPath(path, rev = null) {
    const abs = resolve(path);
    const start = existsSync(abs) && statSync(abs).isFile() ? join(abs, '..') : abs;
    const root = findRepoRoot(start);
    return root ? new RepoView(root, rev) : null;
  }

  git(args, opts = {}) {
    return execFileSync('git', ['-C', this.root, ...args], {
      encoding: 'utf-8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', opts.quiet === false ? 'inherit' : 'ignore'],
    });
  }

  /** come git(), con input su stdin */
  gitInput(args, input) {
    return execFileSync('git', ['-C', this.root, ...args], {
      encoding: 'utf-8',
      input,
      maxBuffer: 512 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  }

  /** path (tra quelli dati) che git ignorerebbe: una sola chiamata */
  ignoredSet(relPaths) {
    // check-ignore fallisce (128) su path fuori dal repo: si chiedono solo quelli dentro
    relPaths = relPaths.filter((p) => p && !p.startsWith('/') && !p.split('/').includes('..'));
    if (!relPaths.length) return new Set();
    try {
      const out = this.gitInput(['check-ignore', '--stdin', '--no-index'], relPaths.join('\n') + '\n');
      return new Set(out.split('\n').filter(Boolean));
    } catch (err) {
      if (err.status === 1) return new Set(); // nessuno ignorato
      throw err;
    }
  }

  /**
   * Ricerca in blocco con -o: una sola esecuzione di git grep per molti pattern.
   * Ritorna [{path, line, match}] dove match è il testo trovato (solo la parte che
   * corrisponde al pattern, mai il resto della riga).
   * @param {string[]} patterns
   * @param {{fixed?: boolean, word?: boolean, ignoreCase?: boolean, paths?: string[]}} opts
   */
  grepMatches(patterns, opts = {}) {
    if (!patterns.length) return [];
    const hits = [];
    const passes = opts.paths
      ? [[...opts.paths, ...GREP_EXCLUDES]]
      : [['.', ...GREP_EXCLUDES], ENV_EXAMPLE_SPECS];
    for (const specs of passes) {
      const args = ['grep', '-z', '-n', '-o', '-I', '--no-color'];
      if (!this.rev) args.push('--untracked');
      args.push(opts.fixed ? '-F' : '-E');
      if (opts.word) args.push('-w');
      if (opts.ignoreCase) args.push('-i');
      args.push('-f', '-');
      if (this.rev) args.push(this.rev);
      args.push('--', ...specs);
      let out = '';
      try {
        out = this.gitInput(args, patterns.join('\n') + '\n');
      } catch (err) {
        if (err.status === 1) continue;
        throw err;
      }
      const prefix = this.rev ? `${this.rev}:` : '';
      for (const rec of out.split('\n')) {
        if (!rec) continue;
        const [pathPart, lineNo, match] = rec.split('\0');
        if (!lineNo || match === undefined) continue;
        const path = prefix && pathPart.startsWith(prefix) ? pathPart.slice(prefix.length) : pathPart;
        if (isSecretPath(path)) continue;
        if (path.split('/').slice(0, -1).some((x) => x.startsWith('.') && x !== '.github')) continue;
        if (this.isExcludedCode(path)) continue;
        hits.push({ path, line: Number(lineNo), match });
      }
    }
    return hits;
  }

  /**
   * Legge più file in una volta (al commit con `git cat-file --batch`). I file con
   * segreti non si leggono. Ritorna Map path → contenuto.
   */
  readFiles(relPaths) {
    const wanted = [...new Set(relPaths)].filter((p) => !isSecretPath(p));
    const out = new Map();
    if (!this.rev) {
      for (const p of wanted) {
        try {
          out.set(p, readFileSync(join(this.root, p), 'utf-8'));
        } catch {
          // file sparito nel frattempo: si salta
        }
      }
      return out;
    }
    if (!wanted.length) return out;
    const buf = execFileSync('git', ['-C', this.root, 'cat-file', '--batch'], {
      input: wanted.map((p) => `${this.rev}:${p}`).join('\n') + '\n',
      maxBuffer: 1024 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let pos = 0;
    for (const p of wanted) {
      const nl = buf.indexOf(10, pos);
      const header = buf.subarray(pos, nl).toString('utf-8');
      pos = nl + 1;
      const m = header.match(/^\S+ (\S+) (\d+)$/);
      if (!m) continue; // "missing"
      const size = Number(m[2]);
      if (m[1] === 'blob') out.set(p, buf.subarray(pos, pos + size).toString('utf-8'));
      pos += size + 1;
    }
    return out;
  }

  /** verifica che rev esista; risolve l'hash corto */
  resolveRev() {
    if (!this.rev) return null;
    return this.git(['rev-parse', '--verify', '--short', `${this.rev}^{commit}`]).trim();
  }

  /** path relativo alla root (con /) */
  rel(absPath) {
    return relative(this.root, resolve(absPath)).split(sep).join('/');
  }

  /** elenco dei file (tracciati; nel working tree anche i non tracciati non ignorati) */
  listFiles() {
    if (this._files) return this._visibleFiles();
    const out = this.rev
      ? this.git(['ls-tree', '-r', '-z', '--name-only', this.rev])
      : this.git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    this._files = out
      .split('\0')
      .filter(Boolean)
      .filter((p) => (this.rev ? true : existsSync(join(this.root, p))));
    this._fileSet = new Set(this._files);
    return this._visibleFiles();
  }

  _visibleFiles() {
    if (!this.codeExcludes.length) return this._files;
    this._filtered ??= this._files.filter((p) => !this.isExcludedCode(p));
    return this._filtered;
  }

  /** insieme delle cartelle che contengono almeno un file */
  listDirs() {
    if (this._dirs) return this._dirs;
    const dirs = new Set();
    for (const f of this.listFiles()) {
      const parts = f.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    this._dirs = dirs;
    return dirs;
  }

  hasFile(relPath) {
    this.listFiles();
    if (this._fileSet.has(relPath)) return true;
    // nel working tree contano anche i file presenti su disco ma ignorati (es. output di build)
    return !this.rev && existsSync(join(this.root, relPath)) && statSync(join(this.root, relPath)).isFile();
  }

  hasDir(relPath) {
    const clean = relPath.replace(/\/+$/, '');
    if (!this._allDirs) {
      this.listFiles();
      this._allDirs = new Set();
      for (const f of this._files) {
        const parts = f.split('/');
        for (let i = 1; i < parts.length; i++) this._allDirs.add(parts.slice(0, i).join('/'));
      }
    }
    if (this._allDirs.has(clean)) return true;
    return !this.rev && existsSync(join(this.root, clean)) && statSync(join(this.root, clean)).isDirectory();
  }

  /** true se git ignorerebbe il path (regole .gitignore attuali) */
  isIgnored(relPath) {
    try {
      this.git(['check-ignore', '-q', '--no-index', relPath]);
      return true;
    } catch {
      return false;
    }
  }

  /** legge un file (rifiuta i file con segreti) */
  readFile(relPath) {
    if (isSecretPath(relPath)) throw new Error(`lettura rifiutata (file con segreti): ${relPath}`);
    if (this.rev) return this.git(['show', `${this.rev}:${relPath}`]);
    return readFileSync(join(this.root, relPath), 'utf-8');
  }

  /** .md sotto un prefisso, con le esclusioni di default (per l'uso con --rev) */
  listMarkdownUnder(prefix) {
    const clean = prefix.replace(/\/+$/, '');
    return this.listFiles()
      .filter((f) => f.endsWith('.md'))
      .filter((f) => !clean || clean === '.' || f === clean || f.startsWith(clean + '/'))
      .filter((f) => !hasExcludedSegment(f))
      .sort();
  }

  /**
   * Cerca nel codice. Ritorna [{path, line}] (mai il contenuto della riga).
   * @param {string[]} patterns - uno o più pattern (in OR)
   * @param {{fixed?: boolean, word?: boolean, ignoreCase?: boolean, paths?: string[], limit?: number}} opts
   */
  grep(patterns, opts = {}) {
    const hits = [];
    // 1) il codice, con le esclusioni; 2) solo per la ricerca generale, i .env.example
    //    (esclusi dal primo giro dal pattern .env.*, che non ammette eccezioni)
    const passes = opts.paths
      ? [[...opts.paths, ...GREP_EXCLUDES]]
      : [['.', ...GREP_EXCLUDES], ENV_EXAMPLE_SPECS];
    for (const specs of passes) {
      const args = ['grep', '-z', '-n', '-I', '--no-color'];
      if (!this.rev) args.push('--untracked');
      args.push(opts.fixed ? '-F' : '-E');
      if (opts.word) args.push('-w');
      if (opts.ignoreCase) args.push('-i');
      for (const p of patterns) args.push('-e', p);
      if (this.rev) args.push(this.rev);
      args.push('--', ...specs);
      let out = '';
      try {
        out = this.git(args);
      } catch (err) {
        if (err.status === 1) continue; // nessun risultato
        throw err;
      }
      const prefix = this.rev ? `${this.rev}:` : '';
      for (const rec of out.split('\n')) {
        if (!rec) continue;
        const [pathPart, lineNo] = rec.split('\0');
        if (!lineNo) continue;
        const path = prefix && pathPart.startsWith(prefix) ? pathPart.slice(prefix.length) : pathPart;
        if (isSecretPath(path)) continue;
        if (path.split('/').slice(0, -1).some((s) => s.startsWith('.') && s !== '.github')) continue;
        if (this.isExcludedCode(path)) continue;
        hits.push({ path, line: Number(lineNo) });
        if (opts.limit && hits.length >= opts.limit) return hits;
      }
    }
    return hits;
  }
}
