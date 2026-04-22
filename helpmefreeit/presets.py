"""Catalogue de presets de "junk" macOS.

Ce module fournit une liste de presets (caches, dossiers temporaires,
artefacts de build, etc.) que l'utilisateur peut cibler pour libérer de
l'espace disque. Chaque preset décrit un ensemble de chemins (globs) à
considérer, un drapeau indiquant s'il est sûr à supprimer sans regarder,
et éventuellement un âge minimum (en jours) en-dessous duquel on garde
le fichier.
"""

from __future__ import annotations

import glob as _glob
import os
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class JunkPreset:
    """Description d'une catégorie de fichiers/dossiers "junk" à cibler."""

    id: str
    """Slug stable, utilisé comme identifiant."""

    label: str
    """Libellé court en français pour l'affichage."""

    description: str
    """Description en français, explicative pour l'utilisateur."""

    paths: list[str]
    """Motifs glob (``~`` et ``**`` supportés)."""

    safe: bool
    """``True`` si la suppression est globalement sans risque."""

    min_age_days: int | None = None
    """Âge minimum en jours (mtime). ``None`` = pas de filtre d'âge."""


# ---------------------------------------------------------------------------
# Catalogue
# ---------------------------------------------------------------------------

PRESETS: list[JunkPreset] = [
    JunkPreset(
        id="caches-user",
        label="Caches utilisateur",
        description=(
            "Caches applicatifs de l'utilisateur dans ~/Library/Caches et "
            "~/.cache. Régénérés automatiquement par les applications."
        ),
        paths=[
            "~/Library/Caches/*",
            "~/.cache/*",
        ],
        safe=True,
    ),
    JunkPreset(
        id="node-modules",
        label="Dossiers node_modules",
        description=(
            "Dépendances npm/pnpm/yarn installées dans les projets. "
            "Réinstallables via `npm install`."
        ),
        paths=[
            "**/node_modules",
        ],
        safe=True,
    ),
    JunkPreset(
        id="python-venv",
        label="Environnements et caches Python",
        description=(
            "Environnements virtuels et caches d'outils Python "
            "(pytest, mypy, ruff, bytecode). Recréés à la demande."
        ),
        paths=[
            "**/.venv",
            "**/venv",
            "**/__pycache__",
            "**/.pytest_cache",
            "**/.mypy_cache",
            "**/.ruff_cache",
        ],
        safe=True,
    ),
    JunkPreset(
        id="xcode-derived",
        label="Xcode DerivedData",
        description=(
            "Données de build intermédiaires de Xcode. "
            "Régénérées au prochain build."
        ),
        paths=[
            "~/Library/Developer/Xcode/DerivedData/*",
        ],
        safe=True,
    ),
    JunkPreset(
        id="xcode-archives",
        label="Xcode Archives",
        description=(
            "Archives de builds Xcode (.xcarchive). Utiles pour "
            "symboliquer des crashs ou republier une app : à vérifier "
            "avant suppression."
        ),
        paths=[
            "~/Library/Developer/Xcode/Archives/*",
        ],
        safe=False,
    ),
    JunkPreset(
        id="brew-cache",
        label="Cache Homebrew",
        description=(
            "Archives téléchargées par Homebrew. Retéléchargées au "
            "besoin lors des installations."
        ),
        paths=[
            "~/Library/Caches/Homebrew/*",
        ],
        safe=True,
    ),
    JunkPreset(
        id="downloads-old",
        label="Téléchargements anciens",
        description=(
            "Fichiers du dossier ~/Downloads non modifiés depuis plus "
            "de 90 jours. Peuvent contenir des données importantes : "
            "à vérifier."
        ),
        paths=[
            "~/Downloads/*",
        ],
        safe=False,
        min_age_days=90,
    ),
    JunkPreset(
        id="trash",
        label="Corbeille",
        description=(
            "Contenu de la corbeille utilisateur (~/.Trash). "
            "Destiné à être supprimé."
        ),
        paths=[
            "~/.Trash/*",
        ],
        safe=True,
    ),
    JunkPreset(
        id="ds-store",
        label="Fichiers .DS_Store",
        description=(
            "Fichiers de métadonnées Finder disséminés partout. "
            "Recréés automatiquement par macOS."
        ),
        paths=[
            "**/.DS_Store",
        ],
        safe=True,
    ),
]


# ---------------------------------------------------------------------------
# API publique
# ---------------------------------------------------------------------------


def get_preset(preset_id: str) -> JunkPreset | None:
    """Retourne le preset correspondant à ``preset_id``, ou ``None``."""
    for preset in PRESETS:
        if preset.id == preset_id:
            return preset
    return None


def resolve_paths(
    preset: JunkPreset,
    *,
    root: Path | None = None,
) -> list[Path]:
    """Résout les chemins (globs) d'un preset en liste de ``Path`` existants.

    - Expanse ``~`` (home utilisateur).
    - Supporte les globs récursifs ``**``.
    - Ignore les symlinks (on ne veut pas supprimer des liens).
    - Applique ``min_age_days`` si défini (via ``mtime``).
    - ``root`` sert de base pour les globs relatifs (défaut : ``Path.home()``).
    - Ne lève jamais si un chemin n'existe pas : retourne ``[]`` le cas échéant.
    """
    base = root if root is not None else Path.home()
    now = time.time()
    min_age_seconds: float | None = (
        preset.min_age_days * 86400 if preset.min_age_days is not None else None
    )

    # On utilise un dict pour dédupliquer en conservant l'ordre d'apparition.
    resolved: dict[str, Path] = {}

    for pattern in preset.paths:
        # Expansion de ~ côté motif (avant résolution glob).
        expanded = os.path.expanduser(pattern)

        if os.path.isabs(expanded):
            search_pattern = expanded
        else:
            search_pattern = str(base / expanded)

        try:
            matches = _glob.glob(search_pattern, recursive=True)
        except OSError:
            # Certaines erreurs (ex. permission) ne doivent pas tout casser.
            continue

        for match in matches:
            path = Path(match)

            # Filtre symlinks : on ne les supprime pas, on ne les suit pas.
            try:
                if path.is_symlink():
                    continue
            except OSError:
                continue

            # Le chemin doit exister (glob renvoie normalement seulement
            # des existants, mais on se protège quand même).
            try:
                stat_result = path.stat()
            except (OSError, ValueError):
                continue

            if min_age_seconds is not None:
                age = now - stat_result.st_mtime
                if age < min_age_seconds:
                    continue

            resolved[str(path)] = path

    return list(resolved.values())


__all__ = [
    "JunkPreset",
    "PRESETS",
    "get_preset",
    "resolve_paths",
]
