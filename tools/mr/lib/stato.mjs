/**
 * stato.mjs — a che punto è un repo con MR, e qual è il passo dopo (0.6-z11, M3).
 *
 * È l'onboarding da riga di comando (report/onboarding/proposta.md §2): dai numeri che MR già
 * calcola (doc vivi e frontmatter, errori del validatore, regola «MR segnala, non blocca» nel
 * CLAUDE.md o AGENTS.md, ingresso nel giro) ricava il livello e una sola riga di prossimo passo.
 *
 * Livelli:
 *   0 fotografia     (di partenza) il livello 1 non è ancora soddisfatto
 *   1 doc principali frontmatter sui doc principali (README, CLAUDE.md/AGENTS.md se ci sono),
 *                    validatore a 0 errori, regola nel CLAUDE.md o AGENTS.md
 *   2 tutti i vivi   livello 1 e frontmatter su almeno l'80% dei doc vivi
 *   3 nel giro       livello 2 e il workspace è tra quelli attivi dell'indice di arch
 * Il livello si ferma al primo criterio non soddisfatto: «nel giro» da solo non dà il livello 3.
 * I criteri di tempo della proposta (due settimane a 0 errori, il proprietario che risponde) non si
 * misurano: il testo li ricorda.
 *
 * Funzione pura sui dati: nessun I/O.
 */

export const SOGLIA_VIVI = 0.8;
const PRIMI_DOC = 'frontmatter sul README e su 2-4 doc principali con la skill `mr-tag` (anteprima, poi ok del proprietario)';

/**
 * Il livello è il più alto di cui sono soddisfatti TUTTI i criteri, e si ferma al primo non
 * soddisfatto (0.6-z12): un repo senza frontmatter sta al livello 0 anche se è già nel giro; i
 * livelli non si saltano. «Nel giro» è un criterio del livello 3, non un livello a sé.
 * @param {{
 *   vivi: number, conFrontmatter: number,
 *   principali: Array<{doc: string, frontmatter: boolean}>,
 *   erroriValidate: number|null,        // null: non calcolato (con --rev)
 *   regola: string|null,                // file dove sta la regola, o null
 *   giro: boolean|null,                 // null: indice di arch non trovato
 * }} d
 * @returns {{ livello: number, verso: number|null, mancano: string[], prossimo: string, nelGiro: boolean|null }}
 *   verso: il livello a cui si sta lavorando (null a livello 3); mancano: criteri non soddisfatti di quel livello
 */
export function livello(d) {
  const quota = d.vivi ? d.conFrontmatter / d.vivi : 0;
  const pct = `${Math.round(quota * 100)}%`;
  const soglia = `${Math.round(SOGLIA_VIVI * 100)}%`;
  const senza = d.vivi - d.conFrontmatter;

  // livello 1: frontmatter sui doc principali, validatore a 0 errori, regola nel CLAUDE.md/AGENTS.md
  const m1 = [];
  const principaliSenza = d.principali.filter((p) => !p.frontmatter).map((p) => p.doc);
  if (d.conFrontmatter === 0) m1.push(PRIMI_DOC);
  else if (principaliSenza.length) m1.push(`frontmatter su ${principaliSenza.map((x) => `\`${x}\``).join(', ')}`);
  if (d.erroriValidate) m1.push(`\`mr-validate --profile light\` a 0 errori (ora ${d.erroriValidate})`);
  if (!d.regola) m1.push('il blocco «MR segnala, non blocca» nel CLAUDE.md o AGENTS.md');
  if (m1.length) {
    return { livello: 0, verso: 1, mancano: m1, nelGiro: d.giro, prossimo: `livello 1: ${m1.join('; ')}.` };
  }
  // livello 2: almeno l'80% dei doc vivi con frontmatter
  if (quota < SOGLIA_VIVI) {
    return {
      livello: 1, verso: 2, nelGiro: d.giro,
      mancano: [`frontmatter su almeno il ${soglia} dei doc vivi (ora ${pct})`],
      prossimo: `livello 2, dopo due settimane a 0 errori: frontmatter sugli altri ${senza} doc vivi a lotti di al massimo 15 (\`mr vivi . --senza-frontmatter\`), e \`mr impact --staged\` prima del commit, informativo.`,
    };
  }
  // livello 3: il workspace è nel giro di arch
  if (!d.giro) {
    return {
      livello: 2, verso: 3, nelGiro: d.giro,
      mancano: d.giro === null ? ['indice di arch non trovato: l\'ingresso nel giro non si vede da qui'] : ['workspace non ancora nel giro di arch'],
      prossimo: `livello 3, se i doc li leggono anche altri (agenti compresi): chiedere ad arch di aggiungere il workspace al giro (indice e allow-list centrale)${senza ? `; intanto restano ${senza} doc vivi senza frontmatter` : ''}.`,
    };
  }
  return { livello: 3, verso: null, mancano: [], nelGiro: true, prossimo: 'niente di nuovo: il giro settimanale di arch fa il resto. Le segnalazioni si guardano dopo la task in corso.' };
}

/** la regola §0 in un testo (CLAUDE.md, AGENTS.md) */
export function haRegola(testo) {
  return /MR segnala,? non blocca/i.test(testo || '');
}

/** il path (assoluto) è dentro un workspace attivo dell'indice? workspace: [{path, attivo}] */
export function nelGiro(abs, workspace) {
  return workspace.some((w) => w.attivo && (abs === w.path || abs.startsWith(w.path.replace(/\/+$/, '') + '/')));
}
