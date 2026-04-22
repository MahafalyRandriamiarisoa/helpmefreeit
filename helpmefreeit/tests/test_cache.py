"""Tests de :mod:`helpmefreeit.cache`.

Neuf cas couvrent :
1. Roundtrip empreinte partielle
2. Roundtrip empreinte complète (et préservation du partial)
3. Invalidation si ``mtime`` change
4. Invalidation si ``size`` change
5. Suppression de la ligne stale lors d'un ``get_hashes``
6. Roundtrip ``scan_size``
7. ``clear`` vide bien les deux tables
8. Context manager (``with`` ferme la connexion)
9. Thread safety (10 threads concurrents)
"""

from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from helpmefreeit.cache import Cache


@pytest.fixture()
def cache(tmp_path: Path) -> Cache:
    """Fournit un Cache isolé dans ``tmp_path`` et le ferme en fin de test."""
    db = tmp_path / "cache.db"
    c = Cache(db_path=db)
    try:
        yield c
    finally:
        c.close()


# ---------------------------------------------------------------------------
# 1. Roundtrip partial
# ---------------------------------------------------------------------------
def test_roundtrip_partial_hash(cache: Cache) -> None:
    """set_partial_hash puis get_hashes renvoie le même partial, full=None."""
    cache.set_partial_hash("/a/b.txt", size=100, mtime=1234.5, partial=b"\x01\x02\x03")
    partial, full = cache.get_hashes("/a/b.txt", size=100, mtime=1234.5)
    assert partial == b"\x01\x02\x03"
    assert full is None


# ---------------------------------------------------------------------------
# 2. Roundtrip full (et préservation du partial_hash existant)
# ---------------------------------------------------------------------------
def test_roundtrip_full_hash_preserves_partial(cache: Cache) -> None:
    """set_full_hash sur une ligne existante doit conserver le partial."""
    cache.set_partial_hash("/x", size=10, mtime=2.0, partial=b"PP")
    cache.set_full_hash("/x", size=10, mtime=2.0, full=b"FFFF")
    partial, full = cache.get_hashes("/x", size=10, mtime=2.0)
    assert partial == b"PP"
    assert full == b"FFFF"


# ---------------------------------------------------------------------------
# 3. Invalidation mtime
# ---------------------------------------------------------------------------
def test_invalidation_on_mtime_change(cache: Cache) -> None:
    cache.set_partial_hash("/f", size=50, mtime=1.0, partial=b"AA")
    partial, full = cache.get_hashes("/f", size=50, mtime=2.0)  # mtime différent
    assert partial is None
    assert full is None


# ---------------------------------------------------------------------------
# 4. Invalidation size
# ---------------------------------------------------------------------------
def test_invalidation_on_size_change(cache: Cache) -> None:
    cache.set_partial_hash("/f", size=50, mtime=1.0, partial=b"AA")
    partial, full = cache.get_hashes("/f", size=999, mtime=1.0)  # size différente
    assert partial is None
    assert full is None


# ---------------------------------------------------------------------------
# 5. Suppression stale row au moment du get
# ---------------------------------------------------------------------------
def test_get_hashes_removes_stale_row(cache: Cache, tmp_path: Path) -> None:
    """Un get_hashes sur une ligne stale doit la supprimer physiquement."""
    cache.set_partial_hash("/stale", size=1, mtime=1.0, partial=b"X")
    # Le get avec mtime différent déclenche la suppression.
    cache.get_hashes("/stale", size=1, mtime=999.0)

    # On inspecte directement la base pour vérifier.
    conn = sqlite3.connect(str(cache.db_path))
    try:
        row = conn.execute(
            "SELECT COUNT(*) FROM file_hashes WHERE path = ?", ("/stale",)
        ).fetchone()
    finally:
        conn.close()
    assert row[0] == 0


# ---------------------------------------------------------------------------
# 6. Roundtrip scan_size
# ---------------------------------------------------------------------------
def test_scan_size_roundtrip_and_invalidation(cache: Cache) -> None:
    cache.set_scan_size("/dir", size=42_000, mtime=10.0)
    assert cache.get_scan_size("/dir", mtime=10.0) == 42_000
    # mtime différent → cache invalide
    assert cache.get_scan_size("/dir", mtime=11.0) is None
    # Et la row stale a été supprimée.
    assert cache.get_scan_size("/dir", mtime=10.0) is None


# ---------------------------------------------------------------------------
# 7. clear()
# ---------------------------------------------------------------------------
def test_clear_empties_both_tables(cache: Cache) -> None:
    cache.set_partial_hash("/a", size=1, mtime=1.0, partial=b"a")
    cache.set_full_hash("/b", size=2, mtime=2.0, full=b"b")
    cache.set_scan_size("/c", size=3, mtime=3.0)

    cache.clear()

    assert cache.get_hashes("/a", size=1, mtime=1.0) == (None, None)
    assert cache.get_hashes("/b", size=2, mtime=2.0) == (None, None)
    assert cache.get_scan_size("/c", mtime=3.0) is None


# ---------------------------------------------------------------------------
# 8. Context manager
# ---------------------------------------------------------------------------
def test_context_manager_closes_connection(tmp_path: Path) -> None:
    db = tmp_path / "ctx.db"
    with Cache(db_path=db) as c:
        c.set_partial_hash("/z", size=1, mtime=1.0, partial=b"z")
        assert db.exists()
    # Après la sortie du with, toute opération doit lever (connexion fermée).
    with pytest.raises(Exception):
        c.set_partial_hash("/z2", size=2, mtime=2.0, partial=b"zz")


# ---------------------------------------------------------------------------
# 9. Thread safety — 10 threads écrivent/lisent en parallèle
# ---------------------------------------------------------------------------
def test_thread_safety(cache: Cache) -> None:
    N = 10
    ITER = 20

    def worker(tid: int) -> int:
        count = 0
        for i in range(ITER):
            path = f"/t{tid}/f{i}"
            cache.set_partial_hash(path, size=i, mtime=float(i), partial=bytes([tid, i & 0xFF]))
            cache.set_full_hash(path, size=i, mtime=float(i), full=bytes([tid, i & 0xFF, 0xFF]))
            cache.set_scan_size(f"/t{tid}/d{i}", size=i * 1000, mtime=float(i))
            p, f = cache.get_hashes(path, size=i, mtime=float(i))
            assert p == bytes([tid, i & 0xFF])
            assert f == bytes([tid, i & 0xFF, 0xFF])
            s = cache.get_scan_size(f"/t{tid}/d{i}", mtime=float(i))
            assert s == i * 1000
            count += 1
        return count

    with ThreadPoolExecutor(max_workers=N) as pool:
        results = list(pool.map(worker, range(N)))

    assert results == [ITER] * N
