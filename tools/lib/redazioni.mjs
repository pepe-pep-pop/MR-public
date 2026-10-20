/**
 * redazioni.mjs — controllo degli sha di `mr.redazioni` (MR 0.6-z8).
 *
 * `mr.redazioni` dichiara i commit di sola redazione (`<sha>`) e i commit d'importazione
 * (`import: <sha>`). Se uno sha non c'è più nel repo (dopo una riscrittura della storia) o è
 * ambiguo, `mr date` smetteva in silenzio di applicare la regola: caso portale-b del 17/10, 37 doc
 * con le date sbagliate invece di 7. Ora è un errore esplicito di `mr date` e di `mr-validate`, con
 * il nome del file, la riga e lo sha.
 *
 * Usato da tools/mr (date) e da mr-validate. Sola lettura: `git rev-parse` e `git cat-file`.
 */

import { gitSicuro } from './git-sicuro.mjs';

function git(root, args) {
  try {
    return { ok: true, out: gitSicuro(root, [...args], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

/** commit che hanno quel prefisso (0, 1 o più) */
function commitConPrefisso(root, sha) {
  const r = git(root, ['rev-parse', '--disambiguate=' + sha]);
  if (!r.ok || !r.out) return [];
  return r.out.split('\n').filter((h) => git(root, ['cat-file', '-t', h]).out === 'commit');
}

/**
 * sha di mr.redazioni (righe `<sha>` e `import: <sha>`) che non si risolvono in un solo commit
 * @param {string} root - radice del repo git
 * @param {string} testo - contenuto di mr.redazioni
 * @param {string} [nome] - nome del file, per i messaggi
 * @returns {string[]} messaggi d'errore, vuoto se tutto si risolve
 */
export function shaNonRisolti(root, testo, nome = 'mr.redazioni') {
  const errori = [];
  testo.split(/\r?\n/).forEach((raw, i) => {
    const l = raw.replace(/(^|\s)#(\s.*)?$/, '').trim();
    const m = l.match(/^(?:import\s*:\s*)?([0-9a-f]{7,40})$/i);
    if (!m) return;
    const tipo = /^import/i.test(l) ? 'import' : 'redazione';
    const trovati = commitConPrefisso(root, m[1].toLowerCase());
    if (trovati.length === 0) errori.push(`${nome}, riga ${i + 1}: lo sha ${tipo} «${m[1]}» non esiste nel repo (storia riscritta? aggiorna lo sha, o togli la riga)`);
    else if (trovati.length > 1) errori.push(`${nome}, riga ${i + 1}: lo sha ${tipo} «${m[1]}» è ambiguo (${trovati.length} commit): scrivine più caratteri`);
  });
  return errori;
}
