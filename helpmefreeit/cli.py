"""Point d'entrée CLI pour helpmefreeit.

Expose une commande ``freeit`` (alias : ``helpmefreeit``) avec quatre
sous-commandes :

- ``scan`` — analyse d'utilisation disque (comportement historique).
- ``dupes`` — détection de fichiers en double.
- ``stale`` — fichiers anciens et volumineux.
- ``clean`` — inventaire des préréglages "junk" (caches, node_modules, …).

Toutes les sous-commandes acceptent ``--json`` : dans ce mode, chaque
message de progression et le résultat final sont émis ligne par ligne
sur stdout en JSON compact. Ce format est consommé par la GUI Electron
via ``freeit-gui/src/main/subprocess.ts``.

Rétro-compatibilité : ``freeit <chemin>`` (sans sous-commande) est
automatiquement interprété comme ``freeit scan <chemin>``.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import click
from rich.console import Console

from .cache import Cache
from .display import (
    display_dupes,
    display_presets,
    display_stale,
    display_table,
    display_tree,
    format_size,
)
from .dupes import DupeGroup, find_duplicates
from .presets import PRESETS, JunkPreset, get_preset, resolve_paths
from .scanner import scan_directory
from .stale import StaleFile, find_stale_files

# Console Rich dédiée à la progression / messages côté stderr, pour ne
# jamais polluer stdout (qui peut être le flux JSON côté --json).
_err_console = Console(stderr=True)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_size(value: str) -> int:
    """Convertit une taille lisible (ex: 100M, 1G) en octets."""
    if not value:
        return 0

    match = re.match(r"^\s*(\d+(?:\.\d+)?)\s*([BKMGTP]?)I?\s*$", value.upper())
    if not match:
        raise click.BadParameter(
            f"Format de taille invalide: '{value}'. Utiliser ex: 100M, 1G, 500K"
        )
    num = float(match.group(1))
    unit = match.group(2) or "B"
    multipliers = {"B": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4, "P": 1024**5}
    return int(num * multipliers[unit])


def _emit_json(**payload: Any) -> None:
    """Émet une ligne JSON compacte sur stdout + flush (streaming)."""
    # default=str gère les Path, bytes (via hex explicite ailleurs), etc.
    click.echo(json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.flush()


def _dupegroup_to_dict(g: DupeGroup) -> dict[str, Any]:
    return {
        "size": g.size,
        "full_hash": g.full_hash.hex(),
        "paths": [str(p) for p in g.paths],
        "recoverable_bytes": g.recoverable_bytes,
    }


def _stalefile_to_dict(s: StaleFile) -> dict[str, Any]:
    return {
        "path": str(s.path),
        "size": s.size,
        "atime": s.atime,
        "mtime": s.mtime,
        "age_days": s.age_days,
    }


def _preset_to_summary(preset: JunkPreset) -> dict[str, Any]:
    """Résout les chemins d'un preset et calcule la taille totale.

    Pour les dossiers, on somme récursivement via ``rglob`` (plus simple
    et portable que ``du``). Les erreurs sont ignorées silencieusement.
    """
    paths = resolve_paths(preset)
    total_bytes = 0
    for p in paths:
        try:
            if p.is_dir():
                for sub in p.rglob("*"):
                    try:
                        if sub.is_file() and not sub.is_symlink():
                            total_bytes += sub.stat().st_size
                    except OSError:
                        continue
            elif p.is_file():
                total_bytes += p.stat().st_size
        except OSError:
            continue

    return {
        "id": preset.id,
        "label": preset.label,
        "description": preset.description,
        "safe": preset.safe,
        "min_age_days": preset.min_age_days,
        "count": len(paths),
        "total_bytes": total_bytes,
        "paths": [str(p) for p in paths],
    }


# ---------------------------------------------------------------------------
# Groupe principal
# ---------------------------------------------------------------------------
@click.group(
    invoke_without_command=True,
    context_settings={"help_option_names": ["-h", "--help"]},
)
@click.pass_context
def cli(ctx: click.Context) -> None:
    """helpmefreeit — analyse disque et ménage (doublons, vieux, caches)."""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


# ---------------------------------------------------------------------------
# Sous-commande : scan (comportement historique)
# ---------------------------------------------------------------------------
@cli.command()
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
@click.option("--json", "json_mode", is_flag=True, help="Sortie JSON lignes (pour intégration).")
def scan(
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
    json_mode: bool,
) -> None:
    """Analyse l'utilisation disque et affiche les éléments volumineux."""
    target = Path(path)
    min_bytes = parse_size(min_size) if min_size else 0

    scanned_count = 0

    def _on_progress(name: str, size_so_far: int) -> None:
        nonlocal scanned_count
        scanned_count += 1
        if json_mode:
            _emit_json(
                type="progress",
                scanned=scanned_count,
                total=0,  # total inconnu avant la fin
                currentPath=name,
            )
        else:
            msg = f"\r\033[K  Scan: {scanned_count} éléments — {format_size(size_so_far)}"
            sys.stderr.write(msg)
            sys.stderr.flush()

    if not json_mode:
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

    if not json_mode:
        sys.stderr.write("\r\033[K")
        sys.stderr.flush()

    if json_mode:
        _emit_json(
            type="result",
            data={
                "root": str(result.path),
                "size": result.size,
                "isDir": result.is_dir,
                "children": [
                    {
                        "path": str(c.path),
                        "name": c.name,
                        "size": c.size,
                        "isDir": c.is_dir,
                    }
                    for c in result.children
                ],
            },
        )
        return

    if not result.children:
        _err_console.print("[yellow]Aucun élément trouvé.[/yellow]")
        return

    if tree_mode:
        display_tree(result, top_n=top, sort_by_size=not no_sort, max_depth=depth)
    else:
        display_table(result, top_n=top, sort_by_size=not no_sort, reverse=reverse)


