/**
 * lookup.mjs — ricerche nel codice con indice in memoria (PRD v0.6 N5).
 *
 * Con migliaia di claim, un git grep per domanda è troppo lento (minuti su app-web).
 * Qui il prefetch fa:
 *   1. un solo git grep -o -w che estrae tutti gli identificatori del codice e tiene,
 *      per quelli richiesti dai claim, le posizioni path:riga (indice parole);
 *   2. un git grep -F -o per le stringhe fisse (tabelle `a.b`, prefissi di endpoint);
 *   3. per i simboli, la lettura delle sole righe candidate (dall'indice) e la verifica
 *      in JS dei pattern di definizione, con i confini di parola esatti.
 * Il contenuto delle righe resta in memoria: nell'output vanno solo path e numero di riga.
 * Una domanda non prevista dal prefetch fa una ricerca singola e la mette in cache.
 */

const MAX_HITS = 3; // evidenze per chiave nel report
const MAX_CANDIDATES = 2000; // righe candidate per simbolo / parola di schema

const IDENT_ERE = '[A-Za-z_$][A-Za-z0-9_$]*';

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** regex JS di definizione per un nome */
export function definitionRegexes(name) {
  const n = escapeRe(name);
  return [
    new RegExp(`function\\s*\\*?\\s*${n}\\s*[(<]`),
    new RegExp(`(?:^|[^\\w$])(?:const|let|var)\\s+${n}\\s*[=:]`),
    new RegExp(`(?:^|[^\\w$])def\\s+${n}\\s*\\(`),
    new RegExp(`(?:^|[^\\w$])class\\s+${n}(?![\\w$])`),
    new RegExp(`(?:^|[^\\w$])func\\s+${n}\\s*[(<]`),
    new RegExp(`(?:^|[^\\w$])fn\\s+${n}\\s*[(<]`),
    new RegExp(`(?:^|[^\\w$.])${n}\\s*[:=]\\s*(?:async\\s*)?(?:\\(|function|[\\w$]+\\s*=>)`),
    new RegExp(`^\\s*(?:(?:public|private|protected|static|async|override)\\s+)*${n}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`),
  ];
}

export function sqlDefinitionRegex(name) {
  return new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+(?:[\\w"]+\\.)?"?${escapeRe(name)}(?![\\w$])`, 'i');
}

function pushHit(map, key, hit, max) {
  if (!map.has(key)) map.set(key, []);
  const list = map.get(key);
  if (list.length < max) list.push({ path: hit.path, line: hit.line });
}

const MAX_SCHEMA_HITS = 500; // posizioni per parola nei soli file di schema

export class Lookup {
  /**
   * @param {import('./repo.mjs').RepoView} repo
   * @param {(path: string) => boolean} isSchemaFile - file di schema/migration
   */
  constructor(repo, isSchemaFile = () => false) {
    this.repo = repo;
    this.isSchemaFile = isSchemaFile;
    this.wordHits = new Map(); // identificatore → posizioni (fino a MAX_CANDIDATES)
    this.schemaHits = new Map(); // identificatore → posizioni nei file di schema
    this.literals = new Map(); // stringa fissa → hits
    this.defs = new Map(); // nome → hits di definizione
    this.sqlDefs = new Map(); // nome → hits di definizione SQL
    this.ignored = new Map(); // path → bool
    this.knownWords = new Set();
    this.knownLiterals = new Set();
    this.knownDefs = new Set();
    this._schemaFiles = null;
  }

  schemaFiles() {
    this._schemaFiles ??= this.repo.listFiles().filter(this.isSchemaFile);
    return this._schemaFiles;
  }

  _pushWord(h) {
    pushHit(this.wordHits, h.match, h, MAX_CANDIDATES);
    if (this.isSchemaFile(h.path)) pushHit(this.schemaHits, h.match, h, MAX_SCHEMA_HITS);
  }

  /** indicizza le parole richieste con un solo git grep di tutti gli identificatori */
  _indexWords(words) {
    const want = new Set(words.filter((w) => !this.knownWords.has(w)));
    if (!want.size) return;
    if (want.size <= 20) {
      // poche parole: una ricerca mirata costa meno dell'estrazione completa
      for (const h of this.repo.grepMatches([...want], { fixed: true, word: true })) this._pushWord(h);
    } else {
      for (const h of this.repo.grepMatches([IDENT_ERE], { word: true })) {
        if (want.has(h.match)) this._pushWord(h);
      }
    }
    want.forEach((w) => this.knownWords.add(w));
  }

  _indexLiterals(literals) {
    const want = [...new Set(literals)].filter((l) => l && !this.knownLiterals.has(l));
    if (!want.length) return;
    for (const h of this.repo.grepMatches(want, { fixed: true })) pushHit(this.literals, h.match, h, MAX_HITS);
    want.forEach((l) => this.knownLiterals.add(l));
  }

  _indexDefinitions(names) {
    const want = [...new Set(names)].filter((n) => n && !this.knownDefs.has(n));
    if (!want.length) return;
    this._indexWords(want);
    // righe candidate: dove il nome compare come parola
    const byFile = new Map();
    for (const n of want) {
      for (const h of this.wordHits.get(n) || []) {
        if (!byFile.has(h.path)) byFile.set(h.path, []);
        byFile.get(h.path).push({ name: n, line: h.line });
      }
    }
    const contents = this.repo.readFiles([...byFile.keys()]);
    const regexCache = new Map();
    for (const [path, cands] of byFile) {
      const text = contents.get(path);
      if (text === undefined) continue;
      const lines = text.split('\n');
      for (const { name, line } of cands) {
        const src = lines[line - 1] ?? '';
        if (!regexCache.has(name)) regexCache.set(name, { js: definitionRegexes(name), sql: sqlDefinitionRegex(name) });
        const re = regexCache.get(name);
        if (re.js.some((r) => r.test(src))) pushHit(this.defs, name, { path, line }, MAX_HITS);
        else if (re.sql.test(src)) pushHit(this.sqlDefs, name, { path, line }, MAX_HITS);
      }
    }
    want.forEach((n) => this.knownDefs.add(n));
  }

  /** ricerche in blocco per tutti i claim */
  prefetch({ words = [], literals = [], defs = [], ignoredPaths = [] }) {
    this._indexWords([...new Set([...words, ...defs])]);
    this._indexLiterals(literals);
    this._indexDefinitions(defs);
    const paths = [...new Set(ignoredPaths)].filter((p) => p && !this.ignored.has(p));
    const ign = this.repo.ignoredSet(paths);
    for (const p of paths) this.ignored.set(p, ign.has(p));
  }

  word(key) {
    this._indexWords([key]);
    return (this.wordHits.get(key) || []).slice(0, MAX_HITS);
  }

  /** posizioni della parola nei soli file di schema (fino a MAX_SCHEMA_HITS) */
  schemaWord(word) {
    this._indexWords([word]);
    return this.schemaHits.get(word) || [];
  }

  literal(key) {
    this._indexLiterals([key]);
    return this.literals.get(key) || [];
  }

  definition(name) {
    this._indexDefinitions([name]);
    return this.defs.get(name) || [];
  }

  sqlDefinition(name) {
    this._indexDefinitions([name]);
    return this.sqlDefs.get(name) || [];
  }

  isIgnored(path) {
    if (!this.ignored.has(path)) this.ignored.set(path, this.repo.ignoredSet([path]).has(path));
    return this.ignored.get(path);
  }
}
