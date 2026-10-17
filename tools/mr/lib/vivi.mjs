/**
 * vivi.mjs — quali doc di un repo sono «vivi» per il giro (0.6-z4).
 *
 * Un doc è vivo se non è:
 *   - un file di segreti (SECRET/SEGRETI nel nome): non si legge;
 *   - dentro una cartella `codice:<glob>` dell'allow-list (copia di un altro progetto, 0.6-m);
 *   - storico per path (isGiroHistorical: hof-*, piani, report, cartelle datate, fixture…, 0.6-g);
 *   - escluso da una regola `doc:<glob>` (descrive un altro repo) o `storico:<glob>` dell'allow-list
 *     del repo o centrale (0.6-z4: prima il giro li contava nella «Salute dei doc»).
 * Lo usano il giro e `mr vivi`: la stessa lista, così il conteggio dell'agente coincide con quello
 * del giro.
 */

import { isSecretPath } from './repo.mjs';

// doc storici o di lavoro (decisione 1 della 0.6-g): fuori dal giro, non una riga informativa
export const HIST_TOKENS = new Set([
  'piano', 'piani', 'plan', 'plans', 'planning', 'roadmap', 'roadmaps', 'proposta', 'proposte',
  'proposal', 'proposals', 'ricerca', 'ricerche', 'research', 'spike', 'spikes', 'log', 'logs',
  'changelog', 'report', 'reports', 'incidente', 'incidenti', 'incident', 'incidents', 'postmortem',
  'archive', 'archivio', 'archived', 'archiviati', 'handoff', 'handoffs', 'hof', 'daily', 'diario',
  'audit', 'release', 'releases', // 0.6-i: fotografie di un momento (giro 2: audit e note di release)
  'delta', 'design', 'recon', 'ricognizione', // 0.6-j: confronti col legacy, design, ricognizioni (giro 3)
  // fixture di test (aggiunta dell'agente: doc sbagliati apposta)
  'fixtures', 'fixture',
]);

/** motivo di isGiroHistorical che indica una fixture di test (doc sbagliati apposta): fuori anche dalle ancore */
export function isFixture(reason) {
  return reason === 'fixture di test' || /^«fixtures?» nel path$/.test(reason || '');
}

/** il doc (path relativo al repo) è storico per il giro? ritorna il motivo o null */
export function isGiroHistorical(rel) {
  const low = rel.toLowerCase();
  const segs = low.split('/');
  const base = segs[segs.length - 1];
  if (base.startsWith('hof-')) return 'hof-*';
  if (low.includes('docs/superpowers/')) return 'docs/superpowers/';
  if (segs.some((sg) => sg === '_out' || sg.startsWith('_output'))) return '_out/, _output*/ (generati)';
  // cartelle o file datati (14-04-26/, emergenza-2026-08/, 2026-09-10_x.md): note del giorno
  if (segs.some((sg) => /(^|[^\d])(\d{4}-\d{2}(-\d{2})?|\d{2}-\d{2}-\d{2,4})([^\d]|$)/.test(sg))) return 'datato';
  if (segs.includes('test-files')) return 'fixture di test';
  // pacchetti di modifica numerati (app-web/code/136_griglia_20_minuti/) e runbook di applicazione (0.6-j)
  if (segs.slice(0, -1).some((sg) => /^\d{2,4}_[a-z0-9]/.test(sg))) return 'pacchetto di modifica';
  if (/^runbook[_-]apply/.test(base)) return 'runbook di applicazione';
  // note datate anche senza anno (24-07-pm.md, 0.6-j)
  if (/^\d{2}-\d{2}([-_.]|$)/.test(base)) return 'datato';
  // versione nel nome del file (rework-ui-0.7.0.md): nota di una release, storica
  if (/(^|[^\d])\d+\.\d+\.\d+([^\d]|$)/.test(base)) return 'versione nel nome';
  if (low.includes('lovable') && /(^|[\/_. -])prompts?([\/_. -]|$)/.test(low)) return 'prompt Lovable';
  const tokens = segs.flatMap((sg) => sg.replace(/\.md$/, '').split(/[-_. ]+/)).filter(Boolean);
  const hit = tokens.find((t) => HIST_TOKENS.has(t));
  return hit ? `«${hit}» nel path` : null;
}

/** regola `doc:` o `storico:` (repo o allow-list centrale) che esclude il doc, o null */
export function esclusoDaRegola(rel, rules) {
  const r = (rules || []).find((x) => (x.kind === 'doc' || x.kind === 'storico') && x.re.test(rel));
  return r ? `regola ${r.kind}:` : null;
}

/**
 * motivo per cui il doc non è vivo, o null se è vivo
 * @returns {{ motivo: string, gruppo: 'segreti'|'codice'|'storico'|'regola', ancore: boolean } | null}
 *   ancore: le sue ancore si leggono lo stesso nel giro (storici per path, non fixture)
 */
export function nonVivo(rel, rules = []) {
  if (isSecretPath(rel)) return { motivo: 'segreti nel nome', gruppo: 'segreti', ancore: false };
  const codice = (rules || []).find((r) => r.kind === 'codice' && r.re.test(rel));
  if (codice) return { motivo: 'regola codice:', gruppo: 'codice', ancore: false };
  const hist = isGiroHistorical(rel);
  if (hist) return { motivo: hist, gruppo: 'storico', ancore: !isFixture(hist) };
  const regola = esclusoDaRegola(rel, rules);
  if (regola) return { motivo: regola, gruppo: 'regola', ancore: regola === 'regola storico:' };
  return null;
}
