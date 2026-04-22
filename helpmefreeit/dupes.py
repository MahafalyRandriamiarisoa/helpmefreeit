"""Détection de fichiers en double, en trois passes.

Le principe : deux fichiers ne peuvent être identiques que s'ils ont la
même taille. On construit donc d'abord des groupes par taille exacte, puis
on affine avec un hash partiel rapide, et enfin on confirme avec un hash
complet (BLAKE2b).

Passes successives :

1. **Scan**  : parcours récursif, groupage par ``size`` exacte.
2. **Hash partiel** (``hashing.partial_hash`` — xxh3_64 sur début + fin) :
   disqualifie les fichiers qui ne partagent pas les mêmes extrémités.
3. **Hash complet** (``hashing.full_hash`` — BLAKE2b du contenu entier) :
   confirmation byte-identique.

Les deux dernières passes peuvent s'appuyer sur un :class:`Cache` SQLite
pour éviter de recalculer les empreintes entre deux exécutions : on ne
réhashe un fichier que si sa ``size`` ou sa ``mtime`` a changé.

Parallélisme : les I/O étant dominants, un :class:`ThreadPoolExecutor`
simple (GIL relâché pendant les lectures fichier) suffit.
"""

from __future__ import annotations

import logging
import os
import stat as stat_mod
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from helpmefreeit.cache import Cache
from helpmefreeit.hashing import full_hash, partial_hash

_logger = logging.getLogger(__name__)

# Nombre de workers pour les passes 2 et 3 (I/O-bound).
_MAX_WORKERS = 8

# Type alias : un enregistrement fichier intermédiaire (chemin, taille, mtime).
_FileEntry = tuple[Path, int, float]


# ---------------------------------------------------------------------------
# Type de sortie
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class DupeGroup:
    """Un groupe de fichiers byte-identiques.

    Attributs
    ---------
    size:
        Taille commune à tous les fichiers du groupe (en octets).
    full_hash:
        Empreinte BLAKE2b (32 octets) partagée par tous les chemins.
    paths:
        Au moins deux chemins absolus pointant sur un fichier régulier.
    """

    size: int
    full_hash: bytes
    paths: list[Path]

    @property
    def recoverable_bytes(self) -> int:
        """Octets récupérables si on ne garde qu'un exemplaire du groupe."""
        return self.size * (len(self.paths) - 1)


# ---------------------------------------------------------------------------
# Passe 1 — scan et groupage par taille
# ---------------------------------------------------------------------------
def _scan_files(
    root: Path,
    *,
    min_size: int,
    follow_symlinks: bool,
    on_progress: Optional[Callable[[str, int, int], None]],
) -> dict[int, list[_FileEntry]]:
    """Parcourt ``root`` et groupe les fichiers réguliers par ``size`` exacte.

    - Les symlinks ne sont jamais inclus (sauf si ``follow_symlinks=True``).
    - Les fichiers non réguliers (FIFO, sockets, devices, …) sont ignorés.
    - Les groupes de taille 1 sont filtrés avant de retourner (ils ne
      peuvent pas contenir de doublon).
    """
    by_size: dict[int, list[_FileEntry]] = {}
    count = 0

    # followlinks contrôle la traversée des dossiers symlinkés par os.walk.
    # On duplique son interprétation au niveau fichier via is_symlink() plus bas.
    for dirpath, _dirnames, filenames in os.walk(root, followlinks=follow_symlinks):
        for fname in filenames:
            fpath = Path(dirpath) / fname
            try:
                # Si l'entrée est un symlink et que la politique est de ne pas
                # suivre, on skippe tout de suite — évite d'appeler stat() qui
                # résoudrait le lien.
                if not follow_symlinks and fpath.is_symlink():
                    continue
                st = fpath.stat()
            except OSError as exc:
                _logger.debug("scan: skip %s (stat a échoué : %s)", fpath, exc)
                continue

            # On ne considère que les fichiers réguliers. Les tailles reportées
            # par un FIFO/socket/device n'ont pas de sens pour une comparaison.
            if not stat_mod.S_ISREG(st.st_mode):
                continue

            size = st.st_size
            if size < min_size:
                continue

            by_size.setdefault(size, []).append((fpath, size, st.st_mtime))
            count += 1
            if on_progress is not None:
                # Le total réel n'est pas connu avant la fin : on passe
                # (count, count) pour avoir une progression croissante mais
                # cohérente côté consommateur.
                on_progress("scan", count, count)

    # On écarte d'emblée les tailles singleton : pas de doublon possible.
    return {size: files for size, files in by_size.items() if len(files) > 1}


