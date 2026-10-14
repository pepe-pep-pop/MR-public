#!/usr/bin/env python3
"""
build_kg.py — costruisce un Knowledge Graph RDF (Turtle) dai frontmatter MR.

Deterministico, nessun LLM, nessuna rete. Sola lettura di default: senza --write
costruisce il grafo in memoria e stampa statistiche e query di verifica; con
--write lo salva in --output.

Le directory si scandiscono con le esclusioni di default (mr_walk.py):
node_modules, .git, dist, build, cartelle nascoste, repo annidati, .gitignore.

Usage:
    python build_kg.py --dir <path> [--dir <path> ...]           # solo report
    python build_kg.py --dir <path> --write --output mr-kg.ttl   # salva il .ttl
    python build_kg.py --verify-only --output mr-kg.ttl          # verifica un .ttl esistente

Prerequisites (venv locale del repo MR):
    .venv/bin/pip install -r tools/mr-kg/requirements.txt
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from rdflib import Graph, Namespace, Literal, URIRef
from rdflib.namespace import RDF, RDFS, XSD
import yaml

from mr_walk import list_markdown_files


# === Namespaces ===
NS = Namespace("https://rnd-lab.local/")
MR = Namespace("https://rnd-lab.local/mr#")

# === MR type mapping ===
TYPE_MAP = {
    "index": MR.Index,
    "cross_cutting_doc": MR.CrossCuttingDoc,
    "ppd": MR.Document,
    "guide": MR.Document,
    "how-to": MR.Document,
    "reference": MR.Document,
    "report": MR.Document,
    "capsule": MR.ProjectCapsule,
}

STATUS_MAP = {
    "active": MR.Active,
    "draft": MR.Draft,
    "deprecated": MR.Deprecated,
    "superseded": MR.Superseded,
    "paused": MR.Paused,
    "fresh": MR.Fresh,
    "stale": MR.Stale,
    "warning": MR.Warning,
}

PRIORITY_MAP = {
    "high": MR.High,
    "medium": MR.Medium,
    "low": MR.Low,
}

# === Utility functions ===


def slug_to_uri(slug: str) -> URIRef:
    """Convert a dotted/mixed id like 'mr/matrix' or
    'docs/api-rest' into a URI-safe local name."""
    safe = slug.replace("/", "-").replace(".", "-").replace("_", "-")
    return NS[safe]


def extract_frontmatter(text: str) -> dict | None:
    """Extract YAML frontmatter from markdown text. Returns None if no frontmatter."""
    m = re.match(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if m:
        try:
            return yaml.safe_load(m.group(1))
        except yaml.YAMLError:
            return None
    return None


def extract_concepts_from_text(text: str, max_concepts: int = 8) -> list[str]:
    """Extract likely concept names from markdown body: ## headings and bold phrases.
    Returns ASCII-safe strings for cp1252 compatibility."""
    concepts = []
    # Extract h2/h3 headings (## ...)
    headings = re.findall(r"^## [#]?\s*(.+?)$", text, re.MULTILINE)
    for h in headings:
        h = h.strip()
        # Sanitize: strip emoji, unicode arrows, math symbols
        h = h.encode("ascii", "replace").decode("ascii")
        h = h.replace("?", "").strip()
        if h and len(h) < 60 and len(h) > 3:
            concepts.append(h)
    # Extract bold phrases (**...**)
    bolds = re.findall(r"\*\*(.+?)\*\*", text)
    for b in bolds:
        b = b.encode("ascii", "replace").decode("ascii")
        b = b.replace("?", "").strip()
        if b and len(b) < 60 and len(b) > 3 and b not in concepts:
            concepts.append(b)
    return concepts[:max_concepts]


def slug_for_concept(name: str) -> str:
    """Convert a concept name like 'Self-Hosting' into a URI-safe slug."""
    safe = re.sub(r"[^a-zA-Z0-9]", "", name.title().replace(" ", "").replace("-", ""))
    return safe


# === Main builder ===


def build_kg(
    scan_dirs: list[Path],
    output_path: str = "mr-kg.ttl",
    extract_headings: bool = False,
    exclude_patterns: list[str] | None = None,
    write: bool = False,
) -> Graph:
    """
    Scan directories for MR-tagged markdown files and build the KG.

    Args:
        scan_dirs: List of directory paths to scan recursively.
        output_path: Path for the output .ttl file (used only with write=True).
        extract_headings: If True, extract concepts from markdown headings too.
        exclude_patterns: extra directory names to skip, on top of the defaults.
        write: If True, serialize the graph to output_path.

    Returns:
        rdflib Graph.
    """
    g = Graph()
    g.bind("rnd", NS)
    g.bind("rdfs", RDFS)
    g.bind("mr", MR)
    g.bind("xsd", XSD)

    # --- Declare ontology classes ---
    ontology_declarations = [
        (MR.Document, RDF.type, RDFS.Class),
        (MR.Index, RDFS.subClassOf, MR.Document),
        (MR.CrossCuttingDoc, RDFS.subClassOf, MR.Document),
        (MR.ProjectCapsule, RDFS.subClassOf, MR.Document),
        (MR.TechnicalDossier, RDFS.subClassOf, MR.Document),
        (MR.Runbook, RDFS.subClassOf, MR.Document),
        (MR.Concept, RDF.type, RDFS.Class),
        (MR.Status, RDF.type, RDFS.Class),
        (MR.Priority, RDF.type, RDFS.Class),
        # Properties
        (MR.dependsOn, RDF.type, RDF.Property),
        (MR.requiredBy, RDF.type, RDF.Property),
        (MR.relatedTo, RDF.type, RDF.Property),
        (MR.propagateStalenessTo, RDF.type, RDF.Property),
        (MR.supersededBy, RDF.type, RDF.Property),
        (MR.docType, RDF.type, RDF.Property),
        (MR.hasTopic, RDF.type, RDF.Property),
        (MR.relatedToConcept, RDF.type, RDF.Property),
        (MR.status, RDF.type, RDF.Property),
        (MR.priority, RDF.type, RDF.Property),
        (MR.owner, RDF.type, RDF.Property),
        (MR.created, RDF.type, RDF.Property),
        (MR.lastUpdated, RDF.type, RDF.Property),
        (MR.aiKeywords, RDF.type, RDF.Property),
        (MR.id, RDF.type, RDF.Property),
        (MR.namespace, RDF.type, RDF.Property),
        # Status individuals
        (MR.Active, RDF.type, MR.Status),
        (MR.Draft, RDF.type, MR.Status),
        (MR.Deprecated, RDF.type, MR.Status),
        (MR.Superseded, RDF.type, MR.Status),
        (MR.Paused, RDF.type, MR.Status),
        # Priority individuals
        (MR.High, RDF.type, MR.Priority),
        (MR.Medium, RDF.type, MR.Priority),
        (MR.Low, RDF.type, MR.Priority),
    ]
    for s, p, o in ontology_declarations:
        g.add((s, p, o))

    # --- Scan and process files ---
    concept_cache: dict[str, URIRef] = {}
    doc_count = 0
    extra_excluded = tuple(exclude_patterns or ())

    for scan_dir in scan_dirs:
        if not scan_dir.exists():
            print(f"  [WARN] Directory not found: {scan_dir}", file=sys.stderr)
            continue

        md_files = list_markdown_files(scan_dir, extra_excluded)
        print(f"  Scanning {len(md_files)} .md files in {scan_dir}")

        for md_file in md_files:
            text = md_file.read_text(encoding="utf-8", errors="replace")
            fm = extract_frontmatter(text)
            if not fm:
                continue

            doc_id = fm.get("id")
            if not doc_id:
                continue

            doc_uri = slug_to_uri(doc_id)
            title = fm.get("title", md_file.stem)
            doc_type = fm.get("type", "document")
            status = fm.get("status", "active")
            priority = fm.get("priority")
            owner = fm.get("owner")
            created = fm.get("created")
            last_updated = fm.get("last_updated")
            ai_summary = fm.get("ai_summary")
            ai_keywords = fm.get("ai_keywords", [])

            # 1. Type: ogni doc è mr:Document, più la sottoclasse se c'è (0.6-o: prima un index era
            # solo mr:Index e graph_report non lo contava); il tipo MR resta in mr:docType
            type_uri = TYPE_MAP.get(doc_type, MR.Document)
            g.add((doc_uri, RDF.type, MR.Document))
            if type_uri != MR.Document:
                g.add((doc_uri, RDF.type, type_uri))
            if doc_type:
                g.add((doc_uri, MR.docType, Literal(str(doc_type))))

            # 2. Label, id and namespace (first segment of the id)
            g.add((doc_uri, RDFS.label, Literal(title)))
            g.add((doc_uri, MR.id, Literal(str(doc_id))))
            namespace = str(doc_id).split("/")[0] if "/" in str(doc_id) else ""
            g.add((doc_uri, MR.namespace, Literal(namespace)))

            # 3. Status
            status_uri = STATUS_MAP.get(status)
            if status_uri:
                g.add((doc_uri, MR.status, status_uri))

            # 4. Priority
            if priority:
                prio_uri = PRIORITY_MAP.get(priority.lower())
                if prio_uri:
                    g.add((doc_uri, MR.priority, prio_uri))

            # 5. Owner
            if owner:
                g.add((doc_uri, MR.owner, Literal(owner)))

            # 6. Dates
            if created:
                g.add((doc_uri, MR.created, Literal(created, datatype=XSD.date)))
            if last_updated:
                g.add((doc_uri, MR.lastUpdated, Literal(last_updated, datatype=XSD.date)))

            # 7. AI summary (as rdfs:comment)
            if ai_summary:
                g.add((doc_uri, RDFS.comment, Literal(ai_summary)))

            # 8. AI keywords -> concepts
            for kw in (ai_keywords or []):
                concept_slug = slug_for_concept(kw)
                if concept_slug not in concept_cache:
                    concept_uri = MR[concept_slug]
                    concept_cache[concept_slug] = concept_uri
                    g.add((concept_uri, RDF.type, MR.Concept))
                    g.add((concept_uri, RDFS.label, Literal(kw)))
                else:
                    concept_uri = concept_cache[concept_slug]
                g.add((doc_uri, MR.hasTopic, concept_uri))

            # 8b. superseded_by (0.6-o): la catena degli handoff si segue anche nel grafo
            if fm.get("superseded_by"):
                g.add((doc_uri, MR.supersededBy, slug_to_uri(str(fm.get("superseded_by")))))

            # 9. depends_on
            for dep in (fm.get("depends_on") or []):
                if isinstance(dep, dict):
                    target_id = dep.get("id")
                else:
                    target_id = dep
                if target_id:
                    target_uri = slug_to_uri(str(target_id))
                    g.add((doc_uri, MR.dependsOn, target_uri))

            # 10. required_by
            for req in (fm.get("required_by") or []):
                if isinstance(req, dict):
                    target_id = req.get("id")
                else:
                    target_id = req
                if target_id:
                    target_uri = slug_to_uri(str(target_id))
                    g.add((doc_uri, MR.requiredBy, target_uri))

            # 11. related_to
            for rel in (fm.get("related_to") or []):
                if isinstance(rel, dict):
                    target_id = rel.get("id")
                else:
                    target_id = rel
                if target_id:
                    target_uri = slug_to_uri(str(target_id))
                    g.add((doc_uri, MR.relatedTo, target_uri))

            # 12. propagate_staleness_to
            for prop in (fm.get("propagate_staleness_to") or []):
                if isinstance(prop, dict):
                    target_id = prop.get("id")
                else:
                    target_id = prop
                if target_id:
                    target_uri = slug_to_uri(str(target_id))
                    g.add((doc_uri, MR.propagateStalenessTo, target_uri))

            # 13. Computed fields (from mr-scanner)
            cstatus = fm.get("_computed_status")
            if cstatus:
                cstatus_uri = STATUS_MAP.get(cstatus)
                if cstatus_uri:
                    g.add((doc_uri, MR._computed_status, cstatus_uri))
            stale_days = fm.get("_computed_staleness_days")
            if stale_days is not None:
                try:
                    g.add((doc_uri, MR._computed_staleness_days, Literal(int(stale_days), datatype=XSD.integer)))
                except (ValueError, TypeError):
                    pass

            doc_count += 1

    # --- Extract concepts from markdown body (optional) ---
    if extract_headings:
        for scan_dir in scan_dirs:
            if not scan_dir.exists():
                continue
            for md_file in list_markdown_files(scan_dir, extra_excluded):
                text = md_file.read_text(encoding="utf-8", errors="replace")
                fm = extract_frontmatter(text)
                if not fm or not fm.get("id"):
                    continue
                doc_uri = slug_to_uri(fm["id"])
                body = re.sub(r"^---.*?---\s*", "", text, count=1, flags=re.DOTALL)
                concepts = extract_concepts_from_text(body)
                for concept_name in concepts:
                    concept_slug = slug_for_concept(concept_name)
                    if concept_slug not in concept_cache:
                        concept_uri = MR[concept_slug]
                        concept_cache[concept_slug] = concept_uri
                        g.add((concept_uri, RDF.type, MR.Concept))
                        g.add((concept_uri, RDFS.label, Literal(concept_name)))
                    else:
                        concept_uri = concept_cache[concept_slug]
                    if (doc_uri, MR.hasTopic, concept_uri) not in g:
                        g.add((doc_uri, MR.relatedToConcept, concept_uri))

    # --- Serialize (only with write=True) ---
    triple_count = len(g)
    print("")
    if write:
        output_path_obj = Path(output_path)
        output_path_obj.parent.mkdir(parents=True, exist_ok=True)
        g.serialize(destination=output_path, format="turtle")
        print(f"  [DONE] KG built and saved: {output_path}")
    else:
        print("  [DONE] KG built in memory (read-only: use --write to save the .ttl)")
    print(f"         Documents: {doc_count}")
    print(f"         Concepts:  {len(concept_cache)}")
    print(f"         Triples:   {triple_count}")

    return g


def _safe(text) -> str:
    """Sanitize text for cp1252 console output."""
    if isinstance(text, Literal):
        text = str(text)
    return text.encode("ascii", "replace").decode("ascii")


def verify(g: Graph):
    """Run simple SPARQL verification queries."""
    print("")
    print("  -- Verification Queries --")

    # Q1: All document types
    q1 = """
    SELECT DISTINCT ?type (COUNT(?doc) AS ?count) WHERE {
        ?doc a ?type .
        FILTER(?type != mr:Concept && ?type != mr:Status && ?type != mr:Priority)
    }
    GROUP BY ?type
    ORDER BY DESC(?count)
    """
    print("")
    print("  Q1 -- Document types:")
    for row in g.query(q1):
        t = str(row.type).split("#")[-1] if "#" in str(row.type) else str(row.type).split("/")[-1]
        print(f"     {t}: {int(row['count'])}")

    # Q2: All statuses
    q2 = """
    SELECT ?status (COUNT(?doc) AS ?count) WHERE {
        ?doc mr:status ?status .
    }
    GROUP BY ?status
    ORDER BY DESC(?count)
    """
    print("")
    print("  Q2 -- Status distribution:")
    for row in g.query(q2):
        s = str(row.status).split("#")[-1] if "#" in str(row.status) else str(row.status)
        print(f"     {s}: {int(row['count'])}")

    # Q3: Documents with most depends_on
    q3 = """
    SELECT ?label (COUNT(?dep) AS ?ndeps) WHERE {
        ?doc rdfs:label ?label .
        ?doc mr:dependsOn ?dep .
    }
    GROUP BY ?label
    ORDER BY DESC(?ndeps)
    LIMIT 5
    """
    print("")
    print("  Q3 -- Top 5 docs by depends_on count:")
    for row in g.query(q3):
        print(f"     {_safe(row.label)}: {int(row['ndeps'])} dependencies")

    # Q4: Documents with no relations (orphans)
    q4 = """
    SELECT ?label WHERE {
        ?doc rdfs:label ?label .
        FILTER NOT EXISTS { ?doc mr:dependsOn [] }
        FILTER NOT EXISTS { ?doc mr:requiredBy [] }
        FILTER NOT EXISTS { ?doc mr:relatedTo [] }
        FILTER(?doc != mr:Concept && ?doc != mr:Status && ?doc != mr:Priority
               && ?doc != mr:Document && ?doc != mr:Index
               && ?doc != mr:CrossCuttingDoc && ?doc != mr:ProjectCapsule
               && ?doc != mr:TechnicalDossier && ?doc != mr:Runbook)
    }
    ORDER BY ?label
    """
    print("")
    print("  Q4 -- Orphan documents (no relations):")
    orphans = list(g.query(q4))
    if orphans:
        for row in orphans:
            print(f"     {_safe(row.label)}")
    else:
        print("     (none -- all docs connected)")

    # Q5: All concepts
    q5 = """
    SELECT ?label WHERE {
        ?concept rdf:type mr:Concept .
        ?concept rdfs:label ?label .
    }
    ORDER BY ?label
    """
    print("")
    print("  Q5 -- All concepts:")
    concepts = list(g.query(q5))
    for i, row in enumerate(concepts, 1):
        print(f"     {i:3d}. {_safe(row.label)}")


# === CLI ===


def main():
    parser = argparse.ArgumentParser(
        description="Build an RDF knowledge graph from MR-tagged markdown documents"
    )
    parser.add_argument(
        "--output", "-o",
        default="mr-kg.ttl",
        help="Output Turtle file path, used with --write (default: mr-kg.ttl)",
    )
    parser.add_argument(
        "--dir", "-d",
        action="append",
        default=[],
        help="Directory to scan (required unless --verify-only; can be repeated)",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Save the graph to --output. Without it nothing is written to disk",
    )
    parser.add_argument(
        "--extract-headings",
        action="store_true",
        help="Extract extra concepts from markdown body headings",
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Skip build, only run verification on existing .ttl",
    )
    parser.add_argument(
        "--no-verify",
        action="store_true",
        help="Skip verification queries after build",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        help="Extra directory names to skip, on top of the defaults (node_modules, .git, dist, build, hidden, nested repos, .gitignore). Can be repeated.",
    )

    args = parser.parse_args()

    if args.verify_only:
        g = Graph()
        g.parse(args.output, format="turtle")
        print(f"  Loaded {len(g)} triples from {args.output}")
        verify(g)
        return

    if not args.dir:
        parser.error("at least one --dir is required")
    scan_dirs = [Path(d) for d in args.dir]

    print("  Building Neuro-Symbolic Knowledge Graph from:")
    for d in scan_dirs:
        print(f"     {d}")
    print()

    g = build_kg(
        scan_dirs=scan_dirs,
        output_path=args.output,
        extract_headings=args.extract_headings,
        exclude_patterns=args.exclude if args.exclude else None,
        write=args.write,
    )

    if not args.no_verify:
        verify(g)


if __name__ == "__main__":
    main()
