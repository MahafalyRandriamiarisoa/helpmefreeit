"""Cache SQLite pour freeit.

Ce module fournit la classe :class:`Cache`, un petit wrapper thread-safe
autour d'une base SQLite stockée dans le répertoire de cache utilisateur
(via :mod:`platformdirs`). Il mémorise :

* les empreintes (xxhash) partielles/complètes des fichiers, indexées par
  chemin et invalidées si ``size`` ou ``mtime`` change ;
* les tailles récursives de dossiers calculées par ``du``, indexées par
  chemin et invalidées si ``mtime`` change.

L'objectif est d'éviter de recalculer ces données coûteuses entre deux
scans successifs.
"""

from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

from platformdirs import user_cache_dir


# ---------------------------------------------------------------------------
# Schéma SQL (idempotent)
# ---------------------------------------------------------------------------
_SCHEMA = """
CREATE TABLE IF NOT EXISTS file_hashes (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    partial_hash BLOB,
    full_hash BLOB,
    ts REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_hashes_size ON file_hashes(size);

CREATE TABLE IF NOT EXISTS scan_sizes (
    path TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    ts REAL NOT NULL
);
"""


def _default_db_path() -> Path:
    """Retourne le chemin par défaut de la base (``<user_cache>/freeit/cache.db``)."""
    return Path(user_cache_dir("freeit")) / "cache.db"


class Cache:
    """Cache persistant basé sur SQLite.

    La base est protégée par un :class:`threading.Lock` afin de permettre
    un accès concurrent depuis plusieurs threads (le scanner utilise un
    ``ThreadPoolExecutor``).

    Paramètres
    ----------
    db_path:
        Chemin vers le fichier SQLite. ``None`` utilise l'emplacement
        standard déterminé par :func:`platformdirs.user_cache_dir`.
    """

    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path: Path = Path(db_path) if db_path is not None else _default_db_path()
        # Crée le dossier parent si nécessaire.
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

        # check_same_thread=False : la connexion est partagée entre threads,
        # la sérialisation est assurée par self._lock.
        self._conn: sqlite3.Connection = sqlite3.connect(
            str(self.db_path),
            check_same_thread=False,
            isolation_level=None,  # autocommit — chaque statement commit tout seul
        )
        self._lock: threading.Lock = threading.Lock()

        # Quelques pragmas utiles pour la robustesse et la perf.
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(_SCHEMA)

    # ------------------------------------------------------------------
    # Cycle de vie
    # ------------------------------------------------------------------
    def close(self) -> None:
        """Ferme la connexion sous-jacente (idempotent)."""
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.close()
                finally:
                    self._conn = None  # type: ignore[assignment]

    def __enter__(self) -> "Cache":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    # ------------------------------------------------------------------
    # file_hashes
    # ------------------------------------------------------------------
    def get_hashes(
        self, path: str, size: int, mtime: float
    ) -> tuple[Optional[bytes], Optional[bytes]]:
        """Retourne ``(partial_hash, full_hash)`` pour *path* si la ligne
        est toujours valide (``size`` et ``mtime`` identiques).

        Si la ligne existe mais est obsolète, elle est supprimée et
        ``(None, None)`` est renvoyé. Si aucune ligne n'existe, renvoie
        aussi ``(None, None)``.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT size, mtime, partial_hash, full_hash FROM file_hashes WHERE path = ?",
                (path,),
            ).fetchone()
            if row is None:
                return (None, None)
            cached_size, cached_mtime, partial, full = row
            if cached_size != size or cached_mtime != mtime:
                # Entrée stale : on la supprime pour éviter la confusion.
                self._conn.execute("DELETE FROM file_hashes WHERE path = ?", (path,))
                return (None, None)
            return (partial, full)

    def set_partial_hash(
        self, path: str, size: int, mtime: float, partial: bytes
    ) -> None:
        """Enregistre (ou met à jour) l'empreinte *partielle* d'un fichier.

        Un upsert est utilisé : si une ligne existe déjà pour *path*, on
        met à jour ``size``, ``mtime``, ``partial_hash`` et ``ts`` ; le
        ``full_hash`` existant est préservé seulement si ``size`` et
        ``mtime`` n'ont pas changé, sinon il est invalidé (NULL).
        """
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO file_hashes (path, size, mtime, partial_hash, full_hash, ts)
                VALUES (?, ?, ?, ?, NULL, ?)
                ON CONFLICT(path) DO UPDATE SET
                    partial_hash = excluded.partial_hash,
                    -- Si size/mtime ont changé, le full_hash précédent ne vaut plus rien.
                    full_hash = CASE
                        WHEN file_hashes.size = excluded.size
                             AND file_hashes.mtime = excluded.mtime
                        THEN file_hashes.full_hash
                        ELSE NULL
                    END,
                    size = excluded.size,
                    mtime = excluded.mtime,
                    ts = excluded.ts
                """,
                (path, size, mtime, partial, now),
            )

    def set_full_hash(
        self, path: str, size: int, mtime: float, full: bytes
    ) -> None:
        """Enregistre (ou met à jour) l'empreinte *complète* d'un fichier.

        Le ``partial_hash`` existant est préservé tant que ``size`` et
        ``mtime`` correspondent à ceux déjà en base. Sinon il est mis à
        NULL (donnée stale).
        """
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO file_hashes (path, size, mtime, partial_hash, full_hash, ts)
                VALUES (?, ?, ?, NULL, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    full_hash = excluded.full_hash,
                    partial_hash = CASE
                        WHEN file_hashes.size = excluded.size
                             AND file_hashes.mtime = excluded.mtime
                        THEN file_hashes.partial_hash
                        ELSE NULL
                    END,
                    size = excluded.size,
                    mtime = excluded.mtime,
                    ts = excluded.ts
                """,
                (path, size, mtime, full, now),
            )

    # ------------------------------------------------------------------
    # scan_sizes
    # ------------------------------------------------------------------
    def get_scan_size(self, path: str, mtime: float) -> Optional[int]:
        """Retourne la taille récursive en cache pour *path* si la
        ``mtime`` correspond, sinon ``None``. Une entrée stale est
        supprimée au passage.
        """
        with self._lock:
            row = self._conn.execute(
                "SELECT size, mtime FROM scan_sizes WHERE path = ?",
                (path,),
            ).fetchone()
            if row is None:
                return None
            cached_size, cached_mtime = row
            if cached_mtime != mtime:
                self._conn.execute("DELETE FROM scan_sizes WHERE path = ?", (path,))
                return None
            return int(cached_size)

    def set_scan_size(self, path: str, size: int, mtime: float) -> None:
        """Enregistre (ou met à jour) la taille récursive d'un dossier."""
        now = time.time()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO scan_sizes (path, size, mtime, ts)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(path) DO UPDATE SET
                    size = excluded.size,
                    mtime = excluded.mtime,
                    ts = excluded.ts
                """,
                (path, size, mtime, now),
            )

    # ------------------------------------------------------------------
    # Maintenance
    # ------------------------------------------------------------------
    def clear(self) -> None:
        """Vide toutes les tables du cache."""
        with self._lock:
            self._conn.execute("DELETE FROM file_hashes")
            self._conn.execute("DELETE FROM scan_sizes")

    def vacuum(self) -> None:
        """Exécute un ``VACUUM`` pour récupérer l'espace disque."""
        with self._lock:
            # VACUUM ne peut pas tourner dans une transaction ; isolation_level=None
            # (autocommit) rend cet appel possible tel quel.
            self._conn.execute("VACUUM")
