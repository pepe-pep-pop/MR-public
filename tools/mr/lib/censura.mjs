/**
 * censura.mjs — valori di password, token e chiavi sostituiti con «[CENSURATO]» (0.6-z19).
 *
 * Richiesta di il maintainer del 22/10, via arch: nelle trascrizioni delle sessioni degli agenti
 * (`~/.claude/projects/**.jsonl`) sono rimaste password in chiaro (login di prova con curl, codice
 * di funzioni, una voce di credenziali). Le trascrizioni restano, ma censurate.
 *
 * Si sostituisce solo il valore: il nome del campo, l'utente di un `curl -u`, lo schema di un URL e
 * le righe intorno restano. Nei `.jsonl` si lavora sulle stringhe del JSON già decodificate, quindi
 * ogni riga resta JSON valido. Chi chiama non riceve mai i valori: solo il testo censurato e i
 * conteggi per tipo.
 */

export const SEGNAPOSTO = '[CENSURATO]';

// nomi di campo che contengono un segreto: DB_PASSWORD, client_secret, apiKey, MR_GH_TOKEN, «token».
// Non i contatori dei modelli (input_tokens, max_tokens) né «tokenizer».
const NOME = String.raw`[A-Za-z0-9_.-]*(?:password|passwd|passphrase|pwd|secret|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|(?:access|refresh|auth|bearer|session|api|bot|gh|github)?[_-]?token|credentials?)`;
export const NOME_SEGRETO = new RegExp(`^${NOME}$`, 'i');

const TIPI = new Set(['presente', 'assente', 'impostato', 'impostata', 'mancante', 'vuoto', 'vuota', 'found', 'missing', 'set', 'unset', 'present', 'absent', 'redacted', 'string', 'number', 'boolean', 'null', 'undefined', 'true', 'false', 'required', 'optional', 'none', 'nil', 'any', 'object', 'str', 'int', 'bool', 'text', 'varchar', 'password', 'secret', 'token', 'hidden']);

