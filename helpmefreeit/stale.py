"""Détection des fichiers "stale" : gros et anciens.

Ce module fournit :func:`find_stale_files`, un utilitaire qui parcourt
récursivement une arborescence à la recherche de fichiers satisfaisant
simultanément deux critères :

* **taille** : ``size >= min_size`` (par défaut 100 Mo) ;
* **ancienneté** : ``age_days >= min_age_days`` (par défaut 90 jours),
  où ``age_days = floor((now - atime) / 86400)``.

L'objectif est d'identifier rapidement des candidats naturels à
l'archivage ou la suppression — typiquement de gros fichiers auxquels
on n'a pas accédé depuis longtemps.

Les symlinks ne sont jamais considérés comme fichiers éligibles :
``os.walk`` est appelé avec ``followlinks=False`` par défaut, et les
symlinks apparaissant parmi les fichiers sont explicitement filtrés.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

__all__ = ["StaleFile", "find_stale_files"]


_logger = logging.getLogger(__name__)

# Taille minimale par défaut : 100 Mio.
_DEFAULT_MIN_SIZE: int = 100 * 1024 * 1024

# Ancienneté minimale par défaut, en jours.
_DEFAULT_MIN_AGE_DAYS: int = 90

# Fréquence (en nombre de fichiers scannés) d'appel du callback de progression.
_PROGRESS_EVERY: int = 100


@dataclass(frozen=True)
class StaleFile:
    """Description d'un fichier "stale" détecté.

    Attributs
    ---------
    path:
        Chemin absolu (ou tel que fourni à :func:`find_stale_files`) du
        fichier.
    size:
        Taille du fichier, en octets.
    atime:
        ``st_atime`` (epoch seconds).
    mtime:
        ``st_mtime`` (epoch seconds).
    age_days:
        Ancienneté arrondie à l'inférieur, en jours pleins, calculée
        comme ``int((now - atime) / 86400)``.
    """

    path: Path
    size: int
    atime: float
    mtime: float
    age_days: int


def find_stale_files(
    root: Path,
    *,
    min_age_days: int = _DEFAULT_MIN_AGE_DAYS,
    min_size: int = _DEFAULT_MIN_SIZE,
    follow_symlinks: bool = False,
    on_progress: Callable[[int], None] | None = None,
) -> list[StaleFile]:
    """Retourne la liste des fichiers "stale" sous *root*.

    Un fichier est considéré comme stale si simultanément :

    * ``size >= min_size`` ;
    * ``age_days >= min_age_days``, avec
      ``age_days = int((now - atime) / 86400)``.

    Le résultat est trié par ``age_days`` décroissant (plus vieux en
    premier), puis par ``size`` décroissant en cas d'égalité.

    Paramètres
    ----------
    root:
        Racine du scan. Doit être un dossier existant.
    min_age_days:
        Ancienneté minimale en jours (défaut 90).
    min_size:
        Taille minimale en octets (défaut 100 Mo).
    follow_symlinks:
        Si ``True``, ``os.walk`` suit les liens symboliques vers les
        dossiers et ``os.stat`` suit les liens sur les fichiers.
        Défaut : ``False`` (les symlinks sont ignorés).
    on_progress:
        Callback optionnel ``f(nb_fichiers_scannes)`` appelé
        périodiquement (toutes les ~100 entrées), ainsi qu'une dernière
        fois à la fin du scan si au moins un fichier a été vu.
    """
    now = time.time()
    min_age_seconds = min_age_days * 86400
    results: list[StaleFile] = []
    scanned = 0

    # os.walk ne lève pas sur une racine inexistante : il ne produit
    # simplement aucune entrée. On conserve ce comportement.
    for dirpath, _dirnames, filenames in os.walk(
        str(root), followlinks=follow_symlinks
    ):
        for name in filenames:
            scanned += 1
            if on_progress is not None and scanned % _PROGRESS_EVERY == 0:
                on_progress(scanned)

            file_path = os.path.join(dirpath, name)

            # Les symlinks ne sont jamais considérés comme stale,
            # indépendamment de ``follow_symlinks`` (qui ne contrôle
            # que la traversée de ``os.walk``). Cela évite de compter
            # deux fois un fichier pointé et son lien.
            try:
                if os.path.islink(file_path):
                    continue
            except OSError:
                _logger.debug("islink a échoué sur %s", file_path, exc_info=True)
                continue

            try:
                st = os.stat(file_path, follow_symlinks=follow_symlinks)
            except OSError:
                # Permission refusée, chemin cassé, etc. On log en debug
                # et on ignore — un scan ne doit pas échouer pour ça.
                _logger.debug("stat a échoué sur %s", file_path, exc_info=True)
                continue

            size = int(st.st_size)
            if size < min_size:
                continue

            age_seconds = now - st.st_atime
            if age_seconds < min_age_seconds:
                continue

            age_days = int(age_seconds // 86400)

            results.append(
                StaleFile(
                    path=Path(file_path),
                    size=size,
                    atime=float(st.st_atime),
                    mtime=float(st.st_mtime),
                    age_days=age_days,
                )
            )

    # Dernier tick de progression pour signaler la fin.
    if on_progress is not None and scanned > 0 and scanned % _PROGRESS_EVERY != 0:
        on_progress(scanned)

    # Tri : plus vieux d'abord, puis plus gros en cas d'égalité.
    results.sort(key=lambda s: (-s.age_days, -s.size))
    return results
