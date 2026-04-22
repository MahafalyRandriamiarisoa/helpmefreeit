"""Tests pour helpmefreeit.hashing.

On couvre 11 cas :

1.  ``partial_hash`` est déterministe.
2.  ``partial_hash`` renvoie exactement 8 octets.
3.  ``full_hash`` est déterministe.
4.  ``full_hash`` renvoie exactement 32 octets.
5.  Petit fichier (10 octets) : ``partial_hash`` hash tout et reste cohérent.
6.  Deux fichiers de contenu identique → mêmes hash partiel et complet.
7.  Deux fichiers qui diffèrent au début → partiel et complet diffèrent.
8.  Deux fichiers qui diffèrent à la fin → partiel et complet diffèrent.
9.  Deux fichiers qui diffèrent au milieu (2×10 MiB) : ``full_hash`` détecte
    la différence, ``partial_hash`` ne la voit pas (by design).
10. Fichier vide : les deux fonctions renvoient un digest valide.
11. Fichier inexistant : les deux fonctions lèvent ``OSError``.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from helpmefreeit.hashing import full_hash, partial_hash


def _write(tmp_path: Path, name: str, data: bytes) -> Path:
    """Helper : écrit un fichier et renvoie son chemin."""
    p = tmp_path / name
    p.write_bytes(data)
    return p


# ---------------------------------------------------------------------------
# 1. Déterminisme partial_hash
# ---------------------------------------------------------------------------
def test_partial_hash_deterministe(tmp_path: Path) -> None:
    f = _write(tmp_path, "a.bin", b"hello world" * 1000)
    assert partial_hash(f) == partial_hash(f)


# ---------------------------------------------------------------------------
# 2. Longueur digest partial_hash
# ---------------------------------------------------------------------------
def test_partial_hash_retourne_8_octets(tmp_path: Path) -> None:
    f = _write(tmp_path, "a.bin", b"x" * 20000)
    digest = partial_hash(f)
    assert isinstance(digest, bytes)
    assert len(digest) == 8


# ---------------------------------------------------------------------------
# 3. Déterminisme full_hash
# ---------------------------------------------------------------------------
def test_full_hash_deterministe(tmp_path: Path) -> None:
    f = _write(tmp_path, "a.bin", b"abcdef" * 10000)
    assert full_hash(f) == full_hash(f)


# ---------------------------------------------------------------------------
# 4. Longueur digest full_hash
# ---------------------------------------------------------------------------
def test_full_hash_retourne_32_octets(tmp_path: Path) -> None:
    f = _write(tmp_path, "a.bin", b"payload" * 500)
    digest = full_hash(f)
    assert isinstance(digest, bytes)
    assert len(digest) == 32


# ---------------------------------------------------------------------------
# 5. Petit fichier (10 octets)
# ---------------------------------------------------------------------------
def test_partial_hash_petit_fichier(tmp_path: Path) -> None:
    # 10 octets : bien inférieur à 2*sample_size → on lit tout.
    f = _write(tmp_path, "petit.bin", b"0123456789")
    digest = partial_hash(f)
    assert len(digest) == 8

    # Et le hash doit rester cohérent d'un appel à l'autre.
    assert partial_hash(f) == digest


# ---------------------------------------------------------------------------
# 6. Fichiers identiques
# ---------------------------------------------------------------------------
def test_fichiers_identiques_meme_hash(tmp_path: Path) -> None:
    data = b"contenu exactement identique" * 2000
    f1 = _write(tmp_path, "f1.bin", data)
    f2 = _write(tmp_path, "f2.bin", data)

    assert partial_hash(f1) == partial_hash(f2)
    assert full_hash(f1) == full_hash(f2)


# ---------------------------------------------------------------------------
# 7. Différence au début
# ---------------------------------------------------------------------------
def test_fichiers_differents_au_debut(tmp_path: Path) -> None:
    base = b"X" * 20000
    f1 = _write(tmp_path, "f1.bin", b"AAAA" + base)
    f2 = _write(tmp_path, "f2.bin", b"BBBB" + base)

    assert partial_hash(f1) != partial_hash(f2)
    assert full_hash(f1) != full_hash(f2)


# ---------------------------------------------------------------------------
# 8. Différence à la fin
# ---------------------------------------------------------------------------
def test_fichiers_differents_a_la_fin(tmp_path: Path) -> None:
    base = b"X" * 20000
    f1 = _write(tmp_path, "f1.bin", base + b"AAAA")
    f2 = _write(tmp_path, "f2.bin", base + b"BBBB")

    assert partial_hash(f1) != partial_hash(f2)
    assert full_hash(f1) != full_hash(f2)


# ---------------------------------------------------------------------------
# 9. Différence au milieu (2×10 MiB, 1 octet modifié au centre)
#    → full_hash la détecte, partial_hash la rate (by design).
# ---------------------------------------------------------------------------
def test_diff_au_milieu_full_detecte_partial_rate(tmp_path: Path) -> None:
    size = 10 * 1024 * 1024  # 10 MiB
    data1 = bytearray(b"A" * size)
    data2 = bytearray(data1)
    # Modifie un octet pile au milieu.
    data2[size // 2] = ord("B")

    f1 = _write(tmp_path, "big1.bin", bytes(data1))
    f2 = _write(tmp_path, "big2.bin", bytes(data2))

    # Le sample_size par défaut (4 Kio) ne touche pas le milieu d'un 10 MiB.
    assert partial_hash(f1) == partial_hash(f2), (
        "partial_hash ne doit pas voir un octet modifié au milieu d'un 10 MiB"
    )
    # Le full_hash, lui, doit voir la différence.
    assert full_hash(f1) != full_hash(f2)


# ---------------------------------------------------------------------------
# 10. Fichier vide
# ---------------------------------------------------------------------------
def test_fichier_vide(tmp_path: Path) -> None:
    f = _write(tmp_path, "vide.bin", b"")
    # Les deux fonctions doivent renvoyer un digest de longueur attendue
    # sans lever d'exception.
    assert len(partial_hash(f)) == 8
    assert len(full_hash(f)) == 32


# ---------------------------------------------------------------------------
# 11. OSError sur fichier inexistant
# ---------------------------------------------------------------------------
def test_oserror_sur_fichier_inexistant(tmp_path: Path) -> None:
    inexistant = tmp_path / "nope.bin"
    with pytest.raises(OSError):
        partial_hash(inexistant)
    with pytest.raises(OSError):
        full_hash(inexistant)
