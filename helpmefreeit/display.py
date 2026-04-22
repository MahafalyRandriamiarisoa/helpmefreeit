"""Rich-based display for disk usage results."""

from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.table import Table
from rich.text import Text
from rich.tree import Tree

from .scanner import Entry

console = Console()

SIZE_UNITS = ["B", "K", "M", "G", "T", "P"]

BAR_CHARS = "▏▎▍▌▋▊▉█"


def format_size(size: int) -> str:
    """Format bytes to human-readable string."""
    if size == 0:
        return "0 B"
    value = float(size)
    for unit in SIZE_UNITS:
        if abs(value) < 1024:
            if unit == "B":
                return f"{int(value)} B"
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} E"


def _size_color(size: int) -> str:
    """Color based on size thresholds."""
    if size >= 10 * 1024**3:  # >= 10 GB
        return "bold red"
    if size >= 1 * 1024**3:  # >= 1 GB
        return "red"
    if size >= 500 * 1024**2:  # >= 500 MB
        return "yellow"
    if size >= 100 * 1024**2:  # >= 100 MB
        return "cyan"
    if size >= 10 * 1024**2:  # >= 10 MB
        return "green"
    return "dim"


def _make_bar(ratio: float, width: int = 30) -> Text:
    """Create a proportional bar using Unicode block characters."""
    if ratio <= 0:
        return Text(" " * width, style="dim")

    full_blocks = int(ratio * width)
    remainder = (ratio * width) - full_blocks
    partial_idx = int(remainder * len(BAR_CHARS))

    bar = "█" * full_blocks
    if full_blocks < width and partial_idx > 0:
        bar += BAR_CHARS[min(partial_idx, len(BAR_CHARS) - 1)]
        fill = width - full_blocks - 1
    else:
        fill = width - full_blocks

    bar += " " * fill

    if ratio >= 0.8:
        color = "red"
    elif ratio >= 0.5:
        color = "yellow"
    elif ratio >= 0.2:
        color = "cyan"
    else:
        color = "green"

    return Text(bar, style=color)


def _entry_icon(entry: Entry) -> str:
    return "📁" if entry.is_dir else "📄"


def display_table(
    root: Entry,
    *,
    top_n: int | None = None,
    sort_by_size: bool = True,
    reverse: bool = False,
    show_percent: bool = True,
) -> None:
    """Display scan results as a rich table."""
    children = list(root.children)

    if sort_by_size:
        children.sort(key=lambda e: e.size, reverse=not reverse)
    elif reverse:
        children.reverse()

    if top_n and top_n > 0:
        children = children[:top_n]

    max_size = root.size if root.size > 0 else 1

    table = Table(
        title=f"  {root.path}",
        title_style="bold white",
        title_justify="left",
        show_header=True,
        header_style="bold bright_white",
        border_style="bright_black",
        pad_edge=False,
        box=None,
        padding=(0, 1),
    )

    table.add_column("", width=2, no_wrap=True)
    table.add_column("Taille", justify="right", width=9, no_wrap=True)
    table.add_column("%", justify="right", width=6, no_wrap=True)
    table.add_column("", width=30, no_wrap=True)
    table.add_column("Nom", no_wrap=False, max_width=80)

    for entry in children:
        ratio = entry.size / max_size if max_size > 0 else 0
        pct = ratio * 100
        color = _size_color(entry.size)

        icon = _entry_icon(entry)
        size_text = Text(format_size(entry.size), style=color)
        pct_text = Text(f"{pct:.1f}%", style=color) if show_percent else Text("")
        bar = _make_bar(ratio)
        name = Text(entry.name, style="bold" if entry.is_dir else "")

        table.add_row(icon, size_text, pct_text, bar, name)

    # Summary line
    shown_size = sum(e.size for e in children)
    other_size = root.size - shown_size

    console.print()
    console.print(table)
    console.print()

    summary_parts = [
        f"[bold]Total:[/bold] [white]{format_size(root.size)}[/white]",
        f"[dim]({len(root.children)} éléments)[/dim]",
    ]
    if other_size > 0 and top_n and top_n < len(root.children):
        summary_parts.append(
            f"  [dim]+ {format_size(other_size)} dans "
            f"{len(root.children) - len(children)} autres[/dim]"
        )

    console.print("  " + "  ".join(summary_parts))
    console.print()


def display_tree(
    root: Entry,
    *,
    top_n: int | None = None,
    sort_by_size: bool = True,
    max_depth: int = 3,
) -> None:
    """Display scan results as a rich tree."""
    tree = Tree(
        f"[bold]{_entry_icon(root)} {root.path}[/bold]  "
        f"[bright_white]{format_size(root.size)}[/bright_white]"
    )

    _add_tree_children(tree, root, top_n=top_n, sort_by_size=sort_by_size, depth=0, max_depth=max_depth)

    console.print()
    console.print(tree)
    console.print()


def _add_tree_children(
    tree: Tree,
    entry: Entry,
    *,
    top_n: int | None,
    sort_by_size: bool,
    depth: int,
    max_depth: int,
) -> None:
    if depth >= max_depth:
        return

    children = list(entry.children)
    if sort_by_size:
        children.sort(key=lambda e: e.size, reverse=True)

    if top_n and top_n > 0:
        children = children[:top_n]

    parent_size = entry.size if entry.size > 0 else 1

    for child in children:
        color = _size_color(child.size)
        pct = (child.size / parent_size * 100) if parent_size > 0 else 0
        icon = _entry_icon(child)

        label = (
            f"{icon} [{color}]{format_size(child.size):>9}[/{color}]"
            f"  [dim]{pct:5.1f}%[/dim]  "
            f"{'[bold]' if child.is_dir else ''}{child.name}"
            f"{'[/bold]' if child.is_dir else ''}"
        )

        if child.is_dir and child.children:
            branch = tree.add(label)
            _add_tree_children(
                branch,
                child,
                top_n=top_n,
                sort_by_size=sort_by_size,
                depth=depth + 1,
                max_depth=max_depth,
            )
        else:
            tree.add(label)