# ---------------------------------------------------------------------------
# Sous-commande : dupes
# ---------------------------------------------------------------------------
@cli.command()
@click.argument("path", default=".", type=click.Path(exists=True))
@click.option("-m", "--min-size", default=None, help="Taille minimum par fichier (ex: 10M).")
@click.option("-n", "--top", default=None, type=int, help="N'afficher que les N plus gros groupes.")
@click.option("--follow-symlinks", is_flag=True, help="Suivre les symlinks.")
@click.option("--no-cache", is_flag=True, help="Ne pas utiliser le cache SQLite.")
@click.option("--json", "json_mode", is_flag=True, help="Sortie JSON lignes.")
def dupes(
    path: str,
    min_size: str | None,
    top: int | None,
    follow_symlinks: bool,
    no_cache: bool,
    json_mode: bool,
) -> None:
    """Trouve les fichiers en double sous le chemin donné (3 passes : size → xxh3 → BLAKE2b)."""
    target = Path(path)
    min_bytes = parse_size(min_size) if min_size else 0

    def _on_progress(step: str, processed: int, total: int) -> None:
        if json_mode:
            _emit_json(type="progress", step=step, processed=processed, total=total)
        else:
            sys.stderr.write(
                f"\r\033[K  {step:7s} {processed}/{total}"
            )
            sys.stderr.flush()

    # Ouvre/ferme proprement le cache (sauf --no-cache).
    if no_cache:
        groups = find_duplicates(
            target,
            min_size=min_bytes,
            follow_symlinks=follow_symlinks,
            cache=None,
            on_progress=_on_progress,
        )
    else:
        with Cache() as cache:
            groups = find_duplicates(
                target,
                min_size=min_bytes,
                follow_symlinks=follow_symlinks,
                cache=cache,
                on_progress=_on_progress,
            )

    if not json_mode:
        sys.stderr.write("\r\033[K")
        sys.stderr.flush()

    if top is not None and top > 0:
        groups = groups[:top]

    if json_mode:
        _emit_json(
            type="result",
            data=[_dupegroup_to_dict(g) for g in groups],
        )
        return

    display_dupes(groups)


