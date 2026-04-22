"""Tests de :mod:`helpmefreeit.stale`.

Onze cas couvrent :

1. Un fichier récent (même gros) est ignoré.
2. Un fichier petit mais vieux est ignoré.
3. Un fichier gros ET vieux est détecté.
4. Tri par ``age_days`` décroissant.
5. Tri ex aequo par ``size`` décroissant.
6. Filtre ``min_size`` personnalisable.
7. Filtre ``min_age_days`` personnalisable.
8. Un symlink vers un fichier éligible est ignoré.
9. Scan récursif (sous-dossier imbriqué).
10. Une erreur de stat n'interrompt pas le scan.
11. ``on_progress`` est bien appelé.
"""

from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Callable
from unittest.mock import patch

import pytest

from helpmefreeit.stale import StaleFile, find_stale_files


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MB = 1024 * 1024


def _make_sparse_file(path: Path, size: int) -> None:
    """Crée un fichier "sparse" de ``size`` octets sans écrire tout le contenu.

    Utilise ``seek(size - 1)`` + ``write(b"\x00")`` : macOS et Linux
    allouent alors la taille logique sans consommer l'espace disque
    correspondant. Parfait pour tester des seuils de plusieurs centaines
    de Mo.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        if size > 0:
            fh.seek(size - 1)
            fh.write(b"\x00")


def _age_file(path: Path, *, age_days: float) -> None:
    """Positionne ``atime`` et ``mtime`` du fichier à ``age_days`` jours
    dans le passé via :func:`os.utime`."""
    target = time.time() - age_days * 86400
    os.utime(path, (target, target))


# ---------------------------------------------------------------------------
# 1. Fichier récent → ignoré
# ---------------------------------------------------------------------------
def test_fichier_recent_ignore(tmp_path: Path) -> None:
    """Un fichier créé à l'instant, même volumineux, ne doit pas remonter."""
    big = tmp_path / "big.bin"
    _make_sparse_file(big, 150 * _MB)
    # atime/mtime = maintenant (par défaut après write)

    result = find_stale_files(tmp_path)

    assert result == []


# ---------------------------------------------------------------------------
# 2. Fichier petit mais vieux → ignoré
# ---------------------------------------------------------------------------
def test_fichier_petit_mais_vieux_ignore(tmp_path: Path) -> None:
    small_old = tmp_path / "small_old.bin"
    small_old.write_bytes(b"x" * 1024)  # 1 KB
    _age_file(small_old, age_days=200)

    result = find_stale_files(tmp_path)

    assert result == []


# ---------------------------------------------------------------------------
# 3. Fichier gros ET vieux → détecté
# ---------------------------------------------------------------------------
def test_fichier_gros_et_vieux_detecte(tmp_path: Path) -> None:
    big_old = tmp_path / "big_old.bin"
    _make_sparse_file(big_old, 150 * _MB)
    _age_file(big_old, age_days=200)

    result = find_stale_files(tmp_path)

    assert len(result) == 1
    stale = result[0]
    assert isinstance(stale, StaleFile)
    assert stale.path == big_old
    assert stale.size == 150 * _MB
    # floor(200) = 200 jours
    assert stale.age_days >= 199  # tolère 1 jour d'arrondi/latence
    assert stale.age_days <= 201


# ---------------------------------------------------------------------------
# 4. Tri par age_days desc
# ---------------------------------------------------------------------------
def test_tri_par_age_desc(tmp_path: Path) -> None:
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    _make_sparse_file(a, 150 * _MB)
    _make_sparse_file(b, 150 * _MB)
    _age_file(a, age_days=100)
    _age_file(b, age_days=300)

    result = find_stale_files(tmp_path)

    assert [s.path for s in result] == [b, a]


# ---------------------------------------------------------------------------
# 5. Tri ex aequo par size desc
# ---------------------------------------------------------------------------
def test_tri_ex_aequo_par_size_desc(tmp_path: Path) -> None:
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    _make_sparse_file(a, 120 * _MB)
    _make_sparse_file(b, 200 * _MB)
    # Même atime pour les deux → tri par taille desc
    target = time.time() - 180 * 86400
    os.utime(a, (target, target))
    os.utime(b, (target, target))

    result = find_stale_files(tmp_path)

    assert [s.path for s in result] == [b, a]


