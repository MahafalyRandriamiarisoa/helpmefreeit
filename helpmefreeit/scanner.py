"""Fast disk usage scanner using parallel du commands."""

from __future__ import annotations

import os
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

_MAX_WORKERS = 12


@dataclass
class Entry:
    path: Path
    size: int = 0
    is_dir: bool = False
    children: list[Entry] = field(default_factory=list)
    error: str | None = None
    file_count: int = 0
    dir_count: int = 0

    @property
    def name(self) -> str:
        return self.path.name or str(self.path)


def _du_size(path: str, depth: int = 0, cross_device: bool = True) -> dict[str, int]:
    """Run du on a single path. Returns {path: size_bytes}.

    depth=0 means just the total for that path (du -sk).
    depth>0 means report sub-entries up to that depth (du -d<depth> -k).
    """
    if depth == 0:
        cmd = ["du", "-sk"]
    else:
        cmd = ["du", "-k", f"-d{depth}"]

    if not cross_device:
        cmd.append("-x")
    cmd.append(path)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=120,
        )
    except (subprocess.TimeoutExpired, OSError):
        return {}

    sizes: dict[str, int] = {}
    for line in result.stdout.splitlines():
        parts = line.split("\t", 1)
        if len(parts) == 2:
            try:
                size_kb = int(parts[0].strip())
                p = parts[1].strip()
                sizes[p] = size_kb * 1024
            except ValueError:
                continue
    return sizes


def scan_directory(
    root: Path,
    *,
    max_depth: int = 1,
    include_files: bool = False,
    include_hidden: bool = False,
    no_cross_device: bool = False,
    min_size: int = 0,
    on_progress: Callable[[str, int], None] | None = None,
) -> Entry:
    """Scan a directory tree and compute sizes using parallel du commands.

    Args:
        root: Directory to scan.
        max_depth: How many levels deep to report (1 = immediate children).
        include_files: Include individual files in results (not just dirs).
        include_hidden: Include dot-files/dirs.
        no_cross_device: Don't cross filesystem boundaries (like du -x).
        min_size: Minimum size in bytes to include in results.
        on_progress: Callback(name, size_so_far) called as items complete.
    """
    root = root.resolve()
    root_str = str(root)
    cross_device = not no_cross_device

    # List top-level entries with os.scandir (instant)
    top_items: list[os.DirEntry] = []
    try:
        with os.scandir(root_str) as it:
            top_items = list(it)
    except (PermissionError, OSError) as e:
        return Entry(path=root, is_dir=True, error=str(e))

    root_entry = Entry(path=root, is_dir=True)

    # Separate dirs and files
    dirs: list[os.DirEntry] = []
    files: list[os.DirEntry] = []
    hidden_dirs: list[os.DirEntry] = []

    for item in top_items:
        try:
            is_link = item.is_symlink()
            is_dir = item.is_dir(follow_symlinks=False)
        except OSError:
            continue

        if is_link:
            # Count symlink size but don't follow
            try:
                size = item.stat(follow_symlinks=False).st_size
            except OSError:
                size = 0
            root_entry.size += size
            if include_files and include_hidden or not item.name.startswith("."):
                root_entry.file_count += 1
                if include_files:
                    root_entry.children.append(
                        Entry(path=Path(item.path), size=size)
                    )
            continue

        if is_dir:
            if item.name.startswith("."):
                if include_hidden:
                    dirs.append(item)
                else:
                    hidden_dirs.append(item)
            else:
                dirs.append(item)
        else:
            try:
                size = item.stat(follow_symlinks=False).st_size
            except OSError:
                size = 0
            root_entry.size += size
            root_entry.file_count += 1
            if include_files and (include_hidden or not item.name.startswith(".")):
                root_entry.children.append(
                    Entry(path=Path(item.path), size=size)
                )
            elif not include_hidden and item.name.startswith("."):
                pass  # size already counted
            elif not include_files:
                pass  # size counted, not displayed

    # Parallel du for each top-level directory
    sub_depth = max(0, max_depth - 1)
    workers = min(_MAX_WORKERS, max(1, len(dirs) + len(hidden_dirs)))

    def _scan_dir(item: os.DirEntry, report: bool) -> tuple[str, dict[str, int]]:
        sizes = _du_size(item.path, depth=sub_depth if report else 0, cross_device=cross_device)
        return (item.path, sizes)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for item in dirs:
            futures[pool.submit(_scan_dir, item, True)] = item
        for item in hidden_dirs:
            futures[pool.submit(_scan_dir, item, False)] = item

        for future in as_completed(futures):
            item = futures[future]
            item_path, sizes = future.result()
            is_hidden = item.name.startswith(".")

            # Total size for this dir
            dir_size = sizes.get(item_path, 0)
            root_entry.size += dir_size

            if is_hidden and not include_hidden:
                # Just count size, don't add to children
                if on_progress:
                    on_progress(item.name, root_entry.size)
                continue

            root_entry.dir_count += 1

            if max_depth == 0:
                if on_progress:
                    on_progress(item.name, root_entry.size)
                continue

            child = Entry(
                path=Path(item_path),
                size=dir_size,
                is_dir=True,
            )

            # Build sub-tree if depth > 1
            if sub_depth > 0:
                _build_subtree(child, item_path, sizes, sub_depth)

            root_entry.children.append(child)

            if on_progress:
                on_progress(item.name, root_entry.size)

    if min_size > 0:
        root_entry.children = [c for c in root_entry.children if c.size >= min_size]

    return root_entry


def _build_subtree(
    parent: Entry,
    parent_path: str,
    sizes: dict[str, int],
    remaining_depth: int,
) -> None:
    """Build child entries from du output."""
    if remaining_depth <= 0:
        return

    parent_prefix = parent_path.rstrip("/") + "/"

    for entry_path, size in sizes.items():
        if not entry_path.startswith(parent_prefix):
            continue
        rel = entry_path[len(parent_prefix):]
        # Only direct children (no slashes in relative path)
        if "/" in rel:
            continue

        child = Entry(
            path=Path(entry_path),
            size=size,
            is_dir=True,
        )
        parent.children.append(child)
        parent.dir_count += 1

        if remaining_depth > 1:
            _build_subtree(child, entry_path, sizes, remaining_depth - 1)
