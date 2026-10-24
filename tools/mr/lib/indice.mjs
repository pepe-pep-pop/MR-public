/**
 * indice.mjs — l'indice dei workspace di arch (`_arch/segnalazioni/indice.md`), letto e mai scritto.
 * Usato dal giro e, dalla 0.6-z11, da `mr stato` (il workspace è nel giro?); dalla 0.6-z17 da
 * `mr indice` (stessi workspace e stessi repo del giro, `workspaceRepos` spostato qui da giro.mjs).
 */

import { gitSicuro } from '../../lib/git-sicuro.mjs';
import { existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { percorsoIUD } from './iud.mjs';

const MR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** posizione abituale dell'indice di arch sul Mac di il maintainer (0.6-z18) */
export const INDICE_GL = join(homedir(), 'Documents', 'GL', '_code', '_arch', 'segnalazioni', 'indice.md');

/**
 * Indice di default. Da un worktree della release (`git worktree add --detach <dir> v0.6.0-x`)
 * il percorso relativo non porta a _arch: si risale al clone principale con --git-common-dir (0.6-j).
 * Dalla copia di rilascio `~/.mr/rilascio` nessuno dei due porta a _arch (0.6-z18): prima
 * `MR_INDICE_ARCH`, poi la posizione abituale in GL.
 */
export function defaultIndice(root = MR_ROOT, env = process.env) {
  if (env.MR_INDICE_ARCH) return resolve(env.MR_INDICE_ARCH);
  const direct = resolve(root, '../../_arch/segnalazioni/indice.md');
  if (existsSync(direct)) return direct;
  try {
    const common = gitSicuro(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const viaClone = resolve(dirname(common), '../../_arch/segnalazioni/indice.md');
    if (existsSync(viaClone)) return viaClone;
  } catch {
    // non è un repo git
  }
  if (existsSync(INDICE_GL)) return INDICE_GL;
  return direct;
}

/** workspace dall'indice di arch: [{slug, gruppo, path, attivo, motivo}] */
export function parseIndice(text) {
  const archivio = new Set();
  const line = text.split('\n').find((l) => /^\*\*Archivio:\*\*/.test(l));
  if (line) for (const m of line.matchAll(/`([^`]+)`/g)) archivio.add(m[1]);
  const out = [];
  for (const l of text.split('\n')) {
    const m = l.match(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*`([^`]+)`\s*\|/);
    if (!m) continue;
    const [, slug, gruppo, path] = m;
    // IUD (0.6-z31): mai letto da giro, indice, stato
    const motivo = percorsoIUD(path) ? 'IUD: mai letto dagli strumenti MR' : archivio.has(slug) ? 'archivio' : gruppo === 'archivio' ? 'gruppo archivio' : null;
    out.push({ slug, gruppo, path, attivo: !motivo, motivo });
  }
  return out;
}

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.venv', 'vendor', 'Pods', 'DerivedData']);

function git(dir, args) {
  return gitSicuro(dir, [...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** repo da leggere per un workspace: [{root, dir}] (dir = cartella su cui lanciare claims) */
export function workspaceRepos(path) {
  const out = [];
  if (!existsSync(path)) return out;
  // repo che contiene la cartella, se la cartella non è la sua root e ha .md tracciati
  try {
    const top = git(path, ['rev-parse', '--show-toplevel']).trim();
    if (resolve(top) !== resolve(path)) {
      // contenitore esterno (es. il monorepo per monorepo/apps/lezioni): solo i suoi doc sotto la cartella
      if (git(path, ['ls-files', '--', '*.md']).trim()) out.push({ root: top, dir: path, outer: true });
    } else {
      out.push({ root: top, dir: path });
    }
  } catch {
    // non è dentro un repo git
  }
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const sub = join(d, e.name);
      if (existsSync(join(sub, '.git'))) out.push({ root: sub, dir: sub });
      walk(sub, depth + 1);
    }
  };
  walk(path, 1);
  return out;
}
