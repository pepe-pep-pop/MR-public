/**
 * discover.mjs — raccolta dei file .md con esclusioni di default (MR v0.5.1)
 *
 * Usato da mr-validate e mr-scanner. Solo moduli built-in di Node.
 *
 * Esclusioni sempre attive (anche su file tracciati):
 *   - cartelle: node_modules, .git, dist, build
 *   - cartelle nascoste (nome che inizia con ".")
 *   - sotto-cartelle che contengono un proprio .git (repo annidati)
 *   - file e cartelle ignorati dal .gitignore del repo che li contiene
 *
 * Strategia:
 *   - se la directory sta dentro un repo git → `git ls-files --cached --others
 *     --exclude-standard` (semantica esatta del .gitignore, nessuna dipendenza;
 *     git non entra nei repo annidati), poi filtro per nome delle cartelle escluse;
 *   - altrimenti → walk del filesystem con le stesse esclusioni per nome e lo
 *     stop sui repo annidati. Fuori da un repo un .gitignore non ha effetto.
 *
 * Un file passato esplicitamente come argomento non viene filtrato: è una scelta
 * esplicita di chi lancia il comando.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative, sep, extname } from 'node:path';

export const DEFAULT_EXCLUDED_DIRS = ['node_modules', '.git', 'dist', 'build'];

/**
 * Root del repo git che contiene `dir`, oppure null.
 * Si ferma al primo antenato con `.git` (cartella o file, per worktree e submodule).
 */
export function findRepoRoot(dir) {
  let current = resolve(dir);
  while (true) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) return null;
    current = parent;
  }
}

function isExcludedDirName(name, extraExcluded) {
  return (
    name.startsWith('.') ||
    DEFAULT_EXCLUDED_DIRS.includes(name) ||
    extraExcluded.includes(name)
  );
}

/** true se un segmento di cartella del path relativo è escluso */
export function hasExcludedSegment(relPath, extraExcluded = []) {
  const parts = relPath.split(/[\\/]/);
  parts.pop(); // il nome del file non conta
  return parts.some((p) => isExcludedDirName(p, extraExcluded));
}

function listViaGit(absDir, repoRoot, extraExcluded) {
  let out;
  try {
    out = execFileSync(
      'git',
      ['-C', absDir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch {
    return null; // git assente o errore: si ripiega sul walk
  }
  const files = [];
  for (const rel of out.split('\0')) {
    if (!rel || extname(rel) !== '.md') continue;
    if (hasExcludedSegment(rel, extraExcluded)) continue;
    const abs = join(absDir, rel);
    // ls-files --cached elenca anche file cancellati dal working tree
    if (!existsSync(abs)) continue;
    // difesa: niente file dentro repo annidati (git normalmente non li elenca)
    if (insideNestedRepo(abs, repoRoot)) continue;
    files.push(abs);
  }
  return files.sort();
}

/** true se tra repoRoot (escluso) e il file c'è una cartella con un proprio .git */
function insideNestedRepo(absFile, repoRoot) {
  const rel = relative(repoRoot, absFile).split(sep);
  rel.pop();
  let current = repoRoot;
  for (const part of rel) {
    current = join(current, part);
    if (existsSync(join(current, '.git'))) return true;
  }
  return false;
}

function listViaWalk(absDir, extraExcluded) {
  const files = [];
  const walk = (dir, isRoot) => {
    if (!isRoot && existsSync(join(dir, '.git'))) return; // repo annidato
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isExcludedDirName(entry.name, extraExcluded)) walk(p, false);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(p);
      }
    }
  };
  walk(absDir, true);
  return files.sort();
}

/**
 * Tutti i .md sotto `dir`, con le esclusioni di default.
 *
 * @param {string} dir
 * @param {{ extraExcludedDirs?: string[] }} [opts] - nomi di cartella in più da saltare
 *        (es. lo scanner salta `test-files`)
 * @returns {string[]} path assoluti, ordinati
 */
export function listMarkdownFiles(dir, opts = {}) {
  const extra = opts.extraExcludedDirs || [];
  const absDir = resolve(dir);
  const repoRoot = findRepoRoot(absDir);
  if (repoRoot) {
    const viaGit = listViaGit(absDir, repoRoot, extra);
    if (viaGit) return viaGit;
  }
  return listViaWalk(absDir, extra);
}

/**
 * Espande gli argomenti CLI (file o directory) in una lista di .md.
 * I file espliciti passano senza filtri; le directory passano da listMarkdownFiles.
 *
 * @param {string[]} args
 * @param {{ extraExcludedDirs?: string[], onMissing?: (arg: string) => void }} [opts]
 * @returns {string[]}
 */
export function collectMarkdownArgs(args, opts = {}) {
  const files = new Set();
  for (const arg of args) {
    const abs = resolve(arg);
    if (!existsSync(abs)) {
      if (opts.onMissing) opts.onMissing(arg);
      continue;
    }
    const st = statSync(abs);
    if (st.isFile()) {
      if (extname(abs) === '.md') files.add(abs);
    } else if (st.isDirectory()) {
      for (const f of listMarkdownFiles(abs, opts)) files.add(f);
    }
  }
  return [...files];
}
