/**
 * extract.mjs — estrazione dei claim verificabili dal corpo di un doc markdown (PRD v0.6 R5).
 *
 * Fonti:
 *   - code span inline (`...`) nel testo: tutti i tipi di claim;
 *   - blocchi di codice shell (```bash, ```sh, ```zsh, ```shell, ```console, o senza
 *     linguaggio): solo i comandi (npm/pnpm/yarn/bun run, make, deno task).
 *
 * Tipi: path, env, table, endpoint, command, symbol, identifier. Ogni claim porta riga e sezione
 * (il titolo # più vicino sopra). Una riga con `<!-- mr:ignore-claim -->` non produce claim.
 * Il frontmatter YAML iniziale non si analizza.
 *
 * Funzione pura: nessun I/O.
 */

const FILE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'sql', 'md', 'mdx', 'json', 'jsonc', 'yml', 'yaml',
  'toml', 'sh', 'bash', 'zsh', 'swift', 'kt', 'java', 'go', 'rs', 'rb', 'php', 'html', 'css',
  'scss', 'vue', 'svelte', 'astro', 'example', 'txt', 'csv', 'tsv', 'ini', 'conf', 'cfg', 'xml',
  'plist', 'gradle', 'prisma', 'graphql', 'gql', 'rq', 'ttl', 'hbs', 'ejs', 'njk', 'xcconfig',
  'entitlements', 'pbxproj', 'storyboard', 'xib', 'dockerfile', 'lock',
  'ignore', 'gitignore', // 0.6-n: `mr.claims.ignore`, `.dockerignore` sono file, non schema.tabella
]);

const HTTP_METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';

// domini di primo livello frequenti: `example.com` è un host, non schema.tabella
const TLDS = new Set([
  'com', 'it', 'ch', 'dev', 'io', 'org', 'net', 'app', 'eu', 'co', 'ai', 'me', 'info', 'biz',
  'uk', 'de', 'fr', 'es', 'us', 'local', 'localhost', 'cloud', 'site', 'online', 'tech', 'xyz',
]);

// sotto-comandi dei package manager che non sono script del progetto
const PM_BUILTINS = new Set([
  'install', 'i', 'add', 'remove', 'rm', 'uninstall', 'un', 'dlx', 'exec', 'x', 'create', 'init',
  'ci', 'update', 'up', 'upgrade', 'why', 'link', 'unlink', 'publish', 'pack', 'audit', 'outdated',
  'list', 'ls', 'info', 'view', 'login', 'logout', 'whoami', 'config', 'cache', 'rebuild', 'prune',
  'dedupe', 'store', 'env', 'setup', 'import', 'patch', 'fetch', 'version', 'help', 'node',
]);
const NPM_LIFECYCLE = new Set(['test', 'start', 'stop', 'restart']);

// funzioni globali / di libreria: non sono simboli del progetto
const GLOBAL_CALLS = new Set([
  'fetch', 'require', 'import', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'parseInt', 'parseFloat', 'encodeURIComponent', 'decodeURIComponent', 'structuredClone', 'atob',
  'btoa', 'print', 'len', 'open', 'now', 'alert', 'confirm', 'useState', 'useEffect', 'useMemo',
  'useCallback', 'useRef', 'useContext', 'useReducer', 'useLayoutEffect', 'super', 'eval',
  'toString', 'map', 'filter', 'reduce', 'forEach', 'find', 'push', 'then', 'catch', 'json',
  'select', 'insert', 'update', 'upsert', 'delete', 'from', 'eq', 'single', 'maybeSingle', 'rpc',
]);
const GLOBAL_OBJECTS = new Set([
  'console', 'JSON', 'Math', 'Object', 'Array', 'Promise', 'Date', 'Deno', 'process', 'window',
  'document', 'crypto', 'Number', 'String', 'Reflect', 'Intl', 'URL', 'Response', 'Request',
  'navigator', 'localStorage', 'sessionStorage', 'os', 'sys', 'json', 'path', 'fs', 'supabase',
]);

const SHELL_LANGS = new Set(['', 'bash', 'sh', 'zsh', 'shell', 'console', 'terminal']);

const IGNORE_MARKER = /<!--\s*mr:ignore-claim\s*-->/;

