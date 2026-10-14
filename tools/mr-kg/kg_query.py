#!/usr/bin/env python3
"""
kg_query.py — query SPARQL deterministiche su un Knowledge Graph MR (Turtle).

Nessun LLM, nessuna rete, nessuna scrittura. Sostituisce nsparql.py (v0.5):
la traduzione da linguaggio naturale a SPARQL la fa Claude Code con la skill
`mr-query`; questo script esegue soltanto la query.

Sicurezza:
  - si accettano solo query di lettura (SELECT, ASK, CONSTRUCT, DESCRIBE);
  - si rifiutano SERVICE (richieste HTTP verso endpoint esterni) e FROM / FROM NAMED
    (rdflib scaricherebbe i grafi indicati);
  - il caricamento automatico dei grafi di rdflib è disattivato comunque.

Usage:
    python kg_query.py --kg mr-kg.ttl --schema                 # schema per scrivere query
    python kg_query.py --kg mr-kg.ttl --query 'SELECT ...'     # query inline
    python kg_query.py --kg mr-kg.ttl --file domanda.rq        # query da file
    echo 'SELECT ...' | python kg_query.py --kg mr-kg.ttl -    # query da stdin
    ... --format json                                          # output JSON (default: tabella)

Exit code: 0 ok, 1 query rifiutata o non valida, 2 errore d'uso o KG mancante.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import rdflib.plugins.sparql as rdflib_sparql
from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, RDFS
from rdflib.plugins.sparql import prepareQuery
from rdflib.plugins.sparql.parserutils import CompValue

# Mai scaricare grafi indicati nella query (FROM / FROM NAMED)
rdflib_sparql.SPARQL_LOAD_GRAPHS = False

MR = Namespace("https://rnd-lab.local/mr#")

PREFIXES = {
    "rnd": "https://rnd-lab.local/",
    "mr": "https://rnd-lab.local/mr#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
}

ALLOWED_QUERY_FORMS = {"SelectQuery", "AskQuery", "ConstructQuery", "DescribeQuery"}


class QueryRejected(Exception):
    """Query non ammessa (forma, SERVICE, FROM) o non valida."""


def _walk(node):
    """Visita ricorsiva dell'algebra rdflib (CompValue, liste, dict)."""
    yield node
    if isinstance(node, dict):  # CompValue è un OrderedDict
        for value in node.values():
            yield from _walk(value)
    elif isinstance(node, (list, tuple, set)):
        for value in node:
            yield from _walk(value)


def check_query(query_text: str):
    """
    Prepara la query e la controlla. Ritorna la query preparata.
    Solleva QueryRejected se la query non è ammessa.
    """
    try:
        prepared = prepareQuery(query_text, initNs=PREFIXES)
    except Exception as e:  # rdflib solleva ParseException e altri tipi
        raise QueryRejected(f"query non valida: {e}") from e

    algebra = prepared.algebra
    if not isinstance(algebra, CompValue) or algebra.name not in ALLOWED_QUERY_FORMS:
        name = getattr(algebra, "name", type(algebra).__name__)
        raise QueryRejected(f"forma di query non ammessa: {name}")

    if algebra.get("datasetClause"):
        raise QueryRejected("FROM / FROM NAMED non ammessi: si interroga solo il KG locale")

    for node in _walk(algebra):
        if isinstance(node, CompValue) and node.name == "ServiceGraphPattern":
            raise QueryRejected("SERVICE non ammesso: niente richieste verso endpoint esterni")

    return prepared


def _short(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, URIRef):
        uri = str(value)
        if "#" in uri:
            return uri.split("#")[-1]
        if "local/" in uri:
            return uri.split("local/")[-1]
        return uri
    return str(value)


def run_query(graph: Graph, query_text: str):
    """Esegue una query controllata. Ritorna (variabili, righe) oppure (None, triple)."""
    prepared = check_query(query_text)
    result = graph.query(prepared)
    if result.type == "ASK":
        return ["ask"], [{"ask": str(bool(result.askAnswer)).lower()}]
    if result.type in ("CONSTRUCT", "DESCRIBE"):
        rows = [{"s": _short(s), "p": _short(p), "o": _short(o)} for s, p, o in result]
        return ["s", "p", "o"], rows
    variables = [str(v) for v in result.vars]
    rows = [{v: _short(row[v]) for v in variables} for row in result]
    return variables, rows