# ---------------------------------------------------------------------------
# Sous-commande : stale
# ---------------------------------------------------------------------------
@cli.command()
@click.argument("path", default=".", type=click.Path(exists=True))
@click.option(
    "--min-age",
    "min_age_days",
    default=90,
    show_default=True,
    type=int,
    help="Ancienneté minimum en jours (atime).",
)
@click.option(
    "-m",
    "--min-size",
    default="100M",
    show_default=True,
    help="Taille minimum (ex: 500M, 1G).",
)
@click.option("-n", "--top", default=None, type=int, help="Afficher le top N.")
@click.option("--follow-symlinks", is_flag=True, help="Suivre les symlinks.")
@click.option("--json", "json_mode", is_flag=True, help="Sortie JSON lignes.")
def stale(
    path: str,
    min_age_days: int,
    min_size: str,
    top: int | None,
    follow_symlinks: bool,
    json_mode: bool,
) -> None:
    """Liste les fichiers anciens ET volumineux (candidats à archiver/supprimer)."""
    target = Path(path)
    min_bytes = parse_size(min_size)

    def _on_progress(scanned: int) -> None:
        if json_mode:
            _emit_json(type="progress", scanned=scanned)
        else:
            sys.stderr.write(f"\r\033[K  Scan: {scanned} fichiers")
            sys.stderr.flush()

    files = find_stale_files(
        target,
        min_age_days=min_age_days,
        min_size=min_bytes,
        follow_symlinks=follow_symlinks,
        on_progress=_on_progress,
    )

    if not json_mode:
        sys.stderr.write("\r\033[K")
        sys.stderr.flush()

    if top is not None and top > 0:
        files = files[:top]

    if json_mode:
        _emit_json(type="result", data=[_stalefile_to_dict(f) for f in files])
        return

    display_stale(files)


# ---------------------------------------------------------------------------
# Sous-commande : clean (inventaire preset, dry-run par défaut)
# ---------------------------------------------------------------------------
@cli.command()
@click.option(
    "--preset",
    "preset_id",
    default=None,
    help="Ne scanner qu'un seul preset (par id). Sinon : tous.",
)
@click.option("--json", "json_mode", is_flag=True, help="Sortie JSON lignes.")
def clean(preset_id: str | None, json_mode: bool) -> None:
    """Liste les préréglages junk (caches, node_modules, DerivedData, …) avec tailles estimées.

    Ne supprime rien — pour déclencher une suppression, utilise la GUI (plus sûr,
    avec confirmation et corbeille) ou un outil dédié.
    """
    if preset_id is not None:
        preset = get_preset(preset_id)
        if preset is None:
            raise click.BadParameter(
                f"Preset inconnu : '{preset_id}'. "
                f"Choix possibles : {', '.join(p.id for p in PRESETS)}"
            )
        targets = [preset]
    else:
        targets = list(PRESETS)

    summaries: list[dict[str, Any]] = []
    for p in targets:
        if json_mode:
            _emit_json(type="progress", preset=p.id, message=f"scan {p.id}")
        else:
            sys.stderr.write(f"\r\033[K  Scan preset: {p.id}")
            sys.stderr.flush()
        summaries.append(_preset_to_summary(p))

    if not json_mode:
        sys.stderr.write("\r\033[K")
        sys.stderr.flush()

    if json_mode:
        _emit_json(type="result", data=summaries)
        return

    display_presets(summaries)


# ---------------------------------------------------------------------------
# Entry point : rétro-compat `freeit <chemin>` → `freeit scan <chemin>`
# ---------------------------------------------------------------------------
_KNOWN_SUBCOMMANDS = {"scan", "dupes", "stale", "clean"}


def main() -> None:
    """Point d'entrée console_scripts.

    Rétro-compat : si le premier argument n'est pas une sous-commande connue
    et ne commence pas par ``-``, on le considère comme un chemin pour
    ``scan`` et on insère ``scan`` devant.
    """
    argv = sys.argv
    if (
        len(argv) > 1
        and argv[1] not in _KNOWN_SUBCOMMANDS
        and not argv[1].startswith("-")
    ):
        sys.argv = [argv[0], "scan", *argv[1:]]
    cli()
