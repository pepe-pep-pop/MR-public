/**
 * env.mjs — variabili d'ambiente: quelle che il codice legge confrontate con gli elenchi (0.6-z9).
 *
 * Nasce dal censimento token del 18/10 (report/analisi-token): in 17 caselle su 24 l'elenco era
 * indietro e nessun giro lo vedeva, perché i claim vanno solo doc → codice. Qui si va anche
 * codice → elenco:
 *   - letti e non elencati: nomi letti dal codice che nessun elenco riporta;
 *   - elencati e non letti: nomi di un file d'esempio che né il codice né i compose leggono.
 *
 * Lato codice (git grep, solo path e riga, mai il contenuto):
 *   process.env.X, process.env["X"], import.meta.env.X, Deno.env.get("X"), os.environ["X"],
 *   os.environ.get("X"), os.getenv("X"), getEnv("X"), ENV.fetch("X") e simili (una funzione o un
 *   oggetto con env/environ nel nome e un nome MAIUSCOLO fra virgolette), `const { A, B } = process.env`
 *   su una riga, gli helper del repo (`env_helpers` in mr.coverage.yaml, es. opzionale("X")) e
 *   `${X}` nei file compose, e nei file di configurazione (config.*, env.*, settings.*) ogni chiamata
 *   con un nome MAIUSCOLO fra virgolette. I file di test e i file d'esempio non contano.
 * Lato elenchi:
 *   - i file d'esempio (.env.example, .env.<nome>.example, <nome>.env.example, .esempio, .sample,
 *     .template): solo i nomi a sinistra di `=`, righe commentate comprese, mai i valori;
 *   - i doc vivi: ogni nome MAIUSCOLO che compare nel testo.
 * Se il repo ha file d'esempio, l'elenco sono loro: un nome citato solo in un doc è «non elencato»,
 * con la nota «citato in un doc». Senza file d'esempio, l'elenco sono i doc.
 *
 * Eccezioni: nomi di piattaforma (NODE_ENV, PATH, GITHUB_*…), `env_ignore` in mr.coverage.yaml,
 * regole `env:` di mr.claims.ignore e dell'allow-list centrale.
 * Sola lettura, nessuna scrittura.
 */

import { parse as parseYaml } from 'yaml';
import { COVERAGE_FILE } from './coverage.mjs';

// file d'esempio: .env.example, .env.production.example, onboarding-c.env.example, x.env.esempio
export const ESEMPIO = /(^|\/)(\.env(\.[A-Za-z0-9_-]+)?|[^/]+\.env|env)\.(example|sample|template|esempio)$/;
const CONFIG_FILE = /(^|\/)(config|env|settings)([._-][^/]*)?\.(m?[jt]s|cjs|py|rb|go|php)$/;
const CONFIG_SPECS = ['**/config*', '**/env*', '**/settings*', '**/config/**', '**/settings/**'].map((g) => `:(glob)${g}`);
const DATATO = /(^|\/)[^/]*\d{4}-\d{2}-\d{2}[^/]*\//;
const IMMAGINI = [
  ['(docker\\.io/)?(library/)?postgres', ['POSTGRES_PASSWORD', 'POSTGRES_USER', 'POSTGRES_DB']],
  ['(docker\\.io/)?cloudflare/cloudflared', ['TUNNEL_TOKEN']],
];
const COMPOSE = /(^|\/)(docker-)?compose[^/]*\.ya?ml$/;
// script di shell: le variabili le impostano spesso loro stessi (python inline con os.environ["X"])
const SHELL = /\.(sh|bash|zsh)$/;
const TEST_FILE = /(^|\/)(tests?|__tests__|fixtures?|e2e)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test[-_][^/]*\.[a-z]+$|_test\.(py|go)$/;

// nomi che dà la piattaforma, non la configurazione del progetto
const PIATTAFORMA = new Set(['NODE_ENV', 'PATH', 'HOME', 'PWD', 'USER', 'SHELL', 'TZ', 'LANG', 'CI', 'HOSTNAME', 'TERM', 'TMPDIR']);
const PIATTAFORMA_PREFISSI = ['GITHUB_', 'RUNNER_', 'NPM_'];
// import.meta.env di Vite: valori del build, non variabili da impostare
const VITE_BUILTIN = new Set(['DEV', 'PROD', 'MODE', 'SSR', 'BASE_URL']);

const NOME = '[A-Z][A-Z0-9_]+';
const Q = `['"\`]`;

