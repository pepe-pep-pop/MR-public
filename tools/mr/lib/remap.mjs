/**
 * remap.mjs — riancorare i `verified` dopo una riscrittura della storia (PRD v0.6, nota A16).
 *
 * `git filter-repo` scrive in `.git/filter-repo/commit-map` una riga per commit:
 *     old                                      new
 *     <sha vecchio, 40 hex> <sha nuovo, 40 hex>
 * (sha nuovo tutto zeri = commit eliminato dalla riscrittura).
 *
 * Esiti per ogni link con verified:
 *   presente     il commit esiste ancora nel repo del codice: niente da fare
 *   esatto       trovato nella commit-map, il nuovo commit esiste: si può applicare con --write
 *   eliminato    la riscrittura ha tolto il commit: va riverificato (mr verify)
 *   ambiguo      l'hash corto corrisponde a più commit della mappa
 *   ripiego      non nella mappa: candidati per data (verified.date) + file; si applica solo
 *                con --accept-fallback e un candidato unico, mai da solo
 *   non_trovato  né mappa né ripiego possibile
 */

import { readCodeRefs } from './coderefs.mjs';
import { redactLine } from './drift.mjs';
import { commitDate } from './verify.mjs';

const ZERO = /^0{40}$/;

export function parseCommitMap(text) {
  const map = new Map();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^([0-9a-f]{40})\s+([0-9a-f]{40})$/i);
    if (m) map.set(m[1].toLowerCase(), m[2].toLowerCase());
  }
  return map;
}

function commitExists(repo, c) {
  try {
    repo.git(['cat-file', '-e', `${c}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function shortOf(repo, full, len) {
  try {
    return repo.git(['rev-parse', `--short=${Math.max(7, len)}`, full]).trim();
  } catch {
    return full.slice(0, Math.max(7, len));
  }
}

/**
 * @param {string} text - doc
 * @param {import('./drift.mjs').DriftContext} ctx
 * @param {Map<string,string>|null} commitMap
 * @returns {Array<object>} un elemento per link con verified
 */
export function planRemap(text, ctx, commitMap) {
  const out = [];
  for (const ref of readCodeRefs(text).refs) {
    if (!ref.verified?.commit) continue;
    const old = ref.verified.commit.toLowerCase();
    const repo = ctx.repoFor(ref);
    const base = { ref, old };
    if (!repo) {
      out.push({ ...base, outcome: 'non_trovato', note: 'repo del codice non disponibile' });
      continue;
    }
    if (commitExists(repo, old)) {
      out.push({ ...base, outcome: 'presente' });
      continue;
    }
    if (commitMap) {
      const hits = [...commitMap.keys()].filter((k) => k.startsWith(old));
      if (hits.length > 1) {
        out.push({ ...base, outcome: 'ambiguo', note: `${hits.length} commit della mappa iniziano con ${old}` });
        continue;
      }
      if (hits.length === 1) {
        const neu = commitMap.get(hits[0]);
        if (ZERO.test(neu)) {
          out.push({ ...base, outcome: 'eliminato', note: 'la riscrittura ha tolto il commit: riverifica con mr verify' });
          continue;
        }
        if (!commitExists(repo, neu)) {
          out.push({ ...base, outcome: 'non_trovato', note: 'nella mappa, ma il commit nuovo non è in questo repo (mappa di un altro repo?)' });
          continue;
        }
        const newCommit = shortOf(repo, neu, old.length);
        out.push({ ...base, outcome: 'esatto', newCommit, newDate: commitDate(repo, newCommit), method: 'commit-map' });
        continue;
      }
    }
    // ripiego: data + file (l'oggetto del commit vecchio non è più leggibile; si mostrano
    // quelli dei candidati, oscurati, per chi decide)
    if (!ref.verified.date) {
      out.push({ ...base, outcome: 'non_trovato', note: commitMap ? 'non nella mappa, e verified senza date: nessun ripiego' : 'verified senza date: nessun ripiego possibile' });
      continue;
    }
    const day = ref.verified.date;
    let log = '';
    try {
      log = repo.git(['log', '--format=%h|%as|%s', `--since=${day}T00:00:00`, `--until=${day}T23:59:59`, repo.rev || 'HEAD', '--', ref.path]).trim();
    } catch {
      log = '';
    }
    const cands = log ? log.split('\n').map((l) => {
      const [h, d, ...s] = l.split('|');
      return { hash: h, date: d, subject: redactLine(s.join('|')) };
    }) : [];
    if (!cands.length) {
      out.push({ ...base, outcome: 'non_trovato', note: `nessun commit del ${day} su ${ref.path}` });
      continue;
    }
    out.push({ ...base, outcome: 'ripiego', candidates: cands, ...(cands.length === 1 ? { newCommit: cands[0].hash, newDate: cands[0].date } : {}), method: 'data+file', note: cands.length === 1 ? 'candidato unico: si applica solo con --accept-fallback' : `${cands.length} candidati: scegli a mano` });
  }
  return out;
}
