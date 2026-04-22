"""Tests pour :mod:`helpmefreeit.dupes`.

Onze cas couverts :

1.  Aucun doublon → liste vide.
2.  Deux fichiers identiques → un groupe de deux.
3.  Trois fichiers identiques → un groupe de trois, ``recoverable_bytes``
    correct.
4.  Deux paires distinctes → deux groupes.
5.  ``min_size`` filtre correctement les petits doublons.
6.  Fichiers de même taille mais contenus différents → aucun doublon
    (la passe 2 les sépare).
7.  Tri par octets récupérables décroissants.
8.  Un ``Cache`` fourni évite de réhasher entre deux runs.
9.  Les symlinks sont ignorés par défaut.
10. Un fichier illisible ne fait pas planter le scan.
11. ``on_progress`` reçoit bien les trois étapes (``scan``, ``partial``, ``full``).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from helpmefreeit import dupes as dupes_mod
from helpmefreeit.cache import Cache
from helpmefreeit.dupes import DupeGroup, find_duplicates


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


# ---------------------------------------------------------------------------
# 1. Aucun doublon → liste vide
# ---------------------------------------------------------------------------
def test_aucun_doublon_retourne_liste_vide(tmp_path: Path) -> None:
    _write(tmp_path / "a.bin", b"contenu A" * 100)
    _write(tmp_path / "b.bin", b"contenu B" * 200)
    _write(tmp_path / "c.bin", b"contenu C" * 300)

    assert find_duplicates(tmp_path) == []


# ---------------------------------------------------------------------------
# 2. Deux fichiers identiques → un groupe de deux
# ---------------------------------------------------------------------------
def test_deux_fichiers_identiques(tmp_path: Path) -> None:
    data = b"hello" * 2048  # ~10 Kio
    _write(tmp_path / "copy1.bin", data)
    _write(tmp_path / "copy2.bin", data)

    groups = find_duplicates(tmp_path)
    assert len(groups) == 1
    g = groups[0]
    assert isinstance(g, DupeGroup)
    assert g.size == len(data)
    assert len(g.paths) == 2
    assert len(g.full_hash) == 32
    assert g.recoverable_bytes == len(data)  # 2 - 1 = 1 copie à supprimer


# ---------------------------------------------------------------------------
# 3. Trois fichiers identiques → un groupe de trois
# ---------------------------------------------------------------------------
def test_trois_fichiers_identiques(tmp_path: Path) -> None:
    data = b"triple" * 500
    for name in ("t1.bin", "t2.bin", "t3.bin"):
        _write(tmp_path / name, data)

    groups = find_duplicates(tmp_path)
    assert len(groups) == 1
    g = groups[0]
    assert len(g.paths) == 3
    assert g.size == len(data)
    assert g.recoverable_bytes == len(data) * 2  # size * (n - 1)


# ---------------------------------------------------------------------------
# 4. Deux groupes distincts
# ---------------------------------------------------------------------------
def test_deux_groupes_distincts(tmp_path: Path) -> None:
    data_a = b"groupA" * 1000
    data_b = b"groupeB!!" * 1000
    _write(tmp_path / "a1.bin", data_a)
    _write(tmp_path / "a2.bin", data_a)
    _write(tmp_path / "sub" / "b1.bin", data_b)
    _write(tmp_path / "sub" / "b2.bin", data_b)

    groups = find_duplicates(tmp_path)
    assert len(groups) == 2
    # Les deux groupes ont bien 2 paths chacun.
    assert {len(g.paths) for g in groups} == {2}
    # Les tailles correspondent.
    sizes = {g.size for g in groups}
    assert sizes == {len(data_a), len(data_b)}


# ---------------------------------------------------------------------------
# 5. Filtre min_size
# ---------------------------------------------------------------------------
def test_filtre_min_size(tmp_path: Path) -> None:
    petit = b"x" * 50
    gros = b"Y" * 5000
    _write(tmp_path / "small1.bin", petit)
    _write(tmp_path / "small2.bin", petit)
    _write(tmp_path / "big1.bin", gros)
    _write(tmp_path / "big2.bin", gros)

    # Sans filtre : deux groupes.
    assert len(find_duplicates(tmp_path)) == 2

    # Avec min_size=1000 : seuls les gros sont gardés.
    groups = find_duplicates(tmp_path, min_size=1000)
    assert len(groups) == 1
    assert groups[0].size == len(gros)


# ---------------------------------------------------------------------------
# 6. Même taille, contenus différents → pas de doublon
# ---------------------------------------------------------------------------
def test_fichiers_meme_taille_contenu_different(tmp_path: Path) -> None:
    # Deux fichiers de 10 Kio mais contenus bien différents.
    _write(tmp_path / "x.bin", b"A" * 10_000)
    _write(tmp_path / "y.bin", b"B" * 10_000)

    assert find_duplicates(tmp_path) == []


# ---------------------------------------------------------------------------
# 7. Tri par octets récupérables décroissants
# ---------------------------------------------------------------------------
def test_tri_par_octets_recuperables(tmp_path: Path) -> None:
    # Petit groupe : 2 fichiers de 100 octets → récupérable = 100.
    petit = b"p" * 100
    _write(tmp_path / "p1.bin", petit)
    _write(tmp_path / "p2.bin", petit)

    # Gros groupe : 2 fichiers de 10 000 octets → récupérable = 10 000.
    gros = b"g" * 10_000
    _write(tmp_path / "g1.bin", gros)
    _write(tmp_path / "g2.bin", gros)

    groups = find_duplicates(tmp_path)
    assert len(groups) == 2
    # Le plus gros gain doit venir en premier.
    assert groups[0].recoverable_bytes > groups[1].recoverable_bytes
    assert groups[0].size == len(gros)
    assert groups[1].size == len(petit)


# ---------------------------------------------------------------------------
# 8. Le cache évite de rehasher entre deux runs
# ---------------------------------------------------------------------------
def test_utilise_le_cache(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    data = b"cache me" * 1000
    _write(tmp_path / "c1.bin", data)
    _write(tmp_path / "c2.bin", data)

    db_path = tmp_path / "cache.db"

    # Run 1 : peuple le cache.
    with Cache(db_path=db_path) as cache:
        groups = find_duplicates(tmp_path, cache=cache)
        assert len(groups) == 1

    # Run 2 : on compte les appels à partial_hash / full_hash via monkeypatch.
    # Les noms visés sont ceux importés dans le module dupes — c'est ce que
    # find_duplicates appelle réellement.
    calls = {"partial": 0, "full": 0}
    real_partial = dupes_mod.partial_hash
    real_full = dupes_mod.full_hash

    def counting_partial(p: Path) -> bytes:
        calls["partial"] += 1
        return real_partial(p)

    def counting_full(p: Path) -> bytes:
        calls["full"] += 1
        return real_full(p)

    monkeypatch.setattr(dupes_mod, "partial_hash", counting_partial)
    monkeypatch.setattr(dupes_mod, "full_hash", counting_full)

    with Cache(db_path=db_path) as cache:
        groups = find_duplicates(tmp_path, cache=cache)
        assert len(groups) == 1

    # Aucun re-calcul : tout doit venir du cache.
    assert calls["partial"] == 0, f"partial_hash ne doit pas être rappelé (appels={calls['partial']})"
    assert calls["full"] == 0, f"full_hash ne doit pas être rappelé (appels={calls['full']})"


# ---------------------------------------------------------------------------
# 9. Symlinks ignorés par défaut
# ---------------------------------------------------------------------------
def test_symlinks_ignores(tmp_path: Path) -> None:
    data = b"just one real file" * 500
    real = _write(tmp_path / "real.bin", data)

    link = tmp_path / "link.bin"
    link.symlink_to(real)

    # follow_symlinks=False par défaut : un seul fichier réel → pas de doublon.
    assert find_duplicates(tmp_path) == []


# ---------------------------------------------------------------------------
# 10. Un fichier illisible ne fait pas planter le scan
# ---------------------------------------------------------------------------
@pytest.mark.skipif(
    sys.platform.startswith("win"),
    reason="chmod 0 ne produit pas le même effet sous Windows",
)
def test_erreur_fichier_illisible_skippe(tmp_path: Path) -> None:
    data = b"payload" * 1000

    # Deux fichiers lisibles identiques → groupe attendu.
    ok1 = _write(tmp_path / "ok1.bin", data)
    ok2 = _write(tmp_path / "ok2.bin", data)

    # Un troisième fichier même taille mais rendu illisible.
    bad = _write(tmp_path / "bad.bin", b"Z" * len(data))
    os.chmod(bad, 0)

    try:
        groups = find_duplicates(tmp_path)
    finally:
        # Restaure les permissions pour que pytest puisse nettoyer tmp_path.
        os.chmod(bad, 0o600)

    # Le scan ne crashe pas ; on retrouve bien le groupe des deux fichiers lisibles.
    assert len(groups) == 1
    assert set(groups[0].paths) == {ok1, ok2}


# ---------------------------------------------------------------------------
# 11. on_progress est appelé avec les trois étapes
# ---------------------------------------------------------------------------
def test_progress_callback_appele(tmp_path: Path) -> None:
    data = b"progress" * 500
    _write(tmp_path / "p1.bin", data)
    _write(tmp_path / "p2.bin", data)

    events: list[tuple[str, int, int]] = []

    def cb(step: str, processed: int, total: int) -> None:
        events.append((step, processed, total))

    find_duplicates(tmp_path, on_progress=cb)

    steps_seen = {step for step, _, _ in events}
    assert "scan" in steps_seen
    assert "partial" in steps_seen
    assert "full" in steps_seen
    # Sanity : chaque événement a des compteurs cohérents (processed ≤ total).
    for _step, processed, total in events:
        assert processed <= total
        assert processed >= 1
