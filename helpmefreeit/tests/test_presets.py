"""Tests du module ``helpmefreeit.presets``."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from helpmefreeit.presets import (
    PRESETS,
    JunkPreset,
    get_preset,
    resolve_paths,
)


# ---------------------------------------------------------------------------
# Cohérence du catalogue
# ---------------------------------------------------------------------------


def test_preset_ids_sont_uniques() -> None:
    ids = [p.id for p in PRESETS]
    assert len(ids) == len(set(ids)), f"IDs dupliqués : {ids}"


def test_tous_les_paths_sont_non_vides() -> None:
    for preset in PRESETS:
        assert preset.paths, f"Preset {preset.id} n'a aucun chemin"
        for pattern in preset.paths:
            assert isinstance(pattern, str)
            assert pattern.strip(), (
                f"Preset {preset.id} contient un chemin vide : {pattern!r}"
            )


def test_labels_et_descriptions_en_francais() -> None:
    """Heuristique simple : présence d'au moins un mot-clé FR dans
    le label ou la description de chaque preset."""
    mots_fr = {
        " de ",
        " des ",
        " du ",
        " le ",
        " la ",
        " les ",
        " et ",
        " par ",
        " pour ",
        " dans ",
        " au ",
    }
    for preset in PRESETS:
        assert preset.label, f"Preset {preset.id} sans label"
        assert preset.description, f"Preset {preset.id} sans description"
        blob = f"{preset.label} {preset.description}".lower()
        assert any(mot in blob for mot in mots_fr), (
            f"Preset {preset.id} n'a pas l'air en français : {blob!r}"
        )


# ---------------------------------------------------------------------------
# get_preset
# ---------------------------------------------------------------------------


def test_get_preset_retourne_preset_existant() -> None:
    preset = get_preset("caches-user")
    assert preset is not None
    assert preset.id == "caches-user"


def test_get_preset_retourne_none_pour_id_inconnu() -> None:
    assert get_preset("n-existe-pas") is None


# ---------------------------------------------------------------------------
# resolve_paths
# ---------------------------------------------------------------------------


def test_resolve_paths_sur_preset_custom(tmp_path: Path) -> None:
    # Crée une arborescence minimale.
    (tmp_path / "a").mkdir()
    (tmp_path / "a" / "node_modules").mkdir()
    (tmp_path / "b").mkdir()
    (tmp_path / "b" / "node_modules").mkdir()
    (tmp_path / "c").mkdir()  # pas de node_modules

    preset = JunkPreset(
        id="test",
        label="Test",
        description="Preset de test",
        paths=["**/node_modules"],
        safe=True,
    )

    resolved = resolve_paths(preset, root=tmp_path)
    resolved_names = {p.name for p in resolved}
    assert resolved_names == {"node_modules"}
    assert len(resolved) == 2


def test_resolve_paths_filtre_par_age(tmp_path: Path) -> None:
    vieux = tmp_path / "vieux.txt"
    recent = tmp_path / "recent.txt"
    vieux.write_text("vieux")
    recent.write_text("recent")

    # Recule le mtime de `vieux` de 100 jours.
    cent_jours = 100 * 86400
    ancien_ts = time.time() - cent_jours
    os.utime(vieux, (ancien_ts, ancien_ts))

    preset = JunkPreset(
        id="test-age",
        label="Test âge",
        description="Filtre par âge",
        paths=["*.txt"],
        safe=False,
        min_age_days=90,
    )

    resolved = resolve_paths(preset, root=tmp_path)
    noms = {p.name for p in resolved}
    assert noms == {"vieux.txt"}


def test_resolve_paths_ignore_symlinks(tmp_path: Path) -> None:
    cible = tmp_path / "cible.txt"
    cible.write_text("hello")
    lien = tmp_path / "lien.txt"
    lien.symlink_to(cible)

    preset = JunkPreset(
        id="test-symlink",
        label="Test symlink",
        description="Ignore les symlinks",
        paths=["*.txt"],
        safe=True,
    )

    resolved = resolve_paths(preset, root=tmp_path)
    noms = {p.name for p in resolved}
    assert "lien.txt" not in noms
    assert "cible.txt" in noms


def test_resolve_paths_chemin_inexistant_retourne_liste_vide(
    tmp_path: Path,
) -> None:
    preset = JunkPreset(
        id="test-absent",
        label="Test absent",
        description="Chemin qui n'existe pas",
        paths=["pas-la/**", "nulle-part/fichier.txt"],
        safe=True,
    )

    # root pointe vers un tmp_path vide : rien ne doit remonter,
    # et surtout aucune exception.
    assert resolve_paths(preset, root=tmp_path) == []


# ---------------------------------------------------------------------------
# Sanity-check minimal sur le catalogue réel (compte attendu)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "preset_id",
    [
        "caches-user",
        "node-modules",
        "python-venv",
        "xcode-derived",
        "xcode-archives",
        "brew-cache",
        "downloads-old",
        "trash",
        "ds-store",
    ],
)
def test_catalogue_contient_les_presets_macos_attendus(preset_id: str) -> None:
    assert get_preset(preset_id) is not None
