"""
Test di tools/mr-kg (MR v0.5.1): esclusioni, sola lettura di default, kg_query sicuro.

Invocazione (dalla root del repo MR):
    .venv/bin/python -m unittest discover -s tools/mr-kg/tests -v
"""

from __future__ import annotations

import io
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
MR_KG = HERE.parent
sys.path.insert(0, str(MR_KG))

import build_kg  # noqa: E402
import graph_report  # noqa: E402
import kg_query  # noqa: E402
from mr_walk import list_markdown_files  # noqa: E402

FIXTURES = MR_KG.parent / "mr-validate" / "test-files" / "light-ok"

DOC = """---
mr_version: '0.5'
id: {id}
title: Doc {id}
type: explanation
owner: test
status: active
created: '2026-10-03'
last_updated: '2026-10-03'
---

# {id}
"""


def _write(path: Path, doc_id: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(DOC.format(id=doc_id), encoding="utf-8")


def _quiet(fn, *args, **kwargs):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        try:
            result = fn(*args, **kwargs)
        except SystemExit as e:
            result = e.code
    return result, out.getvalue() + err.getvalue()


def _build_fixture_tree(root: Path, git: bool):
    if git:
        subprocess.run(["git", "init", "-q", str(root)], check=True)
    (root / ".gitignore").write_text("ignorata/\n", encoding="utf-8")
    _write(root / "docs" / "a.md", "test/a")
    for rel in ("node_modules/x.md", "dist/y.md", "build/y.md", ".nascosta/z.md", "ignorata/w.md"):
        _write(root / rel, "test/escluso")
    subprocess.run(["git", "init", "-q", str(root / "annidato")], check=True)
    _write(root / "annidato" / "n.md", "test/annidato")


def _snapshot(root: Path) -> dict[str, bytes]:
    snap = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            p = Path(dirpath) / name
            snap[str(p.relative_to(root))] = p.read_bytes()
    return snap


class TestMrWalk(unittest.TestCase):
    def test_esclusioni_in_repo_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _build_fixture_tree(root, git=True)
            found = [p.relative_to(root).as_posix() for p in list_markdown_files(root)]
            self.assertEqual(found, ["docs/a.md"])

    def test_esclusioni_fuori_da_git(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _build_fixture_tree(root, git=False)
            found = [p.relative_to(root).as_posix() for p in list_markdown_files(root)]
            # fuori da un repo il .gitignore non vale; il resto resta escluso
            self.assertEqual(found, ["docs/a.md", "ignorata/w.md"])

    def test_cartelle_extra(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _build_fixture_tree(root, git=True)
            self.assertEqual(list_markdown_files(root, ("docs",)), [])


class TestBuildKg(unittest.TestCase):
    def test_senza_write_non_scrive(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "kg.ttl"
            argv = ["build_kg.py", "--dir", str(FIXTURES), "--output", str(out), "--no-verify"]
            old = sys.argv
            sys.argv = argv
            try:
                _quiet(build_kg.main)
            finally:
                sys.argv = old
            self.assertFalse(out.exists())

    def test_con_write_scrive_id_e_namespace(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "kg.ttl"
            argv = ["build_kg.py", "--dir", str(FIXTURES), "--output", str(out), "--no-verify", "--write"]
            old = sys.argv
            sys.argv = argv
            try:
                _quiet(build_kg.main)
            finally:
                sys.argv = old
            self.assertTrue(out.exists())
            from rdflib import Graph
            g = Graph()
            g.parse(str(out), format="turtle")
            _, rows = kg_query.run_query(
                g, "SELECT ?id ?ns WHERE { ?d mr:id ?id ; mr:namespace ?ns } ORDER BY ?id"
            )
            self.assertEqual(rows, [
                {"id": "test/light-codice", "ns": "test"},
                {"id": "test/light-roadmap", "ns": "test"},
                {"id": "test/light-spec", "ns": "test"},
            ])

    def test_dir_obbligatoria(self):
        old = sys.argv
        sys.argv = ["build_kg.py", "--no-verify"]
        try:
            code, _ = _quiet(build_kg.main)
        finally:
            sys.argv = old
        self.assertEqual(code, 2)


class TestKgQuery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.graph, _ = _quiet(build_kg.build_kg, [FIXTURES], write=False)

    def test_select_ammessa(self):
        _, rows = kg_query.run_query(
            self.graph,
            "SELECT ?src WHERE { ?s mr:dependsOn ?t . ?t mr:id 'test/light-spec' . ?s mr:id ?src }",
        )
        self.assertEqual(rows, [{"src": "test/light-roadmap"}])

    def test_ask_ammessa(self):
        _, rows = kg_query.run_query(self.graph, "ASK { ?d mr:id 'test/light-spec' }")
        self.assertEqual(rows, [{"ask": "true"}])

    def test_service_rifiutato(self):
        for q in (
            "SELECT ?s WHERE { SERVICE <http://127.0.0.1:9/sparql> { ?s ?p ?o } }",
            "SELECT ?s WHERE { ?a ?b ?c . OPTIONAL { service silent <http://127.0.0.1:9/> { ?s ?p ?o } } }",
            "SELECT ?s WHERE { { ?s ?p ?o } UNION { SERVICE <http://127.0.0.1:9/> { ?s ?p ?o } } }",
        ):
            with self.assertRaises(kg_query.QueryRejected, msg=q):
                kg_query.run_query(self.graph, q)

    def test_from_rifiutato(self):
        for q in (
            "SELECT ?s FROM <http://127.0.0.1:9/g> WHERE { ?s ?p ?o }",
            "SELECT ?s FROM NAMED <http://127.0.0.1:9/g> WHERE { GRAPH ?g { ?s ?p ?o } }",
        ):
            with self.assertRaises(kg_query.QueryRejected, msg=q):
                kg_query.run_query(self.graph, q)

    def test_update_rifiutato(self):
        for q in (
            "INSERT DATA { <urn:a> <urn:b> <urn:c> }",
            "LOAD <http://127.0.0.1:9/g>",
            "DELETE WHERE { ?s ?p ?o }",
        ):
            with self.assertRaises(kg_query.QueryRejected, msg=q):
                kg_query.run_query(self.graph, q)

    def test_caricamento_grafi_disattivato(self):
        import rdflib.plugins.sparql as rdflib_sparql
        self.assertFalse(rdflib_sparql.SPARQL_LOAD_GRAPHS)

    def test_cli_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            kg = Path(tmp) / "kg.ttl"
            self.graph.serialize(destination=str(kg), format="turtle")
            code, _ = _quiet(kg_query.main, ["--kg", str(kg), "-q", "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1"])
            self.assertEqual(code, 0)
            code, out = _quiet(kg_query.main, ["--kg", str(kg), "-q", "SELECT ?s WHERE { SERVICE <http://x/> { ?s ?p ?o } }"])
            self.assertEqual(code, 1)
            self.assertIn("RIFIUTATA", out)
            code, _ = _quiet(kg_query.main, ["--kg", str(Path(tmp) / "manca.ttl"), "--schema"])
            self.assertEqual(code, 2)


class TestGraphReport(unittest.TestCase):
    def test_senza_write_solo_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            kg = tmp / "kg.ttl"
            graph, _ = _quiet(build_kg.build_kg, [FIXTURES], write=False)
            graph.serialize(destination=str(kg), format="turtle")
            before = _snapshot(tmp)
            old_argv, old_cwd = sys.argv, os.getcwd()
            sys.argv = ["graph_report.py", "--kg", str(kg)]
            os.chdir(tmp)
            try:
                _, out = _quiet(graph_report.main)
            finally:
                sys.argv = old_argv
                os.chdir(old_cwd)
            self.assertEqual(_snapshot(tmp), before)
            self.assertIn("MR Knowledge Graph", out)
            self.assertIn("| test | 3 |", out)


class TestKgTipiESostituzioni(unittest.TestCase):
    """0.6-o: index contati come documenti, tipo MR interrogabile, catena superseded_by nel grafo."""

    def _doc(self, root: Path, name: str, fm: str):
        (root / name).write_text(f"---\nmr_version: '0.6'\n{fm}\nowner: t\ncreated: '2026-01-01'\nlast_updated: '2026-01-01'\n---\n\n# {name}\n", encoding="utf-8")

    def test_index_handoff_e_superseded(self):
        from rdflib import Graph
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "docs"
            root.mkdir()
            self._doc(root, "readme.md", "id: t/readme\ntitle: Indice\ntype: index\nstatus: active")
            self._doc(root, "hof-1.md", "id: t/hof-1\ntitle: Hof 1\ntype: handoff\nstatus: superseded\nsuperseded_by: t/hof-2")
            self._doc(root, "hof-2.md", "id: t/hof-2\ntitle: Hof 2\ntype: handoff\nstatus: active")
            out = Path(tmp) / "kg.ttl"
            old = sys.argv
            sys.argv = ["build_kg.py", "--dir", str(root), "--output", str(out), "--no-verify", "--write"]
            try:
                _quiet(build_kg.main)
            finally:
                sys.argv = old
            g = Graph()
            g.parse(str(out), format="turtle")
            _, rows = kg_query.run_query(g, "SELECT ?id WHERE { ?d a mr:Document ; mr:id ?id } ORDER BY ?id")
            self.assertEqual([r["id"] for r in rows], ["t/hof-1", "t/hof-2", "t/readme"])
            _, rows = kg_query.run_query(g, "SELECT ?id WHERE { ?d mr:docType 'handoff' ; mr:status mr:Active ; mr:id ?id }")
            self.assertEqual([r["id"] for r in rows], ["t/hof-2"])
            _, rows = kg_query.run_query(g, "SELECT ?a ?b WHERE { ?x mr:supersededBy ?y . ?x mr:id ?a . ?y mr:id ?b }")
            self.assertEqual(rows, [{"a": "t/hof-1", "b": "t/hof-2"}])
            rep = Path(tmp) / "report.md"
            old = sys.argv
            sys.argv = ["graph_report.py", "--kg", str(out), "--output", str(rep), "--write"]
            try:
                _quiet(graph_report.main)
            finally:
                sys.argv = old
            text = rep.read_text(encoding="utf-8")
            self.assertIn("| Documents | 3 |", text)
            self.assertIn("| Relations (depends/required/related/propagate/superseded) | 1 |", text)


if __name__ == "__main__":
    unittest.main()