# ---------------------------------------------------------------------------
# Utilitaire commun aux passes 2 et 3 : hacher avec cache et parallélisme
# ---------------------------------------------------------------------------
def _hash_files_parallel(
    entries: list[_FileEntry],
    *,
    step: str,
    cache: Optional[Cache],
    on_progress: Optional[Callable[[str, int, int], None]],
) -> dict[Path, bytes]:
    """Hashe en parallèle tous les ``entries`` pour l'étape ``step``.

    ``step`` ∈ {"partial", "full"} choisit à la fois :
    - la fonction de hachage appelée (``partial_hash`` ou ``full_hash``),
    - la colonne du cache lue/écrite.

    Retourne un dict ``{Path: digest}`` ne contenant que les fichiers
    effectivement hachés avec succès (les échecs I/O sont loggés en debug
    puis ignorés, pour ne pas faire planter tout le scan).
    """
    if step == "partial":
        hash_fn = partial_hash

        def cached(path: str, size: int, mtime: float) -> Optional[bytes]:
            if cache is None:
                return None
            p, _ = cache.get_hashes(path, size, mtime)
            return p

        def store(path: str, size: int, mtime: float, digest: bytes) -> None:
            if cache is not None:
                cache.set_partial_hash(path, size, mtime, digest)

    elif step == "full":
        hash_fn = full_hash

        def cached(path: str, size: int, mtime: float) -> Optional[bytes]:
            if cache is None:
                return None
            _, f = cache.get_hashes(path, size, mtime)
            return f

        def store(path: str, size: int, mtime: float, digest: bytes) -> None:
            if cache is not None:
                cache.set_full_hash(path, size, mtime, digest)

    else:
        raise ValueError(f"step inconnu : {step!r}")

    def _task(entry: _FileEntry) -> tuple[Path, Optional[bytes]]:
        fpath, size, mtime = entry
        spath = str(fpath)
        # Cache hit : on ne relit pas le fichier.
        hit = cached(spath, size, mtime)
        if hit is not None:
            return (fpath, hit)
        try:
            digest = hash_fn(fpath)
        except OSError as exc:
            _logger.debug("%s: skip %s (%s a échoué : %s)", step, fpath, step, exc)
            return (fpath, None)
        # L'écriture en cache est best-effort : un souci ne doit pas faire
        # rater la détection des doublons.
        try:
            store(spath, size, mtime, digest)
        except Exception as exc:  # noqa: BLE001
            _logger.debug("%s: cache write failed for %s : %s", step, fpath, exc)
        return (fpath, digest)

    results: dict[Path, bytes] = {}
    total = len(entries)
    processed = 0

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        futures = [pool.submit(_task, e) for e in entries]
        for fut in as_completed(futures):
            fpath, digest = fut.result()
            processed += 1
            if on_progress is not None:
                on_progress(step, processed, total)
            if digest is not None:
                results[fpath] = digest

    return results


# ---------------------------------------------------------------------------
# Passe 2 — hash partiel
# ---------------------------------------------------------------------------
def _partial_hash_pass(
    size_groups: dict[int, list[_FileEntry]],
    *,
    cache: Optional[Cache],
    on_progress: Optional[Callable[[str, int, int], None]],
) -> dict[tuple[int, bytes], list[_FileEntry]]:
    """Recalcule les groupes par ``(size, partial_hash)``.

    En entrée on a les groupes par taille (tous de cardinal ≥ 2). En sortie,
    on regroupe finement et on écarte à nouveau les singletons.
    """
    flat: list[_FileEntry] = [e for entries in size_groups.values() for e in entries]
    digests = _hash_files_parallel(
        flat, step="partial", cache=cache, on_progress=on_progress
    )

    regrouped: dict[tuple[int, bytes], list[_FileEntry]] = {}
    for entry in flat:
        fpath, size, _mtime = entry
        d = digests.get(fpath)
        if d is None:
            continue  # fichier illisible, déjà logué
        regrouped.setdefault((size, d), []).append(entry)

    return {key: files for key, files in regrouped.items() if len(files) > 1}