/** pattern ERE per git grep */
export function patterns(helpers = []) {
  const p = [
    `process\\.env\\.${NOME}`,
    `process\\.env\\[${Q}${NOME}`,
    `import\\.meta\\.env\\.${NOME}`,
    `(^|[^A-Za-z0-9_$.])env\\.${NOME}`,
    `[A-Za-z_.]*([Ee]nv|ENV|environ)[A-Za-z_.]*[[(][[:space:]]*${Q}${NOME}${Q}`,
    `\\{[^}]*\\}[[:space:]]*=[[:space:]]*(process\\.env|Deno\\.env\\.toObject\\(\\))`,
  ];
  const h = helpers.filter((x) => /^[A-Za-z_$][\w$.]*$/.test(x)).map((x) => x.replace(/[.$]/g, '\\$&'));
  if (h.length) p.push(`(^|[^A-Za-z0-9_$.])(${h.join('|')})\\([[:space:]]*${Q}${NOME}${Q}`);
  return p;
}

/** nomi in un match di grep */
export function nomiDelMatch(match) {
  const d = match.match(/^\{([^}]*)\}\s*=/);
  if (d) {
    // const { A, B: b, C = 'x', ...resto } = process.env
    return d[1].split(',').map((s) => s.trim().replace(/^\.\.\..*$/, '').split(/[:=\s]/)[0]).filter((s) => new RegExp(`^${NOME}$`).test(s));
  }
  const vite = /^import\.meta\.env\./.test(match);
  const tutti = match.match(new RegExp(NOME, 'g')) || [];
  const n = tutti[tutti.length - 1];
  if (!n || (vite && VITE_BUILTIN.has(n))) return [];
  // ENV.fetch("X"), os.environ["X"]: il primo token maiuscolo è l'oggetto, l'ultimo il nome
  return [n];
}

export function loadEnvConfig(repo) {
  if (!repo.hasFile(COVERAGE_FILE)) return { helpers: [], ignore: [] };
  const data = parseYaml(repo.readFile(COVERAGE_FILE), { schema: 'failsafe' }) || {};
  const list = (x) => (Array.isArray(x) ? x.map(String) : []);
  return { helpers: list(data.env_helpers), ignore: list(data.env_ignore) };
}

