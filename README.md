# helpmefreeit

Outil pour libérer de l'espace disque sur macOS : visualiser l'utilisation, détecter les doublons, trouver les fichiers anciens et volumineux, et nettoyer les caches connus. CLI Python + GUI Electron.

## Installation

```bash
pipx install .
# ou éditable (dev) :
poetry install
```

La commande est disponible sous deux noms : `freeit` et `helpmefreeit`.

## Sous-commandes

Quatre sous-commandes, toutes avec `--json` pour intégration externe (streaming NDJSON sur stdout).

### `freeit scan` — utilisation disque (comportement historique)

```bash
freeit .                     # scanner le dossier courant
freeit scan ~/Library -d 2   # profondeur 2
freeit scan . -n 10          # top 10
freeit scan . -a             # inclure les fichiers cachés
freeit scan . -f             # inclure les fichiers individuels
freeit scan . -m 100M        # taille minimum
freeit scan . --tree -d 3    # affichage en arbre
freeit scan / -x             # ne pas traverser les points de montage
```

> `freeit <chemin>` (sans sous-commande) est un alias rétro-compatible pour `freeit scan <chemin>`.

### `freeit dupes` — détection de doublons

Trois passes : groupement par taille → hash partiel xxh3 (4 Ko début + 4 Ko fin) → hash complet BLAKE2b. Un cache SQLite dans `~/Library/Caches/freeit/cache.db` évite de recalculer les hashs entre deux runs.

```bash
freeit dupes ~/Downloads           # tous les doublons
freeit dupes ~/ -m 10M             # doublons > 10 Mo seulement
freeit dupes . -n 5                # top 5 groupes (par octets récupérables)
freeit dupes . --no-cache          # désactiver le cache SQLite
freeit dupes ~/Downloads --json    # NDJSON (pour la GUI ou un script)
```

### `freeit stale` — fichiers anciens et volumineux

Filtre par `atime` (dernier accès) ET taille. Trié par ancienneté desc puis taille desc.

```bash
freeit stale ~/                    # défauts : atime > 90 j, size > 100 Mo
freeit stale ~/ --min-age 180      # non accédés depuis 180 jours
freeit stale ~/ -m 500M            # seuil taille 500 Mo
freeit stale ~/ --min-age 30 -m 50M --json
```

### `freeit clean` — inventaire des préréglages junk

Liste 9 catégories de fichiers "junk" macOS (caches, `node_modules`, `DerivedData`, corbeille, …) avec taille estimée. **Ne supprime rien côté CLI** — utiliser la GUI (confirmation + corbeille macOS native).

```bash
freeit clean                              # tous les presets
freeit clean --preset node-modules        # un preset ciblé
freeit clean --json                       # NDJSON
```

Presets disponibles : `caches-user`, `node-modules`, `python-venv`, `xcode-derived`, `xcode-archives`, `brew-cache`, `downloads-old` (> 90 j), `trash`, `ds-store`.

## GUI

Application Electron avec les 5 modes (scan table, scan treemap, doublons, anciens, nettoyage) accessibles via la toolbar. Les trois derniers délèguent au CLI Python via un sous-process qui streame du JSON.

```bash
cd freeit-gui
npm install
npm run dev        # dev server
npm run build      # build prod
```

Actions disponibles dans toutes les vues : voir dans Finder, copier le chemin, mettre à la corbeille (avec confirmation macOS native).

## Tests

```bash
# CLI Python (60 tests)
poetry run pytest helpmefreeit/tests/ -v

# GUI (14 tests)
cd freeit-gui && npx vitest run
```

## Dépendances

- Python ≥ 3.11 · `click`, `rich`, `xxhash`, `platformdirs`
- Node ≥ 18 · Electron 34, React 19, Vite 6, Vitest
