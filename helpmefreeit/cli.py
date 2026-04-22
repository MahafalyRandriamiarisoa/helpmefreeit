"""CLI entry point for helpmefreeit."""

from __future__ import annotations

import re
from pathlib import Path

import click
from rich.console import Console

from .display import display_table, display_tree, format_size
from .scanner import scan_directory

console = Console(stderr=True)


def parse_size(value: str) -> int:
    """Parse human-readable size string to bytes.

    Supports: 100, 100B, 10K, 50M, 1G, 2T
    """
    if not value:
        return 0

    match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*([BKMGTP]?)I?\s*$", value.upper())
    if not match:
        raise click.BadParameter(
            f"Format de taille invalide: '{value}'. "
            "Utiliser ex: 100M, 1G, 500K"
        )

    num = float(match.group(1))
    unit = match.group(2) or "B"
    multipliers = {"B": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}

    return int(num * multipliers[unit])


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.argument("path", default=".", type=click.Path(exists=True))
@click.option("-d", "--depth", default=1, show_default=True, help="Profondeur de scan.")
@click.option("-n", "--top", default=None, type=int, help="Afficher le top N éléments.")
@click.option("-a", "--all", "show_hidden", is_flag=True, help="Inclure les fichiers/dossiers cachés.")
@click.option("-f", "--files", is_flag=True, help="Afficher aussi les fichiers individuels.")
@click.option("-m", "--min-size", default=None, help="Taille minimum (ex: 100M, 1G).")
@click.option("-x", "--one-file-system", is_flag=True, help="Ne pas traverser les points de montage.")
@click.option("--tree", "tree_mode", is_flag=True, help="Affichage en arbre.")
@click.option("--no-sort", is_flag=True, help="Ne pas trier par taille.")
@click.option("-r", "--reverse", is_flag=True, help="Trier du plus petit au plus grand.")
def main(
    path: str,
    depth: int,
    top: int | None,
    show_hidden: bool,
    files: bool,
    min_size: str | None,
    one_file_system: bool,
    tree_mode: bool,
    no_sort: bool,
    reverse: bool,
) -> None:
    """Analyse l'utilisation disque et affiche les éléments les plus volumineux.

    \b
    Exemples:
      freeit .                  Scanner le dossier courant
      freeit ~/Library -d 2     Profondeur 2
      freeit . -n 10 -m 100M   Top 10, minimum 100 Mo
      freeit / -x --tree -d 3  Arbre, sans traverser les montages
    """
    target = Path(path)
    min_bytes = parse_size(min_size) if min_size else 0

    import sys
    from .display import format_size as _fmt

    scanned_count = 0

    def _on_progress(name: str, size_so_far: int) -> None:
        nonlocal scanned_count
        scanned_count += 1
        msg = f"\r\033[K  Scan: {scanned_count} éléments — {_fmt(size_so_far)}"
        sys.stderr.write(msg)
        sys.stderr.flush()

    sys.stderr.write("  Scan en cours…")
    sys.stderr.flush()
    result = scan_directory(
        target,
        max_depth=depth,
        include_files=files,
        include_hidden=show_hidden,
        no_cross_device=one_file_system,
        min_size=min_bytes,
        on_progress=_on_progress,
    )
    sys.stderr.write("\r\033[K")
    sys.stderr.flush()

    if not result.children:
        console.print("[yellow]Aucun élément trouvé.[/yellow]")
        return

    if tree_mode:
        display_tree(result, top_n=top, sort_by_size=not no_sort, max_depth=depth)
    else:
        display_table(
            result,
            top_n=top,
            sort_by_size=not no_sort,
            reverse=reverse,
        )