function ignorato(nome, cfgIgnore, rules) {
  if (PIATTAFORMA.has(nome) || PIATTAFORMA_PREFISSI.some((p) => nome.startsWith(p))) return 'piattaforma';
  if (cfgIgnore.some((g) => new RegExp(`^${g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(nome))) return COVERAGE_FILE;
  if ((rules || []).some((r) => r.kind === 'env' && r.re.test(nome))) return 'regola env:';
  return null;
}

/** filtro dei path sotto una cartella del repo ('.' = tutto il repo: un workspace dentro GL) */
function dentro(prefix) {
  const p = !prefix || prefix === '.' ? '' : prefix.replace(/\/+$/, '') + '/';
  return (path) => !p || path.startsWith(p);
}

/**
 * nomi letti dal codice di un repo (o di una sua cartella)
 * @returns {Map<string, Array<{path: string, line: number}>>}
 */
export function nomiLetti(repo, helpers = [], prefix = '.') {
  const sotto = dentro(prefix);
  const out = new Map();
  const add = (n, path, line, immagine = false) => {
    if (!sotto(path) || DATATO.test(path) || SHELL.test(path)) return; // script di una volta (sanamenti/2026-10-13-x/) e di shell: non configurazione
    if (!out.has(n)) out.set(n, []);
    if (!out.get(n).some((x) => x.path === path && x.line === line)) out.get(n).push({ path, line, ...(immagine ? { immagine } : {}) });
  };
  for (const h of repo.grepMatches(patterns(helpers))) {
    if (TEST_FILE.test(h.path) || ESEMPIO.test(h.path)) continue;
    for (const n of nomiDelMatch(h.match)) add(n, h.path, h.line);
  }
  // nei file di configurazione (config.*, env.*, settings.*) ogni chiamata con un nome MAIUSCOLO fra
  // virgolette è una lettura: copre gli helper del repo senza dichiararli (opzionale("X"), str("X"))
  // e ogni chiave MAIUSCOLA di un oggetto (schema zod/envalid: `HUBSPOT_TOKEN: z.string()`)
  const conf = repo.grepMatches([`[A-Za-z_$][A-Za-z0-9_$.]*\\([[:space:]]*${Q}${NOME}${Q}`, `^[[:space:]]*${Q}?${NOME}${Q}?[[:space:]]*:`], { paths: CONFIG_SPECS });
  for (const h of conf) {
    if (TEST_FILE.test(h.path) || ESEMPIO.test(h.path) || !CONFIG_FILE.test(h.path)) continue;
    for (const n of nomiDelMatch(h.match)) add(n, h.path, h.line);
  }
  // ${X} e ${X:-…} nei compose: il compose legge l'env del servizio
  const compose = repo.listFiles().filter((f) => COMPOSE.test(f) && !f.split('/').includes('node_modules'));
  for (const [f, text] of repo.readFiles(compose)) {
    // immagini che leggono l'env_file da sole, senza ${X}: postgres, cloudflared
    for (const [img, nomi] of IMMAGINI) {
      const re = new RegExp(`^\\s*image:\\s*['"]?${img}[:@'"\\s]`);
      text.split('\n').forEach((l, i) => { if (re.test(l + ' ')) for (const n of nomi) add(n, f, i + 1, true); });
    }
    text.split('\n').forEach((l, i) => {
      if (/^\s*#/.test(l)) return;
      for (const m of l.matchAll(new RegExp(`\\$\\{(${NOME})`, 'g'))) add(m[1], f, i + 1);
    });
  }
  return out;
}

/**
 * file env passati con `env_file:` a un servizio con un'immagine esterna (image: senza build:, es.
 * vaultwarden, oauth2-proxy): i loro nomi li legge l'immagine, non il codice del repo
 * @returns {Set<string>} path (relativi al repo) dei file env, senza suffisso d'esempio
 */
export function envFileEsterni(repo, prefix = '.') {
  const sotto = dentro(prefix);
  const out = new Set();
  const compose = repo.listFiles().filter((f) => sotto(f) && COMPOSE.test(f) && !f.split('/').includes('node_modules'));
  for (const [f, text] of repo.readFiles(compose)) {
    let doc;
    try { doc = parseYaml(text, { schema: 'failsafe', logLevel: 'silent' }); } catch { continue; }
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/') + 1) : '';
    for (const svc of Object.values((doc && doc.services) || {})) {
      if (!svc || !svc.image || svc.build) continue;
      for (const e of [].concat(svc.env_file || [])) {
        const path = typeof e === 'string' ? e : e && e.path;
        if (path) out.add(normalizza(dir + path));
      }
    }
  }
  return out;
}

function normalizza(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}

/**
 * nomi dei file d'esempio (solo a sinistra di `=`)
 * @returns {{ files: string[], nomi: Map<string, Array<{path: string, line: number}>> }}
 */
export function nomiEsempi(repo, prefix = '.') {
  const sotto = dentro(prefix);
  const files = repo.listFiles().filter((f) => sotto(f) && ESEMPIO.test(f) && !f.split('/').includes('node_modules'));
  const nomi = new Map();
  for (const [f, text] of repo.readFiles(files)) {
    text.split('\n').forEach((l, i) => {
      const m = l.match(/^\s*#?\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
      if (!m) return;
      if (!nomi.has(m[1])) nomi.set(m[1], []);
      nomi.get(m[1]).push({ path: f, line: i + 1 });
    });
  }
  return { files: [...files].sort(), nomi };
}

/** nomi MAIUSCOLI citati nel testo dei doc */
export function nomiNeiDoc(testi) {
  const s = new Set();
  for (const t of testi) for (const m of t.matchAll(/(?<![A-Za-z0-9_])[A-Z][A-Z0-9_]+(?![A-Za-z0-9_])/g)) s.add(m[0]);
  return s;
}

/**
 * confronto codice ↔ elenchi
 * @param {Map} letti - da nomiLetti
 * @param {{files: string[], nomi: Map}} esempi - da nomiEsempi
 * @param {Set<string>} neiDoc - da nomiNeiDoc
 * @param {{ ignore?: string[], rules?: Array }} [opts]
 */
export function confrontoEnv(letti, esempi, neiDoc, opts = {}) {
  const conEsempi = esempi.files.length > 0;
  const ignorati = [];
  const nonElencati = [];
  for (const [nome, refs] of [...letti].sort((a, b) => a[0].localeCompare(b[0]))) {
    // nomi che un'immagine (postgres, cloudflared) legge da sola: contano come letti, mai come mancanti
    if (refs.every((x) => x.immagine)) continue;
    const ig = ignorato(nome, opts.ignore || [], opts.rules);
    if (ig) { ignorati.push({ nome, motivo: ig }); continue; }
    const elencato = conEsempi ? esempi.nomi.has(nome) : neiDoc.has(nome);
    if (!elencato) nonElencati.push({ nome, refs, ...(conEsempi && neiDoc.has(nome) ? { nota: 'citato in un doc' } : {}) });
  }
  const nonLetti = [];
  // esempi di un env_file passato a un'immagine esterna: li legge l'immagine, il verso non si controlla
  const esterni = esempi.files.filter((f) => (opts.esterni || new Set()).has(f.replace(/\.(example|sample|template|esempio)$/, '')));
  for (const [nome, refs] of [...esempi.nomi].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (letti.has(nome) || ignorato(nome, opts.ignore || [], opts.rules)) continue;
    if (refs.every((x) => esterni.includes(x.path))) continue;
    nonLetti.push({ nome, refs });
  }
  return {
    elenco: conEsempi ? 'file d\'esempio' : 'doc',
    esempi: esempi.files,
    esempi_di_immagini: esterni,
    letti: letti.size,
    elencati: conEsempi ? esempi.nomi.size : null,
    ignorati,
    non_elencati: nonElencati,
    non_letti: nonLetti,
  };
}
