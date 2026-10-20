#!/usr/bin/env node
/**
 * uso.mjs — quante volte gli agenti usano MR, a settimana (0.6-z17, indicatore 5 della §12 di
 * `_arch/tool/valutazioni/mr-performance-2026-10-18.md`).
 *
 *   node tools/mr/uso.mjs [--dir <cartella dei transcript>] [--settimane <n>] [--tsv]
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
 */

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
  const walk = (d) => {
    let es = [];
    try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

export function conta(dir, { settimane = 4, ora = new Date() } = {}) {
  const limite = new Date(ora.getTime() - settimane * 7 * 86400000);
  const visti = new Set();
  const righe = new Map(); // settimana|gruppo → conteggi
  for (const progetto of readdirSync(dir)) {
    const pdir = join(dir, progetto);
    if (!statSync(pdir).isDirectory()) continue;
    const g = gruppo(progetto);
    for (const f of jsonl(pdir)) {
      if (statSync(f).mtime < limite) continue;
      for (const l of readFileSync(f, 'utf-8').split('\n')) {
        if (!l.includes('"Bash"') || !/mr|giro/.test(l)) continue;
        let o;
        try { o = JSON.parse(l); } catch { continue; }
        const ts = new Date(o.timestamp);
        if (Number.isNaN(ts.getTime()) || ts < limite) continue;
        const content = o.message && Array.isArray(o.message.content) ? o.message.content : [];
        for (const b of content) {
          if (!b || b.type !== 'tool_use' || b.name !== 'Bash' || !b.input) continue;
          if (b.id && visti.has(b.id)) continue;
          if (b.id) visti.add(b.id);
          const c = invocazioni(b.input.command || '');
          if (!(c.trova + c.impact + c.altri_mr + c.validate + c.giro)) continue;
          const k = `${settimana(ts)}|${g}`;
          const r = righe.get(k) || { trova: 0, impact: 0, altri_mr: 0, validate: 0, giro: 0 };
          for (const x of Object.keys(c)) r[x] += c[x];
          righe.set(k, r);
        }
      }
    }
  }
  return [...righe].map(([k, r]) => {
    const [sett, gr] = k.split('|');
    return { settimana: sett, gruppo: gr, ...r, totale: r.trova + r.impact + r.altri_mr + r.validate + r.giro };
  }).sort((a, b) => a.settimana.localeCompare(b.settimana) || a.gruppo.localeCompare(b.gruppo));
}

function main(argv) {
  let dir = join(homedir(), '.claude', 'projects');
  let settimane = 4;
  let tsv = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') dir = resolve(argv[++i] || '');
    else if (a === '--settimane') settimane = Number(argv[++i]);
    else if (a === '--tsv') tsv = true;
    else if (a === '--help' || a === '-h') { console.log('uso: node tools/mr/uso.mjs [--dir <d>] [--settimane <n>] [--tsv]'); return 0; }
    else { console.error(`argomento sconosciuto: ${a}`); return 2; }
  }
  if (!Number.isInteger(settimane) || settimane < 1) { console.error('--settimane vuole un intero positivo'); return 2; }
  if (!existsSync(dir)) { console.error(`cartella dei transcript non trovata: ${dir}`); return 2; }
  const righe = conta(dir, { settimane });
  const COL = ['settimana', 'gruppo', 'trova', 'impact', 'altri_mr', 'validate', 'giro', 'totale'];
  if (tsv) {
    console.log([COL.join('\t'), ...righe.map((r) => COL.map((c) => r[c]).join('\t'))].join('\n'));
    return 0;
  }
  const L = [`# Uso di MR negli ultimi ${settimane} settimane`, '', `| ${COL.join(' | ')} |`, `|${COL.map(() => '---').join('|')}|`];
  for (const r of righe) L.push(`| ${COL.map((c) => r[c]).join(' | ')} |`);
  L.push('', 'Indicatore (fuori da MR e arch): trova + impact sul totale delle invocazioni di MR.');
  for (const r of righe.filter((x) => x.gruppo === 'altri')) L.push(`- ${r.settimana}: ${r.trova + r.impact} su ${r.totale} (trova ${r.trova}, impact ${r.impact})`);
  console.log(L.join('\n'));
  return 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
