#!/usr/bin/env node
/**
 * censura.mjs — password, token e chiavi censurati nelle trascrizioni delle sessioni (0.6-z19).
 *
 *   node tools/mr/censura.mjs [--dir <d>] [--solo <id,…>] [--minuti <n>] [--json]          prova a vuoto
 *   node tools/mr/censura.mjs --solo <id,…> --write [--dir <d>] [--minuti <n>] [--cestino <d>]   applica
 *
 * - File: i `.jsonl` delle sessioni e dei subagenti, e i `.txt` dei risultati degli strumenti, sotto
 *   `~/.claude/projects` (`--dir` per un'altra cartella). `--solo`: solo i file il cui percorso contiene
 *   uno degli id (prefisso della sessione: comprende i suoi subagenti e i suoi risultati).
 * - Prova a vuoto (default): per file, id, progetto, righe e riscontri per tipo. Mai i valori.
 * - `--write`: vuole `--solo` (si applica solo ai file scelti). Salta i file modificati negli ultimi
 *   `--minuti` (60): la sessione potrebbe essere attiva e scriverci. Prima copia ogni file nel
 *   Cestino (`~/.Trash/mr-censura-<data>/`, o `--cestino`): la copia contiene i valori, la svuota
 *   il maintainer. Poi scrive un file temporaneo, controlla lo stesso numero di righe, JSON valido dove lo
 *   era, e zero riscontri; solo allora lo sostituisce, con la data di modifica di prima.
 *
 * Exit: 0 eseguito, 1 un file non verificato (lasciato com'era), 2 errore d'uso.
 */

