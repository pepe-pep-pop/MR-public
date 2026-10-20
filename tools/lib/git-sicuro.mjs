/**
 * git-sicuro.mjs — ogni chiamata dei tool MR a git (0.6-z13, R4 di report/sicurezza-2026-10-18.md).
 *
 * MR lancia git dentro repo che non sono suoi. Alcune chiavi di configurazione fanno eseguire un
 * comando a git, e un repo ricevuto come cartella o archivio può portarle nel suo `.git/config`:
 * - `core.fsmonitor` (status, diff, ls-files);
 * - `diff.external` e i driver `diff.<x>.command` / `textconv` (diff, log, show);
 * - `core.pager`;
 * - `log.showSignature` con `gpg.program` (log, show).
 * Qui le si spegne dalla riga di comando, che vince su ogni file di configurazione. Ai comandi che
 * producono diff si aggiungono `--no-ext-diff --no-textconv`. Nell'ambiente: niente configurazione
 * di sistema (`GIT_CONFIG_NOSYSTEM`), niente pager, niente prompt, niente diff esterno
 * dall'ambiente. La configurazione globale dell'utente resta valida, perché è sua.
 *
 * Solo moduli built-in di Node. Usato da tools/mr, mr-validate e mr-scanner.
 */

import { execFileSync } from 'node:child_process';

export const CONFIG_SICURA = [
  '-c', 'core.fsmonitor=false',
  '-c', 'diff.external=',
  '-c', 'core.pager=cat',
  '-c', 'log.showSignature=false',
  '-c', 'protocol.ext.allow=never',
];

// sottocomandi che producono o calcolano diff: qui driver esterni e textconv restano spenti
const CON_DIFF = new Set(['diff', 'log', 'show']);

/** argomenti completi: `-C <root>`, la configurazione sicura, il sottocomando con i flag di diff */
export function argsGit(root, args) {
  const [sub, ...resto] = args;
  const diff = CON_DIFF.has(sub) ? ['--no-ext-diff', '--no-textconv'] : [];
  return ['-C', root, ...CONFIG_SICURA, sub, ...diff, ...resto];
}

/** ambiente del processo git: quello dell'utente, senza configurazione di sistema, pager e prompt */
export function envGit() {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
  delete env.GIT_EXTERNAL_DIFF;
  return env;
}

/** execFileSync di git con argomenti e ambiente sicuri; le opzioni sono quelle di execFileSync */
export function gitSicuro(root, args, opzioni = {}) {
  return execFileSync('git', argsGit(root, args), { ...opzioni, env: envGit() });
}