# ---------------------------------------------------------------------------
# 6. min_size personnalisé
# ---------------------------------------------------------------------------
def test_filtre_min_size_personnalise(tmp_path: Path) -> None:
    small = tmp_path / "small.bin"
    _make_sparse_file(small, 50)  # 50 octets
    _age_file(small, age_days=200)

    # Seuil abaissé à 10 octets → le fichier passe.
    result = find_stale_files(tmp_path, min_size=10)

    assert len(result) == 1
    assert result[0].path == small
    assert result[0].size == 50


# ---------------------------------------------------------------------------
# 7. min_age_days personnalisé
# ---------------------------------------------------------------------------
def test_filtre_min_age_days_personnalise(tmp_path: Path) -> None:
    recent = tmp_path / "hier.bin"
    _make_sparse_file(recent, 150 * _MB)
    _age_file(recent, age_days=1.1)  # hier (un peu plus d'un jour)

    # min_age_days=1 → 1 jour d'ancienneté minimum, le fichier passe.
    result = find_stale_files(recent.parent, min_age_days=1)

    assert len(result) == 1
    assert result[0].path == recent


# ---------------------------------------------------------------------------
# 8. Symlink ignoré
# ---------------------------------------------------------------------------
def test_symlink_ignore(tmp_path: Path) -> None:
    """Le fichier cible reste détectable, mais pas le lien."""
    target = tmp_path / "cible.bin"
    _make_sparse_file(target, 150 * _MB)
    _age_file(target, age_days=200)

    link = tmp_path / "lien.bin"
    link.symlink_to(target)

    result = find_stale_files(tmp_path)

    # Un seul résultat : la cible. Le symlink n'est pas remonté.
    assert len(result) == 1
    assert result[0].path == target


# ---------------------------------------------------------------------------
# 9. Scan récursif
# ---------------------------------------------------------------------------
def test_scan_recursif(tmp_path: Path) -> None:
    nested = tmp_path / "a" / "b" / "c"
    nested.mkdir(parents=True)
    deep = nested / "deep.bin"
    _make_sparse_file(deep, 150 * _MB)
    _age_file(deep, age_days=120)

    result = find_stale_files(tmp_path)

    assert len(result) == 1
    assert result[0].path == deep


# ---------------------------------------------------------------------------
# 10. Erreur de stat → skip, on continue
# ---------------------------------------------------------------------------
def test_erreur_stat_skippe(tmp_path: Path) -> None:
    """Si ``os.stat`` lève ``OSError`` sur un chemin, le scan continue."""
    ok = tmp_path / "ok.bin"
    _make_sparse_file(ok, 150 * _MB)
    _age_file(ok, age_days=200)

    bad = tmp_path / "bad.bin"
    _make_sparse_file(bad, 1)  # petit fichier réel, mais on va faire planter stat

    real_stat = os.stat

    def fake_stat(path, *args, **kwargs):  # type: ignore[no-untyped-def]
        if os.fspath(path).endswith("bad.bin"):
            raise PermissionError("accès refusé (simulé)")
        return real_stat(path, *args, **kwargs)

    with patch("helpmefreeit.stale.os.stat", side_effect=fake_stat):
        result = find_stale_files(tmp_path)

    # Le fichier valide est bien remonté malgré l'erreur sur l'autre.
    assert [s.path for s in result] == [ok]


# ---------------------------------------------------------------------------
# 11. on_progress appelé
# ---------------------------------------------------------------------------
def test_on_progress_appele(tmp_path: Path) -> None:
    # On crée plus de 100 fichiers pour déclencher au moins un tick
    # intermédiaire, en plus du tick final.
    for i in range(120):
        (tmp_path / f"f{i:03d}.txt").write_bytes(b"x")

    ticks: list[int] = []

    def cb(n: int) -> None:
        ticks.append(n)

    find_stale_files(tmp_path, on_progress=cb)

    assert ticks, "on_progress n'a jamais été appelé"
    # Les valeurs doivent être strictement croissantes.
    assert ticks == sorted(ticks)
    # Le dernier tick reflète le total scanné (≥ 120).
    assert ticks[-1] >= 120
