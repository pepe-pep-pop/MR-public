#!/usr/bin/env python3
"""
graph_report.py — MR Graph Report (inspired by Graphify's GRAPH_REPORT.md)

Produces a "top-level" plain-language summary of the MR knowledge graph:
  1. Overview stats
  2. God Nodes (most connected documents)
  3. Project Communities
  4. Cross-Project Bridges (surprising connections)
  5. Staleness Heat Map
  6. Suggested Questions

Deterministico (solo SPARQL locale), nessun LLM, nessuna rete. Sola lettura di
default: stampa il report su stdout. Con --write lo salva in --output (e, con
--wiki, scrive anche le pagine per comunità). Le comunità sono i namespace degli id
MR (`mr/...`, `arch/...`), letti dalla proprietà mr:namespace scritta da build_kg.py.

Usage:
    python graph_report.py --kg mr-kg.ttl                              # report su stdout
    python graph_report.py --kg mr-kg.ttl --write --output GRAPH_REPORT.md
    python graph_report.py --kg mr-kg.ttl --write --wiki               # anche la wiki per comunità
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, RDFS

MR = Namespace("https://rnd-lab.local/mr#")
RND = Namespace("https://rnd-lab.local/")


def _safe(text) -> str:
    """Strip chars that break cp1252 console."""
    if text is None:
        return ""
    return str(text).encode("ascii", "replace").decode("ascii").replace("?", "")


# ── SPARQL Queries ───────────────────────────────────────────────────────────

GOD_NODES_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?doc ?label (COUNT(?edge) AS ?degree) WHERE {
  VALUES ?rel { mr:dependsOn mr:requiredBy mr:relatedTo mr:hasTopic }
  ?doc ?rel ?edge .
  ?doc rdfs:label ?label .
} GROUP BY ?doc ?label ORDER BY DESC(?degree) LIMIT 30
"""

PROJECT_COMMUNITIES_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?label ?type WHERE {
  ?doc rdf:type mr:Document .
  ?doc rdfs:label ?label .
  OPTIONAL { ?doc mr:docType ?type }
}
"""

CROSS_PROJECT_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?srcLabel ?tgtLabel ?rel WHERE {
  VALUES ?rel { mr:dependsOn mr:relatedTo }
  ?src ?rel ?tgt .
  ?src rdfs:label ?srcLabel .
  ?tgt rdfs:label ?tgtLabel .
}
ORDER BY ?srcLabel
"""

STALENESS_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?label ?cstatus ?staleDays ?priority WHERE {
  ?doc rdfs:label ?label .
  ?doc mr:_computed_status ?cstatus .
  OPTIONAL { ?doc mr:_computed_staleness_days ?staleDays }
  OPTIONAL { ?doc mr:priority ?priority }
}
ORDER BY DESC(?staleDays)
"""

ALL_DOCS_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?label ?type ?status ?priority ?summary WHERE {
  ?doc rdf:type mr:Document .
  ?doc rdfs:label ?label .
  OPTIONAL { ?doc mr:docType ?type }
  OPTIONAL { ?doc mr:status ?status }
  OPTIONAL { ?doc mr:priority ?priority }
  OPTIONAL { ?doc rdfs:comment ?summary }
}
"""

