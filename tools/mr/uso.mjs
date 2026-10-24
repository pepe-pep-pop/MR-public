#!/usr/bin/env node
/**
 * uso.mjs — quante volte gli agenti usano MR, a settimana (0.6-z17, indicatore 5 della §12 di
 * `_arch/tool/valutazioni/mr-performance-2026-10-18.md`).
 *
 *   node tools/mr/uso.mjs [--dir <cartella dei transcript>] [--settimane <n>] [--tsv] [--dettaglio]
 *
 * Legge i transcript di Claude Code (`~/.claude/projects/<progetto>/**.jsonl`) e conta i comandi Bash
 * che lanciano MR: `mr trova`, `mr impact`, gli altri sottocomandi di `mr`, `mr-validate`, il giro.
 * Gruppi per progetto: `mr` (questo repo e i suoi worktree), `arch`, `altri`. L'indicatore è
 * (trova + impact) degli `altri`, contro il totale delle loro invocazioni di MR: oggi quasi tutte
 * sono di manutenzione dei doc (mr-validate, date, rivisto).
 *
 * Sola lettura. Stampa solo conteggi: niente testo dei comandi, dei messaggi o dei path.
 * Una chiamata con lo stesso id in più transcript (sessioni riprese) conta una volta.
 * Con --tsv: una riga per settimana e gruppo, da aggiungere a `mr-performance.tsv` (lo tiene arch).
 *
 * 0.6-z20 (il maintainer, 22/10, proposta A: nessun log scritto da `mr trova`): anche le attivazioni della
 * skill `chi-sa-cosa`, le ricerche di `mr trova` senza risultati e quelle seguite, entro 30 minuti
 * nella stessa trascrizione, da un Read di uno dei doc restituiti («doc aperto dopo»). `--dettaglio`:
 * le stesse misure per giorno (UTC) e progetto.
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { progettoIUD, percorsoIUD } from './lib/iud.mjs';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';

const SOTTOCOMANDI = ['trova', 'impact', 'indice', 'claims', 'scan', 'verify', 'suggest-links', 'remap', 'coverage', 'rivisto', 'date', 'vivi', 'env', 'stato'];
const RE_MR = new RegExp(String.raw`(?:mr\.mjs|(?:^|[\s;&|(])mr)\s+(?:--?\S+\s+)*?(${SOTTOCOMANDI.join('|')})\b`, 'g');
const RE_VALIDATE = /mr-validate\.mjs/g;
const RE_GIRO = /mr\/giro\.mjs/g;

/** gruppo del progetto dal nome della cartella dei transcript */
export function gruppo(nomeProgetto) {
  if (/-soft-MR(-|$)|-wt-MR(-|$)/.test(nomeProgetto)) return 'mr';
  if (/--code--arch(-|$)/.test(nomeProgetto)) return 'arch';
  return 'altri';
}

/** settimana ISO (2026-W43) di una data */
export function settimana(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const g = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - g);
  const inizio = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t - inizio) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

/** invocazioni di MR in un comando Bash: { trova, impact, altri_mr, validate, giro } */
export function invocazioni(cmd) {
  const c = { trova: 0, impact: 0, altri_mr: 0, validate: 0, giro: 0 };
  for (const m of String(cmd).matchAll(RE_MR)) {
    if (m[1] === 'trova') c.trova++;
    else if (m[1] === 'impact') c.impact++;
    else c.altri_mr++;
  }
  c.validate = (String(cmd).match(RE_VALIDATE) || []).length;
  c.giro = (String(cmd).match(RE_GIRO) || []).length;
  return c;
}

