"""Fonctions de hachage pour la détection de doublons.

Deux niveaux :

- ``partial_hash`` : empreinte xxh3_64 rapide (N premiers + N derniers octets).
  Utilisé pour un premier tri grossier des fichiers de même taille.
- ``full_hash`` : empreinte BLAKE2b cryptographique (digest 32 octets) en
  streaming. Utilisé pour confirmer les doublons réels.

Les deux fonctions lèvent ``OSError`` si le fichier est illisible. Aucune
autre exception n'est interceptée : au niveau appelant, on est libre de
logguer et de continuer.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import xxhash

# Tailles par défaut. Exposées en arguments pour pouvoir tester avec de
# petites valeurs et rester flexible côté scanner.
_DEFAULT_SAMPLE_SIZE = 4096
_DEFAULT_CHUNK_SIZE = 1024 * 1024  # 1 Mio


def partial_hash(path: Path, sample_size: int = _DEFAULT_SAMPLE_SIZE) -> bytes:
    """Empreinte xxh3_64 des ``sample_size`` premiers + derniers octets.

    Si la taille du fichier est strictement inférieure à ``2 * sample_size``,
    on hash tout le contenu d'un seul coup (on évite de lire deux fois les
    mêmes octets et donc de fausser le hash).

    Args:
        path: Chemin du fichier à hasher.
        sample_size: Nombre d'octets pris en tête et en queue.

    Returns:
        Un digest brut de 8 octets.

    Raises:
        OSError: Fichier inexistant, permission refusée, etc.
    """
    if sample_size <= 0:
        raise ValueError("sample_size doit être strictement positif")

    hasher = xxhash.xxh3_64()
    # On récupère la taille via stat() : évite une seek() inutile pour les
    # petits fichiers, et permet de choisir la stratégie avant l'ouverture.
    size = path.stat().st_size

    with path.open("rb") as f:
        if size <= 2 * sample_size:
            # Fichier court : on lit tout. La concaténation début+fin
            # donnerait un hash différent du "hash de tout" ; on préfère
            # la cohérence (deux fichiers identiques → même hash, quel
            # que soit leur taille).
            hasher.update(f.read())
        else:
            # Début
            head = f.read(sample_size)
            hasher.update(head)
            # Fin
            f.seek(-sample_size, 2)  # 2 = SEEK_END
            tail = f.read(sample_size)
            hasher.update(tail)

    return hasher.digest()


def full_hash(path: Path, chunk_size: int = _DEFAULT_CHUNK_SIZE) -> bytes:
    """Empreinte BLAKE2b (digest 32 octets) du contenu complet du fichier.

    Lecture en streaming par chunks de ``chunk_size`` octets : utilisable
    sur des fichiers plus gros que la RAM disponible.

    Args:
        path: Chemin du fichier à hasher.
        chunk_size: Taille des blocs lus à chaque itération (en octets).

    Returns:
        Un digest brut de 32 octets.

    Raises:
        OSError: Fichier inexistant, permission refusée, etc.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size doit être strictement positif")

    hasher = hashlib.blake2b(digest_size=32)

    with path.open("rb") as f:
        # iter(callable, sentinel) s'arrête quand read() renvoie b"" (EOF).
        for chunk in iter(lambda: f.read(chunk_size), b""):
            hasher.update(chunk)

    return hasher.digest()