/** placeholder, puntini, glob complessi: non verificabili come nome */
function hasPlaceholder(t) {
  // segnaposto: <x>, {x}, …, [id], ${x}, XXX, e modelli di data come YYYY-MM-DD_slug.md
  // intervalli come hof-pb-1..6.md o a..b (0.6-g): non sono un nome
  return /[<>{}…]|\.\.\.|\w\.\.\w|\[\w*\]|\$\{|\bXXX\b|\bxxx\b|YYYY|\bMM-DD\b|\bAAAA\b|\bGG-MM\b/.test(t);
}

// cartelle di output di build e file generati (0.6-g): non sono path da verificare
const BUILD_OUTPUT_DIRS = new Set([
  '.output', 'dist', 'build', '.next', 'out', '.svelte-kit', 'coverage', '.vercel', '.netlify',
  'target', 'node_modules', '.nuxt', '.turbo', '.cache', 'DerivedData', '.wrangler',
]);

// scope OAuth (Google, HubSpot): `calendar.events.readonly`, `crm.objects.contacts` non sono tabelle
const OAUTH_PREFIXES = new Set([
  'calendar', 'drive', 'gmail', 'spreadsheets', 'userinfo', 'contacts', 'crm', 'oauth', 'youtube',
  'analytics', 'webmasters', 'tasks', 'forms', 'sheets', 'admin', 'cloud-platform', 'content',
  'automation', 'tickets', 'files', 'timeline', 'conversations', 'settings', 'scheduler',
]);
const OAUTH_SUFFIXES = new Set(['readonly', 'read', 'write', 'readwrite', 'send', 'compose', 'modify', 'full', 'manage', 'insert']);

function extOf(segment) {
  const m = segment.match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : null;
}

function looksLikePath(t) {
  if (/\s/.test(t) || /:\/\//.test(t) || /^[/~$]/.test(t) || t.startsWith('-')) return false;
  if (hasPlaceholder(t)) return false;
  if (!/^[\w.@*/-]+$/.test(t)) return false;
  // pattern tipo *.ttl, *.pem: regole, non file
  if (t.startsWith('*') && !t.includes('/')) return false;
  const segs = t.replace(/\/+$/, '').split('/');
  const last = segs[segs.length - 1];
  if (segs.some((sg) => BUILD_OUTPUT_DIRS.has(sg))) return false;
  // host con path (moduli.example.dev/api/x) e versioni (WhatsApp/2.23): non sono file
  if (segs.length > 1 && /\.([a-z]{2,})$/.test(segs[0]) && TLDS.has(segs[0].split('.').pop())) return false;
  if (segs.length > 1 && /^\d+(\.\d+)+$/.test(last)) return false;
  if (/^\.env(\.|$)/.test(last) && !/\.(example|sample|template)$/.test(last)) return false;
  const ext = extOf(last);
  if (t.includes('/')) {
    // almeno un segmento con lettere, niente frazioni tipo 1/2
    return /[A-Za-z]/.test(t) && !/^\d+\/\d+$/.test(t);
  }
  return ext !== null && FILE_EXTENSIONS.has(ext) && last.length > ext.length + 1;
}

/**
 * Classifica un code span. Ritorna un claim {kind, text, key, ...} o null.
 * @param {string} raw
 */
export function classifySpan(raw) {
  // virgolette e punteggiatura incollate ai bordi (`npm run build'"`, 0.6-g)
  const t = raw.trim().replace(/^['"]+/, '').replace(/['",;:]+$/, '').trim();
  if (t.length < 2 || t.length > 160) return null;

  // endpoint: METODO /path
  let m = t.match(new RegExp(`^(${HTTP_METHODS})\\s+(/\\S*)$`));
  // un segmento numerico lungo è l'id di una risorsa di un sistema esterno (0.6-g):
  // `GET /api/v2/space/90040200809/list` descrive l'API di ClickUp, non una route del repo
  if (m && /\/\d{5,}(\/|$)/.test(m[2])) return null;
  if (m) return { kind: 'endpoint', text: t, key: m[2], method: m[1] };

  // comandi
  // `bun ops/recon.ts`, `bun run scripts/x.mjs` (0.6-z5, pilota B difetto 6): bun esegue un file, non uno
  // script di package.json; il file si cerca come path (anche per suffisso, sotto la cartella del codice)
  m = t.match(/^bun\s+(?:run\s+)?([\w./@-]+\.(?:[cm]?[jt]sx?))(?:\s.*)?$/);
  if (m && looksLikePath(m[1])) return { kind: 'path', text: t, key: m[1].replace(/^\.\//, '') };
  m = t.match(/^(npm|pnpm|yarn|bun)\s+(?:run\s+)?([\w:.@/-]+)(?:\s.*)?$/);
  if (m) {
    const [, pm, script] = m;
    const usesRun = /^\S+\s+run\s/.test(t + ' ');
    if (pm === 'npm' && !usesRun && !NPM_LIFECYCLE.has(script)) return null;
    if (!usesRun && PM_BUILTINS.has(script)) return null;
    if (hasPlaceholder(script)) return null;
    // `npm run` da solo elenca gli script: non è un claim
    if (script === 'run') return null;
    return { kind: 'command', text: t, key: script, runner: 'package.json' };
  }
  m = t.match(/^make\s+([\w.-]+)(?:\s.*)?$/);
  if (m && !hasPlaceholder(m[1])) return { kind: 'command', text: t, key: m[1], runner: 'make' };
  m = t.match(/^deno\s+task\s+([\w:.-]+)(?:\s.*)?$/);
  if (m) return { kind: 'command', text: t, key: m[1], runner: 'deno' };
  m = t.match(/^(?:node|python3?|bash|sh|zsh|tsx|ts-node|deno\s+run(?:\s+-\S+)*)\s+([\w./@-]+\.\w+)(?:\s.*)?$/);
  if (m && looksLikePath(m[1])) return { kind: 'path', text: t, key: m[1].replace(/^\.\//, '') };

  if (/\s/.test(t)) return null;

  // variabili d'ambiente: MAIUSCOLO_CON_UNDERSCORE, anche in forma $X, ${X}, process.env.X
  m = t.match(/^(?:\$\{?|process\.env\.|import\.meta\.env\.)?([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\}?$/);
  if (m) return { kind: 'env', text: t, key: m[1] };
  m = t.match(/^Deno\.env\.get\(\s*["']([A-Z][A-Z0-9_]+)["']\s*\)$/);
  if (m) return { kind: 'env', text: t, key: m[1] };

  // simboli: nome() o obj.nome(...) senza spazi
  m = t.match(/^((?:[A-Za-z_$][\w$]*\.)*)([A-Za-z_$][\w$]*)\([^()\s]*\)$/);
  if (m) {
    const objs = m[1] ? m[1].slice(0, -1).split('.') : [];
    if (GLOBAL_CALLS.has(m[2]) || (objs[0] && GLOBAL_OBJECTS.has(objs[0]))) return null;
    if (m[2].length < 3) return null;
    return { kind: 'symbol', text: t, key: m[2] };
  }

  // path
  if (looksLikePath(t)) return { kind: 'path', text: t, key: t.replace(/^\.\//, '') };

  // tabella/colonna: schema.tabella, tabella.colonna, schema.tabella.colonna
  m = t.match(/^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)(?:\.([a-z_][a-z0-9_]*))?$/);
  if (m) {
    const lastExt = (m[3] || m[2]).toLowerCase();
    if (FILE_EXTENSIONS.has(lastExt) || TLDS.has(lastExt)) return null;
    if (GLOBAL_OBJECTS.has(m[1])) return null;
    const parts = m.slice(1).filter(Boolean);
    if (OAUTH_SUFFIXES.has(parts[parts.length - 1]) || (OAUTH_PREFIXES.has(parts[0]) && parts.length >= 3)) return null;
    return { kind: 'table', text: t, key: t, parts };
  }

  // identificatore snake_case minuscolo, almeno un underscore (0.6-e, report/0.6-e/regole.md §1);
  // pg_* è lo spazio riservato di Postgres (pg_cron, pg_dump, pg_net): strumenti, non codice del repo
  // node_modules è una cartella degli strumenti, non un nome del codice (0.6-n)
  if (t.length >= 4 && t.length <= 64 && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(t) && !t.startsWith('pg_') && t !== 'node_modules') {
    return { kind: 'identifier', text: t, key: t };
  }

  return null;
}

function commandsInShellLine(line) {
  const out = [];
  // una riga può avere più comandi: a && b ; c
  for (const part of line.replace(/^\s*[$>]\s*/, '').split(/&&|\|\||;/)) {
    const c = classifySpan(part.trim());
    if (c && c.kind === 'command') out.push(c);
  }
  return out;
}

/**
 * Estrae i claim dal testo completo di un doc.
 * @param {string} text - contenuto del file .md
 * @returns {Array<{kind: string, text: string, key: string, line: number, section: string}>}
 */
export function extractClaims(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const claims = [];
  let i = 0;

  // salta il frontmatter iniziale
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) i = end + 1;
  }

  let section = '';
  let fence = null; // { marker, lang }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;

    const fm = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)/);
    if (fence) {
      if (fm && fm[1][0] === fence.marker[0] && fm[1].length >= fence.marker.length && !fm[2]) {
        fence = null;
        continue;
      }
      if (SHELL_LANGS.has(fence.lang) && !IGNORE_MARKER.test(line)) {
        for (const c of commandsInShellLine(line)) claims.push({ ...c, line: lineNo, section });
      }
      continue;
    }
    if (fm) {
      fence = { marker: fm[1], lang: (fm[2] || '').toLowerCase() };
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) section = `${h[1]} ${h[2]}`;

    if (IGNORE_MARKER.test(line)) continue;

    // code span con un solo backtick (i doppi ``x`` li tratta allo stesso modo)
    for (const span of line.matchAll(/(`+)([^`]+?)\1(?!`)/g)) {
      const c = classifySpan(span[2]);
      if (c) claims.push({ ...c, line: lineNo, section });
    }
  }
  return claims;
}
