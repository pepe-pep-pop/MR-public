/**
 * repomap.mjs — mappa locale doc → repo del codice: `mr.repos.yaml` (PRD v0.6 R10, nota A9).
 *
 *   # mr.repos.yaml, nella root del repo dei doc (oppure --repos-file)
 *   repos:                          # nome → path locale, relativo alla root del repo dei doc
 *     app-web: apps/app-web
 *     ordini: apps/ordini
 *   map:                            # vale la PRIMA regola che corrisponde al path del doc
 *     - docs: "_arch/hof/app-web/**"
 *       repos: [app-web]
 *     - docs: "_code/_arch/**"
 *       repos: [self, app-web, ordini]   # self = il repo dei doc
 *
 *   esterni: [backend]              # 0.6-f: repo dove possono vivere nomi citati dai doc
 *                                   # (anche dentro una regola di map); un not_found trovato
 *                                   # lì ha esito `external`, non `not_found`
 *
 * Vincolo (A9): un claim conta trovato solo nei repo mappati per quel doc o cartella, non
 * in uno qualsiasi. Un doc senza regola usa solo il proprio repo. Solo repo locali:
 * nessuna rete, niente `gh api` (fase 0.6-d).
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { RepoView } from './repo.mjs';

export const REPOS_FILE = 'mr.repos.yaml';

function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++; // **/ = zero o più cartelle
    } else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export class RepoMap {
  /**
   * @param {RepoView} docRepo
   * @param {string} text - contenuto YAML
   * @param {string} baseDir - cartella rispetto a cui risolvere i path dei repo
   * @param {string|null} codeRev - commit dei repo di codice (--code-rev), null = working tree
   */
  constructor(docRepo, text, baseDir, codeRev = null, source = REPOS_FILE) {
    this.docRepo = docRepo;
    this.source = source;
    const data = parseYaml(text, { schema: 'failsafe' }) || {};
    const errors = [];
    this.repos = new Map([['self', docRepo]]);
    for (const [name, rel] of Object.entries(data.repos || {})) {
      const abs = resolve(baseDir, String(rel));
      if (!existsSync(abs)) {
        errors.push(`repo "${name}": cartella non trovata (${rel})`);
        continue;
      }
      const view = RepoView.forPath(abs, codeRev);
      if (!view) {
        errors.push(`repo "${name}": ${rel} non è dentro un repo git`);
        continue;
      }
      this.repos.set(name, view.root === docRepo.root && !codeRev ? docRepo : view);
    }
    const externals = (list, where) => {
      if (list === undefined) return null;
      if (!Array.isArray(list)) {
        errors.push(`${where}: esterni deve essere una lista`);
        return null;
      }
      const unknown = list.filter((n) => !this.repos.has(String(n)));
      if (unknown.length) errors.push(`${where}: repo esterni non dichiarati in repos: ${unknown.join(', ')}`);
      return list.map(String);
    };
    this.externals = externals(data.esterni, 'esterni') || [];
    this.rules = [];
    for (const [i, r] of (Array.isArray(data.map) ? data.map : []).entries()) {
      if (!r || !r.docs || !Array.isArray(r.repos)) {
        errors.push(`map[${i}]: servono docs e repos (lista)`);
        continue;
      }
      const unknown = r.repos.filter((n) => !this.repos.has(n));
      if (unknown.length) errors.push(`map[${i}]: repo non dichiarati in repos: ${unknown.join(', ')}`);
      this.rules.push({ docs: String(r.docs), re: globToRegex(String(r.docs)), names: r.repos.map(String), externals: externals(r.esterni, `map[${i}]`) });
    }
    if (errors.length) throw new Error(`${source}: ${errors.join('; ')}`);
  }

  /** carica mr.repos.yaml dalla root del repo dei doc (o da un file esplicito); null se assente */
  static load(docRepo, file = null, codeRev = null) {
    if (file) {
      if (!existsSync(file)) throw new Error(`mappa dei repo non trovata: ${file}`);
      // i path dei repo in un file esterno sono relativi alla root del repo dei doc
      return new RepoMap(docRepo, readFileSync(file, 'utf-8'), docRepo.root, codeRev, file);
    }
    if (!docRepo.hasFile(REPOS_FILE)) return null;
    return new RepoMap(docRepo, docRepo.readFile(REPOS_FILE), docRepo.root, codeRev);
  }

  /** regola che vale per il doc, o null */
  ruleFor(docRel) {
    return this.rules.find((r) => r.re.test(docRel)) || null;
  }

  /** repo di codice per un doc (la prima regola che corrisponde; senza regola: solo self) */
  reposFor(docRel) {
    const rule = this.ruleFor(docRel);
    return rule ? rule.names.map((n) => this.repos.get(n)) : [this.docRepo];
  }

  /** repo esterni per un doc: quelli della sua regola, altrimenti quelli globali */
  externalsFor(docRel) {
    const rule = this.ruleFor(docRel);
    const names = rule?.externals ?? this.externals;
    return names.map((n) => this.repos.get(n)).filter(Boolean);
  }

  /** tutti i repo dichiarati (per i code_refs con repo: esplicito) */
  allRepos() {
    return [...new Set(this.repos.values())];
  }
}
