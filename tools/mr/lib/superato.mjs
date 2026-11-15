/**
 * superato.mjs — doc o sezioni che si dichiarano superati (0.6-z37, fix 4 del giro 7).
 *
 * Un doc vivo può dire di sé, nel testo, che una parte è storia:
 *   > **Superato dal 03/11/2026.** … Quanto segue è storia.
 *   > Sostituito da `altro-doc.md`.
 *   Questa sezione è storica.
 * Marcatori riconosciuti (fuori dai blocchi di codice, parole cercate fuori dai code span):
 *   - una citazione (`>`) che comincia con superato/sostituito da …, obsoleto, deprecato, archiviato,
 *     dismesso («superato» solo se seguito da «da/dal/…» o da una data: «test superato» vuol dire passato);
 *   - «quanto segue / ciò che segue / il resto del doc / questa sezione / questo doc è storia (storico,
 *     superato)», in qualunque riga.
 * Portata:
 *   - in testa al doc (prima di ogni titolo, o sotto il solo titolo # iniziale prima del titolo successivo):
 *     tutto il doc;
 *   - altrimenti dalla riga del marcatore fino al prossimo titolo dello stesso livello o più alto.
 * `status: superseded` / `deprecated` nel frontmatter li gestisce già historicalReason (frontmatter.mjs).
 *
 * Funzione pura, nessun I/O.
 */

const PAROLA_SUPERATO = /^(?:\*\*|__|[^\p{L}\p{N}\s>])*\s*(?:\*\*|__)?\s*(superat[oaie]\s+(?:da|dal|dalla|dallo|dai|dalle|dagli|dall['’]|il\s+\d|\d)|sostituit[oaie]\s+(?:da|dal|dalla|dallo|dai|dalle|dagli|dall['’])|obsolet[oaie]\b|deprecat[oaie]\b|archiviat[oaie]\b|dismess[oaie]\b)/iu;
const FRASE_STORIA = /\b(quanto segue|ciò che segue|cio che segue|tutto (?:ciò|quello) che segue|il resto del doc(?:umento)?|questa sezione|questo doc(?:umento)?)\s+(?:è|e'|é|resta|rimane)\s+(?:solo\s+)?(?:storia|storic[oa]|superat[oa])\b/i;

/** la riga (senza code span) dichiara superato quello che segue? */
export function marcatoreSuperato(riga) {
  const prosa = String(riga || '').replace(/`[^`]*`/g, ' ');
  const cit = prosa.match(/^\s*(?:>\s*)+(.*)$/);
  if (cit && PAROLA_SUPERATO.test(cit[1])) return true;
  return FRASE_STORIA.test(prosa);
}

/**
 * @param {string} text - testo del doc
 * @returns {{ doc: string|null, at: (line: number) => string|null }}
 *   doc: motivo se tutto il doc è superato; at(n): motivo per la riga n (1-based) o null
 */
export function righeStoriche(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }
  const titoli = []; // { n (0-based), livello }
  const marcatori = []; // n (0-based)
  let fence = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    const fm = l.match(/^\s*(```+|~~~+)/);
    if (fence) {
      if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length) fence = null;
      continue;
    }
    if (fm) {
      fence = fm[1];
      continue;
    }
    const h = l.match(/^(#{1,6})\s+\S/);
    if (h) {
      titoli.push({ n: i, livello: h[1].length });
      continue;
    }
    if (marcatoreSuperato(l)) marcatori.push(i);
  }
  const intervalli = []; // [da, a) 0-based
  for (const m of marcatori) {
    const sopra = titoli.filter((t) => t.n < m);
    const testa = !sopra.length || (sopra.length === 1 && sopra[0].livello === 1 && titoli[0] === sopra[0]);
    if (testa) {
      const motivo = `doc superato (riga ${m + 1})`;
      return { doc: motivo, at: () => motivo };
    }
    const sez = sopra[sopra.length - 1];
    const dopo = titoli.find((t) => t.n > m && t.livello <= sez.livello);
    intervalli.push([m, dopo ? dopo.n : lines.length, `sezione superata (riga ${m + 1})`]);
  }
  return {
    doc: null,
    at: (n) => {
      const x = intervalli.find(([a, b]) => n - 1 >= a && n - 1 < b);
      return x ? x[2] : null;
    },
  };
}