ALL_CONCEPTS_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?label WHERE {
  ?c rdf:type mr:Concept .
  ?c rdfs:label ?label .
}
ORDER BY ?label
"""

ALL_RELATIONS_Q = """
PREFIX mr: <https://rnd-lab.local/mr#>
SELECT ?s ?p ?o WHERE {
  VALUES ?p { mr:dependsOn mr:requiredBy mr:relatedTo mr:propagateStalenessTo mr:supersededBy }
  ?s ?p ?o .
}
"""


# ── Report Generator ─────────────────────────────────────────────────────────

class GraphReport:
    def __init__(self, kg_path: str):
        self.kg_path = kg_path
        self.g = Graph()
        self.g.parse(kg_path, format="turtle")
        self.lines = []

    def _project(self, uri) -> str:
        """Comunità = namespace dell'id MR (mr:namespace), "other" se assente."""
        if uri is None:
            return "other"
        for ns in self.g.objects(URIRef(str(uri)), MR.namespace):
            return str(ns) or "other"
        return "other"

    def _h1(self, text):
        self.lines.append(f"\n# {text}\n")

    def _h2(self, text):
        self.lines.append(f"\n## {text}\n")

    def _h3(self, text):
        self.lines.append(f"\n### {text}\n")

    def _p(self, text):
        self.lines.append(f"{text}")

    def _ul(self, items):
        for item in items:
            self.lines.append(f"- {item}")

    def _table(self, headers, rows):
        self.lines.append("| " + " | ".join(headers) + " |")
        self.lines.append("|" + "|".join("---" for _ in headers) + "|")
        for row in rows:
            self.lines.append("| " + " | ".join(str(c) for c in row) + " |")

    def build(self):
        self._section_overview()
        self._section_god_nodes()
        self._section_project_communities()
        self._section_cross_project_bridges()
        self._section_staleness()
        self._section_suggested_questions()
        return "\n".join(self.lines)

    def _section_overview(self):
        self._h1("MR Knowledge Graph — Top-Level Report")
        self._p(f"> Generated {date.today().isoformat()} from `{Path(self.kg_path).name}`")
        self._p("> Deterministic, SPARQL-only analysis (inspired by Graphify's GRAPH_REPORT.md)")

        # Count documents
        doc_count = 0
        type_counts = Counter()
        status_counts = Counter()
        priority_counts = Counter()
        for r in self.g.query(ALL_DOCS_Q):
            doc_count += 1
            t = str(r.type).split("#")[-1] if r.type else "unknown"
            type_counts[t] += 1
            if r.status:
                s = str(r.status).split("#")[-1]
                status_counts[s] += 1
            if r.priority:
                p = str(r.priority).split("#")[-1]
                priority_counts[p] += 1

        concept_count = len(list(self.g.query(ALL_CONCEPTS_Q)))
        triple_count = len(self.g)
        rel_count = len(list(self.g.query(ALL_RELATIONS_Q)))

        self._h2("1. Overview")
        self._p(f"| **Metric** | **Value** |")
        self._p(f"|-----------|---|")
        self._p(f"| Documents | {doc_count} |")
        self._p(f"| Concepts  | {concept_count} |")
        self._p(f"| Triples   | {triple_count} |")
        self._p(f"| Relations (depends/required/related/propagate/superseded) | {rel_count} |")
        self._p("")
        self._p("**Document types:**")
        for t, c in type_counts.most_common():
            self._p(f"- {t}: {c}")
        self._p("")
        self._p("**Status distribution:**")
        for s, c in status_counts.most_common():
            self._p(f"- {s}: {c}")
        self._p("")
        self._p("**Priority distribution:**")
        for p, c in priority_counts.most_common():
            self._p(f"- {p}: {c}")

    def _section_god_nodes(self):
        self._h2("2. God Nodes (Top 20 Most Connected Documents)")
        self._p("Documents ranked by combined degree of depends_on + required_by + related_to + hasTopic edges.")
        self._p("")

        rows = []
        for r in self.g.query(GOD_NODES_Q):
            label = _safe(r.label)[:60]
            degree = int(r.degree)
            uri = str(r.doc)
            proj = self._project(uri)
            rows.append((degree, label, proj))

        if not rows:
            self._p("No god nodes found.")
            return

        self._table(["Rank", "Document", "Project", "Degree"], [
            (i + 1, label, proj, deg) for i, (deg, label, proj) in enumerate(rows[:20])
        ])

        # Highlight: God node with most cross-project reach
        self._p("")
        self._p(f"**Top god node:** {rows[0][1]} ({rows[0][2]}, degree={rows[0][0]})")

    def _section_project_communities(self):
        self._h2("3. Project Communities")
        self._p("Documents grouped by MR id namespace (mr:namespace, deterministic).")
        self._p("")

        # Collect all docs by community (URI -> mr:namespace)
        project_docs = defaultdict(list)
        for s in self.g.subjects(RDF.type, MR.Document):
            uri_str = str(s)
            proj = self._project(uri_str)
            for label_obj in self.g.objects(s, RDFS.label):
                project_docs[proj].append(_safe(str(label_obj))[:60])
                break

        if project_docs:
            self._table(["Project", "Documents", "Types"], [
                (proj, len(docs), ", ".join(f"{t}:{c}" for t, c in Counter(
                    str(o).split("#")[-1] for s in self.g.subjects(RDF.type, MR.Document)
                    if self._project(str(s)) == proj
                    for o in self.g.objects(s, RDF.type)
                ).most_common(3)))
                for proj, docs in sorted(project_docs.items(), key=lambda x: -len(x[1]))
            ])

    def _section_cross_project_bridges(self):
        self._h2("4. Cross-Project Bridges (Surprising Connections)")
        self._p("Documents that bridge two or more projects via depends_on or related_to.")
        self._p("")

        bridges = []
        for r in self.g.query(CROSS_PROJECT_Q):
            src = _safe(r.srcLabel)[:60]
            tgt = _safe(r.tgtLabel)[:60]
            rel = str(r.rel).split("#")[-1]
            bridges.append((src, tgt, rel))

        # Filter to cross-project only
        cross = []
        for src, tgt, rel in bridges:
            # Find the URIs via label
            src_uri = None
            tgt_uri = None
            for s in self.g.subjects(RDFS.label, Literal(src.strip('"'))):
                src_uri = str(s)
                break
            for s in self.g.subjects(RDFS.label, Literal(tgt.strip('"'))):
                tgt_uri = str(s)
                break
            if src_uri and tgt_uri:
                sp = self._project(src_uri)
                tp = self._project(tgt_uri)
                if sp != tp:
                    cross.append((src, tgt, rel, sp, tp))

        if not cross:
            self._p("No cross-project bridges found.")
            return

        # De-duplicate
        seen = set()
        unique_cross = []
        for item in cross:
            key = (item[0], item[1])
            if key not in seen:
                seen.add(key)
                unique_cross.append(item)

        self._table(["Source", "Target", "Relation", "Source Proj", "Target Proj"], [
            (s[:45], t[:45], rel, sp, tp) for s, t, rel, sp, tp in unique_cross[:25]
        ])

        # Summary stats
        bridge_projects = Counter()
        for _, _, _, sp, tp in unique_cross:
            bridge_projects[f"{sp}↔{tp}"] += 1

        self._p("")
        self._p("**Top cross-project bridges:**")
        for pair, count in bridge_projects.most_common(5):
            self._p(f"- {pair}: {count} connections")

    def _section_staleness(self):
        self._h2("5. Staleness Heat Map")
        self._p("Documents by computed freshness status, grouped by project.")
        self._p("")

        # Aggregate by project
        project_staleness = defaultdict(lambda: {"fresh": 0, "warning": 0, "stale": 0, "total": 0, "high_prio_stale": []})
        for r in self.g.query(STALENESS_Q):
            label = _safe(r.label)[:60]
            cstatus = str(r.cstatus).split("#")[-1] if r.cstatus else "unknown"

            # Find URI
            doc_uri = None
            for s in self.g.subjects(RDFS.label, Literal(label)):
                doc_uri = str(s)
                break
            proj = self._project(doc_uri) if doc_uri else "other"

            ps = project_staleness[proj]
            ps["total"] += 1
            if cstatus == "Fresh":
                ps["fresh"] += 1
            elif cstatus == "Stale":
                ps["stale"] += 1
            else:
                ps["warning"] += 1

            if r.priority and "High" in str(r.priority) and cstatus == "Stale":
                stale_days = int(r.staleDays) if r.staleDays and str(r.staleDays).isdigit() else 0
                ps["high_prio_stale"].append((label, stale_days))

        if project_staleness:
            self._table(["Project", "Total", "Fresh", "Warning", "Stale", "Stale %"], [
                (proj, ps["total"], ps["fresh"], ps["warning"], ps["stale"],
                 f"{ps['stale'] / max(1, ps['total']) * 100:.0f}%")
                for proj, ps in sorted(project_staleness.items(), key=lambda x: -x[1]["total"])
            ])

            # Highlight: high-priority stale docs
            all_hp_stale = []
            for proj, ps in project_staleness.items():
                for label, days in ps["high_prio_stale"]:
                    all_hp_stale.append((label, days, proj))

            if all_hp_stale:
                all_hp_stale.sort(key=lambda x: -x[1])
                self._p("")
                self._p("**Stale high-priority documents (needs attention):**")
                self._table(["Document", "Days Stale", "Project"], [
                    (label[:50], days, proj) for label, days, proj in all_hp_stale[:10]
                ])

    def _section_suggested_questions(self):
        self._h2("6. Suggested Questions")
        self._p("Questions the graph structure naturally raises, for the `mr-query` skill (Claude Code):")
        self._p("")

        questions = [
            ("Project exploration",
             "Which namespace has the most cross-namespace dependencies?"),
            ("Staleness focus",
             "Which high-priority documents are stale?"),
            ("Concept sharing",
             "What concepts are shared between two namespaces?"),
            ("Dependency chain",
             "What does the most-depended-upon document depend on?"),
            ("Freshness ranking",
             "Show me all projects ranked by staleness percentage"),
            ("Document type distribution",
             "How many handoff documents exist per project?"),
            ("Priority health check",
             "Which stale documents have high priority and need immediate review?"),
            ("Community exploration",
             "List all documents in the MR project that have cross-project related_to links"),
            ("Topic clustering",
             "What are the most common keywords across all draft documents?"),
            ("Graph balance",
             "Which project has the most documents but the fewest cross-project relationships?"),
        ]

        for i, (topic, q) in enumerate(questions, 1):
            self._p(f"**Q{i}: {topic}**")
            self._p(f"> {q}")
            self._p("")

    def wiki_export(self, output_dir: Path):
        """Export per-community wiki pages (like Graphify's --wiki)."""
        output_dir.mkdir(parents=True, exist_ok=True)

        # Collect docs by project
        project_docs = defaultdict(list)
        for s in self.g.subjects(RDF.type, MR.Document):
            uri_str = str(s)
            proj = self._project(uri_str)
            labels = list(self.g.objects(s, RDFS.label))
            label = str(labels[0]) if labels else uri_str.split("-")[-1]
            project_docs[proj].append((uri_str, label))

        # Generate index
        index_lines = ["# MR Knowledge Graph — Community Index", "",
                       "| Community | Documents | Description |",]
        for proj, docs in sorted(project_docs.items(), key=lambda x: -len(x[1])):
            link = proj.lower().replace(" ", "-")
            index_lines.append(f"| [{proj}]({link}.md) | {len(docs)} | MR-tagged documents in the {proj} project |")

        index_lines.append("")
        index_lines.append("---")
        index_lines.append("")
        index_lines.append(f"Generated {date.today().isoformat()} by graph_report.py --wiki")

        (output_dir / "index.md").write_text("\n".join(index_lines), encoding="utf-8")

        # Generate per-community page
        for proj, docs in project_docs.items():
            link = proj.lower().replace(" ", "-")
            page = [f"# {proj} Community", "",
                    f"**{len(docs)} documents**", "",
                    "| Document |", "|---|---|"]
            for uri, label in sorted(docs, key=lambda x: x[1]):
                page.append(f"| {label} | {uri} |")

            page.append("")
            page.append(f"---\nGenerated {date.today().isoformat()}")
            (output_dir / f"{link}.md").write_text("\n".join(page), encoding="utf-8")

        print(f"  Wiki exported to {output_dir}/ (index.md + {len(project_docs)} community pages)")


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="MR Graph Report — Top-Level KG Summary")
    parser.add_argument("--kg", default="mr-kg.ttl",
                        help="Path to Turtle KG file (default: mr-kg.ttl)")
    parser.add_argument("--output", default="GRAPH_REPORT.md",
                        help="Output markdown path, used with --write (default: GRAPH_REPORT.md)")
    parser.add_argument("--write", action="store_true",
                        help="Save the report (and the wiki with --wiki). Without it, print to stdout only")
    parser.add_argument("--wiki", action="store_true",
                        help="Also export per-community wiki pages (requires --write)")
    parser.add_argument("--wiki-dir", default="graph-community-wiki",
                        help="Wiki output directory (default: graph-community-wiki)")
    args = parser.parse_args()
    if args.wiki and not args.write:
        parser.error("--wiki writes files: add --write")

    kg_path = Path(args.kg)
    if not kg_path.exists():
        print(f"ERROR: KG not found: {kg_path}")
        sys.exit(1)

    print(f"  Loading KG: {kg_path}...", end=" ", flush=True)
    report = GraphReport(str(kg_path))
    print(f"{len(report.g)} triples loaded")

    print(f"  Generating report...", end=" ", flush=True)
    md = report.build()
    print("done")

    if not args.write:
        print(md)
        return

    out_path = Path(args.output)
    out_path.write_text(md, encoding="utf-8")
    print(f"  Report saved: {out_path}")

    if args.wiki:
        report.wiki_export(Path(args.wiki_dir))


if __name__ == "__main__":
    main()