function jsonl(dir) {
  const out = [];
  if (progettoIUD(basename(resolve(dir))) || percorsoIUD(dir)) return out; // --dir su IUD: niente
  const walk = (d) => {
    let es = [];
    try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (progettoIUD(e.name) || percorsoIUD(p)) continue; // IUD: mai letto (0.6-z31)
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** nome breve del progetto dalla cartella dei transcript (app-web, my-lessons-mylessons, arch) */
export function nomeProgetto(cartella) {
  return cartella.replace(/^-Users-[^-]+-Documents-GL--code--(?:soft-)?/, '').replace(/^-Users-[^-]+-?/, '~') || '~';
}

const VUOTO = () => ({ trova: 0, impact: 0, altri_mr: 0, validate: 0, giro: 0, chi_sa_cosa: 0, trova_vuote: 0, trova_doc_aperto: 0 });
const MISURE = ['trova', 'impact', 'altri_mr', 'validate', 'giro'];
const APERTO_ENTRO = 30 * 60000;

/** esito di `mr trova` dal testo del suo risultato: numero di doc e percorsi stampati */
export function esitoTrova(testo) {
  const t = String(testo || '');
  const m = t.match(/^# Trova «[^\n]*— (\d+) di \d+/m);
  const percorsi = [...t.matchAll(/^ {3}(\/[^\n]*\.md)$/gm)].map((x) => x[1]);
  return { risultati: m ? Number(m[1]) : /Nessun doc/.test(t) ? 0 : null, percorsi };
}

/**
 * conteggi per settimana e gruppo, e per giorno e progetto
 * @returns {{settimane: object[], giorni: object[]}}
 */
export function misura(dir, { settimane = 4, ora = new Date() } = {}) {
  const limite = new Date(ora.getTime() - settimane * 7 * 86400000);
  const visti = new Set();
  const perSettimana = new Map(); // settimana|gruppo → conteggi
  const perGiorno = new Map(); // giorno|progetto → conteggi
  const somma = (mappa, k, c) => {
    const r = mappa.get(k) || VUOTO();
    for (const x of Object.keys(c)) r[x] += c[x];
    mappa.set(k, r);
  };
  if (progettoIUD(basename(resolve(dir))) || percorsoIUD(dir)) return { settimane: [], giorni: [] }; // --dir su IUD: niente
  for (const progetto of readdirSync(dir)) {
    const pdir = join(dir, progetto);
    if (progettoIUD(progetto) || percorsoIUD(pdir)) continue; // IUD: mai letto, nemmeno con stat (0.6-z31)
    if (!statSync(pdir).isDirectory()) continue;
    const g = gruppo(progetto);
    const nome = nomeProgetto(progetto);
    for (const f of jsonl(pdir)) {
      if (statSync(f).mtime < limite) continue;
      const ricerche = []; // { id, ts, chiavi }
      const risultati = new Map(); // tool_use_id → testo
      const letture = []; // { ts, path }
      for (const l of readFileSync(f, 'utf-8').split('\n')) {
        const bash = l.includes('"Bash"') && /mr|giro/.test(l);
        const skill = l.includes('"Skill"') && l.includes('chi-sa-cosa');
        const read = l.includes('"Read"');
        const res = l.includes('tool_result') && l.includes('Trova «');
        if (!bash && !skill && !read && !res) continue;
        let o;
        try { o = JSON.parse(l); } catch { continue; }
        const ts = new Date(o.timestamp);
        if (Number.isNaN(ts.getTime()) || ts < limite) continue;
        const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
        const chiavi = [`${settimana(ts)}|${g}`, `${ts.toISOString().slice(0, 10)}|${nome}`];
        for (const b of content) {
          if (!b) continue;
          if (b.type === 'tool_result' && res) {
            risultati.set(b.tool_use_id, Array.isArray(b.content) ? b.content.map((x) => (x && x.text) || '').join('') : String(b.content || ''));
            continue;
          }
          if (b.type !== 'tool_use' || !b.input) continue;
          if (b.name === 'Read') { letture.push({ ts, path: String(b.input.file_path || '') }); continue; }
          if (b.id && visti.has(b.id)) continue;
          if (b.name === 'Skill' && b.input.skill === 'chi-sa-cosa') {
            if (b.id) visti.add(b.id);
            somma(perSettimana, chiavi[0], { chi_sa_cosa: 1 });
            somma(perGiorno, chiavi[1], { chi_sa_cosa: 1 });
            continue;
          }
          if (b.name !== 'Bash') continue;
          if (b.id) visti.add(b.id);
          const c = invocazioni(b.input.command || '');
          if (!MISURE.some((x) => c[x])) continue;
          somma(perSettimana, chiavi[0], c);
          somma(perGiorno, chiavi[1], c);
          if (c.trova) ricerche.push({ id: b.id, ts, chiavi });
        }
      }
      // esito delle ricerche: vuote, e doc restituito aperto dopo (stessa trascrizione, entro 30 minuti)
      for (const r of ricerche) {
        const e = esitoTrova(risultati.get(r.id));
        const c = { trova_vuote: e.risultati === 0 ? 1 : 0, trova_doc_aperto: letture.some((x) => x.ts >= r.ts && x.ts - r.ts <= APERTO_ENTRO && e.percorsi.includes(x.path)) ? 1 : 0 };
        somma(perSettimana, r.chiavi[0], c);
        somma(perGiorno, r.chiavi[1], c);
      }
    }
  }
  const righe = (mappa, a, b) => [...mappa].map(([k, r]) => {
    const [x, y] = k.split('|');
    return { [a]: x, [b]: y, ...r, totale: MISURE.reduce((n, m) => n + r[m], 0) };
  }).sort((p, q) => p[a].localeCompare(q[a]) || p[b].localeCompare(q[b]));
  return { settimane: righe(perSettimana, 'settimana', 'gruppo'), giorni: righe(perGiorno, 'giorno', 'progetto') };
}

/** conteggi per settimana e gruppo (0.6-z17; dalla z20 con chi_sa_cosa, trova_vuote, trova_doc_aperto) */
export function conta(dir, opts = {}) {
  return misura(dir, opts).settimane;
}

function main(argv) {
  let dir = join(homedir(), '.claude', 'projects');
  let settimane = 4;
  let tsv = false;
  let dettaglio = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') dir = resolve(argv[++i] || '');
    else if (a === '--settimane') settimane = Number(argv[++i]);
    else if (a === '--tsv') tsv = true;
    else if (a === '--dettaglio') dettaglio = true;
    else if (a === '--help' || a === '-h') { console.log('uso: node tools/mr/uso.mjs [--dir <d>] [--settimane <n>] [--tsv] [--dettaglio]'); return 0; }
    else { console.error(`argomento sconosciuto: ${a}`); return 2; }
  }
  if (!Number.isInteger(settimane) || settimane < 1) { console.error('--settimane vuole un intero positivo'); return 2; }
  if (!existsSync(dir)) { console.error(`cartella dei transcript non trovata: ${dir}`); return 2; }
  const m = misura(dir, { settimane });
  // colonne nuove in fondo (0.6-z20): le righe già in mr-performance.tsv restano allineate
  const COL = ['settimana', 'gruppo', 'trova', 'impact', 'altri_mr', 'validate', 'giro', 'totale', 'chi_sa_cosa', 'trova_vuote', 'trova_doc_aperto'];
  const COL_G = ['giorno', 'progetto', 'trova', 'trova_vuote', 'trova_doc_aperto', 'chi_sa_cosa', 'impact', 'totale'];
  const righe = dettaglio ? m.giorni.filter((r) => r.trova || r.chi_sa_cosa || r.impact) : m.settimane;
  const col = dettaglio ? COL_G : COL;
  if (tsv) {
    console.log([col.join('\t'), ...righe.map((r) => col.map((c) => r[c]).join('\t'))].join('\n'));
    return 0;
  }
  if (dettaglio) {
    const L = [`# mr trova, chi-sa-cosa e impact per giorno (UTC) e progetto — ultime ${settimane} settimane`, '', `| ${COL_G.join(' | ')} |`, `|${COL_G.map(() => '---').join('|')}|`];
    for (const r of righe) L.push(`| ${COL_G.map((c) => r[c]).join(' | ')} |`);
    if (!righe.length) L.push('', 'Nessuna chiamata.');
    L.push('', '«doc aperto dopo»: un Read di uno dei doc restituiti, nella stessa trascrizione, entro 30 minuti. Solo conteggi.');
    console.log(L.join('\n'));
    return 0;
  }
  const L = [`# Uso di MR negli ultimi ${settimane} settimane`, '', `| ${COL.join(' | ')} |`, `|${COL.map(() => '---').join('|')}|`];
  for (const r of righe) L.push(`| ${COL.map((c) => r[c]).join(' | ')} |`);
  L.push('', 'Indicatore (fuori da MR e arch): trova + impact sul totale delle invocazioni di MR.');
  for (const r of righe.filter((x) => x.gruppo === 'altri')) L.push(`- ${r.settimana}: ${r.trova + r.impact} su ${r.totale} (trova ${r.trova}, di cui vuote ${r.trova_vuote} e con un doc aperto dopo ${r.trova_doc_aperto}; impact ${r.impact}; skill chi-sa-cosa ${r.chi_sa_cosa})`);
  console.log(L.join('\n'));
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