# ---------------------------------------------------------------------------
# Passe 3 — hash complet
# ---------------------------------------------------------------------------
def _full_hash_pass(
    partial_groups: dict[tuple[int, bytes], list[_FileEntry]],
    *,
    cache: Optional[Cache],
    on_progress: Optional[Callable[[str, int, int], None]],
) -> dict[tuple[int, bytes], list[_FileEntry]]:
    """Recalcule les groupes par ``(size, full_hash)``.

    On ne hashe que les fichiers qui ont survécu à la passe 2 : c'est là
    que le schéma ``partial → full`` gagne du temps sur de grosses arborescences.
    """
    flat: list[_FileEntry] = [e for entries in partial_groups.values() for e in entries]
    digests = _hash_files_parallel(
        flat, step="full", cache=cache, on_progress=on_progress
    )

    regrouped: dict[tuple[int, bytes], list[_FileEntry]] = {}
    for entry in flat:
        fpath, size, _mtime = entry
        d = digests.get(fpath)
        if d is None:
            continue
        regrouped.setdefault((size, d), []).append(entry)

    return {key: files for key, files in regrouped.items() if len(files) > 1}


# ---------------------------------------------------------------------------
# API publique
# ---------------------------------------------------------------------------
def find_duplicates(
    root: Path,
    *,
    min_size: int = 0,
    follow_symlinks: bool = False,
    cache: Optional[Cache] = None,
    on_progress: Optional[Callable[[str, int, int], None]] = None,
) -> list[DupeGroup]:
    """Retourne les groupes de fichiers byte-identiques sous ``root``.

    Les groupes sont triés par :attr:`DupeGroup.recoverable_bytes` décroissants
    (on place en tête les gains les plus importants).

    Paramètres
    ----------
    root:
        Dossier racine du scan.
    min_size:
        Taille minimale (en octets) pour qu'un fichier soit considéré. Les
        fichiers plus petits que ``min_size`` sont ignorés dès la passe 1.
    follow_symlinks:
        Si ``True``, suit les symlinks (dossiers et fichiers). Par défaut
        ``False`` : on ne traverse pas les liens, pour ne pas compter un
        même fichier plusieurs fois ni tomber dans une boucle.
    cache:
        Instance optionnelle de :class:`Cache`. Si fournie, les empreintes
        sont lues depuis / écrites dans la base pour accélérer les exécutions
        suivantes.
    on_progress:
        Callback optionnel, signature ``(step, processed, total)`` avec
        ``step`` ∈ {"scan", "partial", "full"}.

    Retourne
    --------
    Une liste de :class:`DupeGroup`. Liste vide si aucun doublon n'a été
    trouvé.
    """
    root = Path(root)

    # Passe 1 — scan récursif + groupage par taille
    size_groups = _scan_files(
        root,
        min_size=min_size,
        follow_symlinks=follow_symlinks,
        on_progress=on_progress,
    )
    if not size_groups:
        return []

    # Passe 2 — hash partiel
    partial_groups = _partial_hash_pass(
        size_groups, cache=cache, on_progress=on_progress
    )
    if not partial_groups:
        return []

    # Passe 3 — hash complet (confirmation)
    full_groups = _full_hash_pass(
        partial_groups, cache=cache, on_progress=on_progress
    )

    # Construction des DupeGroup finaux.
    groups: list[DupeGroup] = []
    for (size, digest), entries in full_groups.items():
        paths = [e[0] for e in entries]
        groups.append(DupeGroup(size=size, full_hash=digest, paths=paths))

    # Tri par octets récupérables décroissants : les plus gros gains en tête.
    groups.sort(key=lambda g: g.recoverable_bytes, reverse=True)
    return groups
