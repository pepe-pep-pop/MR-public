/**
 * iud.mjs — esclusione di IUD (MR 0.6-z31). Regola di il maintainer del 23/10, nel CLAUDE.md di GL: IUD è il
 * giudice degli agenti e nessuno strumento di MR legge `~/IUD` né i suoi transcript in
 * `~/.claude/projects/-Users-<utente>-IUD*`. Il controllo sta sui nomi e sui percorsi, prima di
 * qualunque lettura: nessun file di IUD viene aperto, nemmeno per contarlo.
 */
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';

/** cartella di progetto dei transcript di IUD (`-Users-<utente>-IUD`, anche con sottocartelle `-IUD-…`) */
export function progettoIUD(nome) {
  return /(^|-)IUD($|-)/.test(String(nome));
}

/** percorso dentro `~/IUD` */
export function percorsoIUD(p, home = homedir()) {
  const r = resolve(String(p));
  const base = resolve(home, 'IUD');
  return r === base || r.startsWith(base + sep);
}
