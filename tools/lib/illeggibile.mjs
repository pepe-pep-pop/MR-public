/**
 * illeggibile.mjs — frontmatter che il parser YAML non legge (MR 0.6-z3).
 *
 * Usato da mr-validate e mr-scanner. Solo moduli built-in di Node.
 *
 * Caso tipico: `title: PB: piano di test`, con i due punti senza virgolette. Prima della 0.6-z3 il
 * doc spariva dal conteggio con un solo warning, e il validatore chiudeva con PASS. Ora:
 *   - il blocco contiene `mr_version:` → è un doc MR rotto: errore, con riga e messaggio del parser;
 *   - non lo contiene → frontmatter di un altro strumento, forse: warning.
 */

/** testo del blocco iniziale tra `---` (senza i delimitatori), o null se il file non ne ha uno */
export function bloccoFrontmatter(raw) {
  const t = raw.replace(/\r\n?/g, '\n');
  if (!t.startsWith('---\n')) return null;
  const end = t.indexOf('\n---', 3);
  return end < 0 ? t.slice(4) : t.slice(4, end + 1);
}

/** il blocco dichiara mr_version (letto riga per riga, senza parser) */
export function bloccoMr(raw) {
  const b = bloccoFrontmatter(raw);
  return b !== null && /^mr_version\s*:/m.test(b);
}

/**
 * messaggio breve dall'errore del parser, con la riga del file. js-yaml via gray-matter: mark.line è
 * 0-based su un testo che comincia con l'a capo dopo il primo `---`, quindi riga del file = line + 1.
 * yaml (giro): linePos è 1-based sul blocco, che comincia alla riga 2 del file.
 */
export function messaggioParser(err) {
  // il messaggio di yaml finisce con «at line N, column M:», contato dall'inizio del blocco: si toglie
  const reason = err.reason || String(err.message || err).split('\n')[0].replace(/ at line \d+, column \d+:?$/, '');
  let riga = null;
  if (err.mark && Number.isInteger(err.mark.line)) riga = err.mark.line + 1;
  else if (Array.isArray(err.linePos) && err.linePos[0]) riga = err.linePos[0].line + 1;
  return `${riga ? `riga ${riga}: ` : ''}${reason}`;
}

/** testo dell'errore o del warning, uguale per validatore, scanner e giro */
export function testoIlleggibile(err, mr) {
  // 0.6-z13 (R1): frontmatter in JavaScript (`---js`), rifiutato senza eseguirlo
  if (err && err.jsVietato) return 'frontmatter in JavaScript (`---js`): non eseguito e non letto, il doc è saltato. MR legge solo frontmatter YAML tra `---`';
  return mr
    ? `frontmatter non leggibile (${messaggioParser(err)}): il doc è saltato. Un valore con i due punti va tra virgolette, es. title: "PB: piano"`
    : `frontmatter non leggibile (${messaggioParser(err)}), senza mr_version: forse di un altro strumento, saltato`;
}