/** il valore è un segnaposto, un riferimento o un tipo, non un segreto? */
export function nonSegreto(v, nome = '') {
  const s = String(v ?? '').trim().replace(/[,;]+$/, '');
  if (s.length < 4) return true;
  if (/\s/.test(s)) return true; // una frase o un prompt («Client secret: »), non un valore
  if (/[<>]/.test(s)) return true; // tipo generico o tag (Option<String>)
  if (new RegExp(`^${NOME}$`, 'i').test(s) || /^[a-z]+(?:password|secret|token)[A-Za-z]*(?:\.\w+)*$/i.test(s)) return true; // idToken: idToken, passwordController.text
  if (s.includes(SEGNAPOSTO) || /\[(?:oscurato|redacted|censurato)\]|\*{3,}|•{3,}|x{4,}|\.{3}/i.test(s)) return true;
  if (/^[$<%{]|^\{\{|^process\.env|^Deno\.env|^os\.environ|^import\.meta|^env\b/i.test(s)) return true;
  if (TIPI.has(s.toLowerCase())) return true;
  if (/[()]/.test(s) && /^[\w$.]+\(/.test(s)) return true; // chiamata di funzione
  if (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+$/.test(s)) return true; // req.body.password
  if (/^\d+$/.test(s) && !/pass|pwd|pin/i.test(nome)) return true; // numero, salvo una password
  if (/^(?:your|tua|la[_-]?tua|example|esempio|changeme|placeholder|dummy|test[_-]?value)[\w-]*$/i.test(s)) return true;
  return false;
}

/**
 * regole sul testo: [tipo, regex globale, funzione che riceve il match e ritorna il testo nuovo o
 * null per lasciarlo]
 */
const REGOLE = [
  ['chiave privata', /(-----BEGIN ([A-Z ]*)PRIVATE KEY-----)[\s\S]*?(-----END \2PRIVATE KEY-----)/g, (m, a, _t, b) => `${a}${m.slice(a.length, m.length - b.length).replace(/[^\n]+/g, SEGNAPOSTO)}${b}`], // stesse righe
  ['token GitHub', /\bgh[pousr]_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, () => SEGNAPOSTO],
  ['chiave Stripe', /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/g, () => SEGNAPOSTO],
  ['chiave API sk-', /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}/g, () => SEGNAPOSTO],
  ['chiave AWS', /\bAKIA[0-9A-Z]{16}\b/g, () => SEGNAPOSTO],
  ['token Slack', /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, () => SEGNAPOSTO],
  ['chiave Google', /\bAIza[0-9A-Za-z_-]{35}/g, () => SEGNAPOSTO],
  ['token HubSpot', /\bpat-[a-z0-9]{2,4}-[a-f0-9-]{20,}/g, () => SEGNAPOSTO],
  ['chiave Supabase', /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}|\bsbp_[a-f0-9]{30,}/g, () => SEGNAPOSTO],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, () => SEGNAPOSTO],
  ['Bearer', /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{16,})/gi, (m, a, v) => (nonSegreto(v) ? null : `${a}${SEGNAPOSTO}`)],
  ['credenziali in un URL', /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@'"`]+:)([^\s@/'"`]+)(@)/gi, (m, a, v, b) => (nonSegreto(v, 'password') ? null : `${a}${SEGNAPOSTO}${b}`)],
  ['curl -u', /((?:^|\s)(?:-u|--user)\s+['"]?[^\s:'"]+:)([^\s'"]+)/g, (m, a, v) => (nonSegreto(v, 'password') ? null : `${a}${SEGNAPOSTO}`)],
  // nome segreto = "valore" / : 'valore' (anche dentro un JSON in una stringa, con le virgolette escapate)
  ['assegnazione', new RegExp(String.raw`(\b${NOME}\\?["']?\s*[:=]\s*\\?(["']))((?:(?!\2)[^\\\n]|\\(?!\2).){1,300}?)(\\?\2)`, 'gi'), (m, a, _q, v, b) => (nonSegreto(v, a) ? null : `${a}${SEGNAPOSTO}${b}`)],
  // nome segreto=valore senza virgolette (shell, .env, query string, --password valore)
  ['assegnazione', new RegExp(String.raw`(\b${NOME}=|--(?:password|passwd|pass|token|secret|api-key)[= ])([^\s'"\x60,;&|)<>\\]{4,})`, 'gi'), (m, a, v) => (nonSegreto(v, a) ? null : `${a}${SEGNAPOSTO}`)],
  // YAML / riga «password: valore» senza virgolette
  ['assegnazione', new RegExp(String.raw`(^[ \t-]*${NOME}:[ \t]+)([^\s'"#\x60{[][^\s#]{3,})[ \t]*$`, 'gim'), (m, a, v) => (nonSegreto(v, a) ? null : `${a}${SEGNAPOSTO}`)],
];

/**
 * censura un testo
 * @returns {{testo: string, conta: Record<string, number>}}
 */
export function censuraTesto(testo) {
  let t = String(testo);
  const conta = {};
  for (const [tipo, re, f] of REGOLE) {
    t = t.replace(re, (...args) => {
      const nuovo = f(...args);
      if (nuovo === null || nuovo === args[0]) return args[0];
      conta[tipo] = (conta[tipo] || 0) + 1;
      return nuovo;
    });
  }
  return { testo: t, conta };
}

function somma(a, b) {
  for (const [k, n] of Object.entries(b)) a[k] = (a[k] || 0) + n;
  return a;
}

/**
 * censura un valore JSON: le stringhe con censuraTesto, e il valore intero di un campo con un nome
 * segreto (`"password": "…"`). Ritorna il valore nuovo (lo stesso oggetto se non cambia nulla).
 * `dove` conta i riscontri dentro i blocchi di ragionamento (`thinking`), che hanno una firma.
 */
export function censuraJson(v, conta = {}, dove = { thinking: 0 }, nome = '', inThinking = false) {
  if (typeof v === 'string') {
    if (nome && NOME_SEGRETO.test(nome) && !nonSegreto(v, nome) && !/\s/.test(v.trim())) {
      conta['campo JSON'] = (conta['campo JSON'] || 0) + 1;
      if (inThinking) dove.thinking++;
      return SEGNAPOSTO;
    }
    const r = censuraTesto(v);
    if (r.testo !== v) {
      somma(conta, r.conta);
      if (inThinking) dove.thinking += Object.values(r.conta).reduce((a, n) => a + n, 0);
    }
    return r.testo;
  }
  if (Array.isArray(v)) {
    let cambiato = false;
    const out = v.map((x) => {
      const y = censuraJson(x, conta, dove, '', inThinking);
      if (y !== x) cambiato = true;
      return y;
    });
    return cambiato ? out : v;
  }
  if (v && typeof v === 'object') {
    const thinking = inThinking || v.type === 'thinking';
    let cambiato = false;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const y = censuraJson(x, conta, dove, k, thinking);
      if (y !== x) cambiato = true;
      out[k] = y;
    }
    return cambiato ? out : v;
  }
  return v;
}

/**
 * censura un file .jsonl: le righe senza riscontri restano identiche byte per byte; quelle con
 * riscontri si riscrivono con JSON.stringify. Le righe non JSON restano come sono.
 * @returns {{testo, conta, righe, righeCambiate, nonJson, thinking}}
 */
export function censuraJsonl(testo) {
  const conta = {};
  const dove = { thinking: 0 };
  let righeCambiate = 0;
  let nonJson = 0;
  const righe = testo.split('\n');
  const out = righe.map((l) => {
    if (!l.trim()) return l;
    let o;
    try {
      o = JSON.parse(l);
    } catch {
      nonJson++;
      return l;
    }
    const n = censuraJson(o, conta, dove);
    if (n === o) return l;
    righeCambiate++;
    return JSON.stringify(n);
  });
  return { testo: out.join('\n'), conta, righe: righe.length, righeCambiate, nonJson, thinking: dove.thinking };
}

/** censura un file di testo (.txt dei risultati degli strumenti) */
export function censuraTxt(testo) {
  const r = censuraTesto(testo);
  const righe = testo.split('\n');
  const nuove = r.testo.split('\n');
  return { testo: r.testo, conta: r.conta, righe: righe.length, righeCambiate: righe.filter((l, i) => l !== nuove[i]).length, nonJson: 0, thinking: 0 };
}
