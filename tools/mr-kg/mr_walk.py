"""
mr_walk.py — raccolta dei file .md con esclusioni di default (MR v0.5.1)

Gemello Python di tools/lib/discover.mjs: stesse regole, stessa strategia.

Esclusioni sempre attive (anche su file tracciati):
  - cartelle: node_modules, .git, dist, build
  - cartelle nascoste (nome che inizia con ".")
  - sotto-cartelle che contengono un proprio .git (repo annidati)
  - file e cartelle ignorati dal .gitignore del repo che li contiene

Dentro un repo git si usa `git ls-files --cached --others --exclude-standard`
(semantica esatta del .gitignore, git non entra nei repo annidati); fuori da un
repo si fa un walk del filesystem con le stesse esclusioni per nome.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

DEFAULT_EXCLUDED_DIRS = ("node_modules", ".git", "dist", "build")


def find_repo_root(start: Path) -> Path | None:
    """Root del repo git che contiene `start`, oppure None."""
    current = start.resolve()
    while True:
        if (current / ".git").exists():
            return current
        if current.parent == current:
            return None
        current = current.parent


def _is_excluded_dir(name: str, extra: tuple[str, ...]) -> bool:
    return name.startswith(".") or name in DEFAULT_EXCLUDED_DIRS or name in extra


def _inside_nested_repo(path: Path, repo_root: Path) -> bool:
    current = repo_root
    for part in path.relative_to(repo_root).parts[:-1]:
        current = current / part
        if (current / ".git").exists():
            return True
    return False


def _list_via_git(directory: Path, repo_root: Path, extra: tuple[str, ...]) -> list[Path] | None:
    try:
        out = subprocess.run(
            ["git", "-C", str(directory), "ls-files", "-z", "--cached", "--others",
             "--exclude-standard", "--", "."],
            capture_output=True, check=True, text=True,
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        return None
    files = []
    for rel in out.split("\0"):
        if not rel.endswith(".md"):
            continue
        parts = Path(rel).parts
        if any(_is_excluded_dir(p, extra) for p in parts[:-1]):
            continue
        path = directory / rel
        if not path.exists():  # cancellato dal working tree ma ancora nell'indice
            continue
        if _inside_nested_repo(path.resolve(), repo_root):
            continue
        files.append(path)
    return sorted(files)


def _list_via_walk(directory: Path, extra: tuple[str, ...]) -> list[Path]:
    files = []
    for root, dirs, names in os.walk(directory):
        root_path = Path(root)
        if root_path != directory and (root_path / ".git").exists():
            dirs[:] = []  # repo annidato: non si entra
            continue
        dirs[:] = sorted(d for d in dirs if not _is_excluded_dir(d, extra))
        files.extend(root_path / n for n in names if n.endswith(".md"))
    return sorted(files)


def list_markdown_files(directory: Path | str, extra_excluded_dirs: tuple[str, ...] = ()) -> list[Path]:
    """Tutti i .md sotto `directory`, con le esclusioni di default."""
    directory = Path(directory).resolve()
    repo_root = find_repo_root(directory)
    if repo_root is not None:
        via_git = _list_via_git(directory, repo_root, extra_excluded_dirs)
        if via_git is not None:
            return via_git
    return _list_via_walk(directory, extra_excluded_dirs)