import { readdirSync, readFileSync, statSync, existsSync, mkdirSync, copyFileSync, writeFileSync, renameSync, utimesSync, chmodSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { censuraJsonl, censuraTxt } from './lib/censura.mjs';

function file(dir) {
  const out = [];
  const walk = (d) => {
    let es = [];
    try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && (e.name.endsWith('.jsonl') || (e.name.endsWith('.txt') && p.includes('/tool-results/')))) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** id breve della sessione (8 caratteri) e progetto, dal percorso */
function etichetta(dir, p) {
  const rel = relative(dir, p).split('/');
  const progetto = rel[0].replace(/^-Users-[^-]+-Documents-GL--code--(?:soft-)?/, '').replace(/^-Users-[^-]+-?/, '~') || '~';
  const sessione = rel[1].slice(0, 8);
  const tipo = rel.includes('subagents') ? 'subagente' : rel.includes('tool-results') ? 'risultato' : 'sessione';
  return { progetto, sessione, tipo };
}

export function analizza(p) {
  const testo = readFileSync(p, 'utf-8');
  return { originale: testo, ...(p.endsWith('.jsonl') ? censuraJsonl(testo) : censuraTxt(testo)) };
}

/** controlli sul testo censurato prima di sostituire il file */
export function verifica(prima, dopo, jsonl) {
  const a = prima.split('\n');
  const b = dopo.split('\n');
  if (a.length !== b.length) return 'numero di righe diverso';
  if (jsonl) {
    for (let i = 0; i < a.length; i++) {
      if (!a[i].trim()) continue;
      let ok = true;
      try { JSON.parse(a[i]); } catch { ok = false; }
      if (!ok) continue;
      try { JSON.parse(b[i]); } catch { return `riga ${i + 1} non più JSON valido`; }
    }
  }
  const di_nuovo = jsonl ? censuraJsonl(dopo) : censuraTxt(dopo);
  if (Object.keys(di_nuovo.conta).length) return 'riscontri rimasti dopo la censura';
  return null;
}

function main(argv) {
  let dir = join(homedir(), '.claude', 'projects');
  let solo = null;
  let minuti = 60;
  let write = false;
  let json = false;
  let cestino = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') dir = resolve(argv[++i] || '');
    else if (a === '--solo') solo = String(argv[++i] || '').split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--minuti') minuti = Number(argv[++i]);
    else if (a === '--write') write = true;
    else if (a === '--json') json = true;
    else if (a === '--cestino') cestino = resolve(argv[++i] || '');
    else if (a === '--help' || a === '-h') { console.log('uso: node tools/mr/censura.mjs [--dir <d>] [--solo <id,…>] [--minuti <n>] [--json] [--write --solo <id,…> [--cestino <d>]]'); return 0; }
    else { console.error(`argomento sconosciuto: ${a}`); return 2; }
  }
  if (!Number.isFinite(minuti) || minuti < 0) { console.error('--minuti vuole un numero'); return 2; }
  if (solo && (!solo.length || solo.some((x) => !/^[0-9a-f-]{6,36}$/i.test(x)))) { console.error('--solo vuole id di sessione (esadecimali) separati da virgole'); return 2; }
  if (write && !solo) { console.error('--write vuole --solo <id,…>: si applica solo ai file scelti dopo la prova a vuoto'); return 2; }
  if (!existsSync(dir)) { console.error(`cartella non trovata: ${dir}`); return 2; }

  const ora = Date.now();
  const scelti = file(dir).filter((p) => !solo || solo.some((id) => relative(dir, p).includes(id)));
  const righe = [];
  const totale = {};
  let errori = 0;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const copie = cestino || join(homedir(), '.Trash', `mr-censura-${stamp}`);
  for (const p of scelti) {
    const st = statSync(p);
    const recente = ora - st.mtimeMs < minuti * 60000;
    let r;
    try { r = analizza(p); } catch (err) { righe.push({ ...etichetta(dir, p), file: basename(p), esito: `non letto (${err.code || 'errore'})` }); continue; }
    const n = Object.values(r.conta).reduce((a, x) => a + x, 0);
    if (!n) continue;
    for (const [k, x] of Object.entries(r.conta)) totale[k] = (totale[k] || 0) + x;
    const riga = { ...etichetta(dir, p), file: basename(p).slice(0, 12), righe: r.righe, righe_con_riscontri: r.righeCambiate, riscontri: n, per_tipo: r.conta, in_thinking: r.thinking, recente };
    if (write) {
      if (recente) riga.esito = `saltato: modificato da meno di ${minuti} minuti`;
      else {
        mkdirSync(copie, { recursive: true, mode: 0o700 });
        const copia = join(copie, relative(dir, p).replace(/\//g, '__'));
        copyFileSync(p, copia);
        try { chmodSync(copia, 0o600); } catch { /* */ }
        const nuovo = r.testo;
        const errore = verifica(r.originale, nuovo, p.endsWith('.jsonl'));
        if (errore) { riga.esito = `NON applicato: ${errore}`; errori++; }
        else if (statSync(p).mtimeMs !== st.mtimeMs) { riga.esito = 'NON applicato: il file è cambiato durante la censura'; errori++; }
        else {
          const tmp = `${p}.censura-${process.pid}.tmp`;
          writeFileSync(tmp, nuovo, { mode: st.mode & 0o777 });
          utimesSync(tmp, st.atime, st.mtime);
          renameSync(tmp, p);
          riga.esito = 'censurato';
        }
      }
    }
    righe.push(riga);
  }
  if (json) {
    console.log(JSON.stringify({ dir, solo, write, minuti, copie: write ? copie : null, file: righe, totale }, null, 2));
    return errori ? 1 : 0;
  }
  const L = [`# Censura delle trascrizioni — ${write ? 'applicata' : 'prova a vuoto (nulla è stato scritto)'}`, ''];
  L.push(`Cartella: ${dir.replace(homedir(), '~')} · file letti: ${scelti.length}${solo ? ` (solo ${solo.join(', ')})` : ''} · con riscontri: ${righe.length}`);
  L.push(`Riscontri per tipo: ${Object.entries(totale).map(([k, n]) => `${k} ${n}`).join(', ') || 'nessuno'}`, '');
  if (righe.length) {
    L.push(`| progetto | sessione | tipo | righe con riscontri | riscontri | per tipo | in thinking | ${write ? 'esito' : `modificato da < ${minuti} min`} |`, '|---|---|---|---|---|---|---|---|');
    for (const r of righe) L.push(`| ${r.progetto} | ${r.sessione} | ${r.tipo} | ${r.righe_con_riscontri ?? ''} | ${r.riscontri ?? ''} | ${Object.entries(r.per_tipo || {}).map(([k, n]) => `${k} ${n}`).join(', ')} | ${r.in_thinking || ''} | ${write ? r.esito : r.recente ? 'sì (si salta)' : ''} |`);
  }
  L.push('', 'Solo conteggi: i valori non si stampano mai.');
  if (write) L.push(`Copie di sicurezza (contengono i valori) nel Cestino: ${copie.replace(homedir(), '~')}. Da svuotare dopo la verifica.`);
  console.log(L.join('\n'));
  return errori ? 1 : 0;
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