def extract_schema(graph: Graph) -> str:
    """Descrizione compatta del KG, per scrivere query (la legge la skill mr-query)."""
    classes = sorted({
        str(o).split("#")[-1]
        for o in graph.objects(None, RDF.type)
        if isinstance(o, URIRef) and str(o).startswith(str(MR))
    })
    properties = sorted({
        str(p).split("#")[-1]
        for p in graph.predicates()
        if isinstance(p, URIRef) and str(p).startswith(str(MR))
    })
    namespaces = sorted({str(o) for o in graph.objects(None, MR.namespace) if str(o)})
    statuses = sorted({
        str(o).split("#")[-1] for o in graph.objects(None, MR.status) if isinstance(o, URIRef)
    })
    doc_count = len(set(graph.subjects(MR.id, None)))

    lines = [
        "=== MR KNOWLEDGE GRAPH SCHEMA ===",
        f"triples: {len(graph)}   documents: {doc_count}",
        "",
        "PREFIXES:",
        *[f"  PREFIX {k}: <{v}>" for k, v in PREFIXES.items()],
        "",
        "CLASSES (rdf:type):",
        *[f"  mr:{c}" for c in classes],
        "",
        "PROPERTIES:",
        *[f"  mr:{p}" for p in properties],
        "",
        "STATUS VALUES (mr:status): " + ", ".join(f"mr:{s}" for s in statuses),
        "ID NAMESPACES (mr:namespace): " + ", ".join(namespaces),
        "",
        "NOTES:",
        "  - Each document has rdfs:label (title), mr:id (MR id), mr:namespace (first id segment).",
        "  - mr:dependsOn / mr:requiredBy / mr:relatedTo / mr:propagateStalenessTo / mr:supersededBy link documents to documents.",
        "  - mr:docType is the MR type as a string ('handoff', 'runbook', 'spec'...): every document is also rdf:type mr:Document.",
        "  - mr:hasTopic links documents to mr:Concept (from ai_keywords, if present).",
        "  - Freshness: mr:_computed_status (mr:Fresh|mr:Warning|mr:Stale), mr:_computed_staleness_days.",
        "  - Match titles with FILTER(CONTAINS(LCASE(?label), 'keyword')), not exact equality.",
        "  - SERVICE and FROM are rejected by kg_query.py.",
        "",
        "EXAMPLE:",
        "  SELECT ?id ?label WHERE {",
        "    ?src mr:dependsOn ?tgt . ?tgt mr:id 'mr/matrix' .",
        "    ?src mr:id ?id ; rdfs:label ?label .",
        "  } ORDER BY ?id",
    ]
    return "\n".join(lines)


def _print_table(variables: list[str], rows: list[dict]):
    if not rows:
        print("(nessun risultato)")
        return
    widths = {v: max(len(v), *(len(r[v] or "") for r in rows)) for v in variables}
    widths = {v: min(w, 80) for v, w in widths.items()}
    print("  ".join(v.ljust(widths[v]) for v in variables))
    print("  ".join("-" * widths[v] for v in variables))
    for r in rows:
        print("  ".join((r[v] or "").ljust(widths[v])[: widths[v]] for v in variables))
    print(f"\n{len(rows)} righe")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic SPARQL queries over an MR knowledge graph")
    parser.add_argument("query_stdin", nargs="?", help="'-' to read the query from stdin")
    parser.add_argument("--kg", default="mr-kg.ttl", help="Turtle KG file (default: mr-kg.ttl)")
    parser.add_argument("--query", "-q", help="SPARQL query text")
    parser.add_argument("--file", "-f", help="File containing the SPARQL query")
    parser.add_argument("--schema", action="store_true", help="Print the KG schema and exit")
    parser.add_argument("--format", choices=["table", "json"], default="table")
    args = parser.parse_args(argv)

    kg_path = Path(args.kg)
    if not kg_path.exists():
        print(f"ERRORE: KG non trovato: {kg_path} (costruiscilo con build_kg.py --write)", file=sys.stderr)
        return 2

    graph = Graph()
    graph.parse(str(kg_path), format="turtle")

    if args.schema:
        print(extract_schema(graph))
        return 0

    sources = [x for x in (args.query, args.file, args.query_stdin) if x]
    if len(sources) != 1:
        print("ERRORE: indica una sola query: --query, --file oppure '-' per stdin", file=sys.stderr)
        return 2
    if args.query:
        query_text = args.query
    elif args.file:
        query_text = Path(args.file).read_text(encoding="utf-8")
    elif args.query_stdin == "-":
        query_text = sys.stdin.read()
    else:
        print(f"ERRORE: argomento non riconosciuto: {args.query_stdin}", file=sys.stderr)
        return 2

    try:
        variables, rows = run_query(graph, query_text)
    except QueryRejected as e:
        print(f"RIFIUTATA: {e}", file=sys.stderr)
        return 1

    if args.format == "json":
        print(json.dumps({"vars": variables, "rows": rows}, ensure_ascii=False, indent=2))
    else:
        _print_table(variables, rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
