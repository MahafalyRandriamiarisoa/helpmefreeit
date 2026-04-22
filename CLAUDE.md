# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure du dépôt

Deux projets frères :

- `helpmefreeit/` — CLI Python (Click + Rich). Commande `freeit` (alias `helpmefreeit`) avec 4 sous-commandes : `scan`, `dupes`, `stale`, `clean`.
- `freeit-gui/` — Application desktop Electron + React 19 + Vite + Tailwind v4 + D3.

**Relation entre les deux** — asymétrique :
- Le **scanner historique** (`scan`) est **dupliqué** : `helpmefreeit/scanner.py` et `freeit-gui/src/main/scanner.ts`, tous deux basés sur `du(1)` parallèle. Une modification de comportement du scanner doit souvent être répercutée dans les deux.
- Les **nouvelles features** (`dupes`, `stale`, `clean`) sont **uniquement en Python**. La GUI les invoque via un **sous-process** qui streame du JSON sur stdout (voir section *Délégation CLI → GUI*). Le code TS de ces features est donc minimal : IPC + vues React.

## Commandes

### CLI Python (Poetry, Python ≥ 3.11)

```bash
# Installation
pipx install .
# ou éditable pour développer :
poetry install

# Exemples
freeit .                              # rétro-compat, équivalent à `freeit scan .`
freeit scan ~/Library -n 10           # top 10 des éléments volumineux
freeit dupes ~/Downloads -m 10M       # doublons > 10 Mo, cache SQLite auto
freeit stale ~/ --min-age 180         # fichiers non accédés depuis 180 j
freeit clean                          # inventaire des 9 presets junk
freeit clean --preset node-modules    # un preset ciblé
freeit dupes ~/Downloads --json       # NDJSON streaming pour la GUI

# Tests (60 cas pytest)
poetry run pytest helpmefreeit/tests/ -v
poetry run pytest helpmefreeit/tests/test_dupes.py -v       # un fichier
poetry run pytest -k "test_invalidation"                    # un pattern
```

### GUI Electron (`freeit-gui/`)

```bash
cd freeit-gui
npm install
npm run dev              # dev server (electron-vite)
npm run build            # build prod dans ../out/
npx vitest run           # 14 tests (scanner + subprocess)
npx vitest run -t "nom"  # un test précis
npx tsc --noEmit -p tsconfig.web.json   # type-check renderer
npx tsc --noEmit -p tsconfig.node.json  # type-check main/preload
```

## Architecture à connaître

### Scanner historique — `du(1)` parallèle

Les deux implémentations (`helpmefreeit/scanner.py` et `freeit-gui/src/main/scanner.ts`) suivent le même pattern :

1. `scandir`/`readdir` listent l'entrée au niveau courant — tailles fichiers via `stat`/`lstat`.
2. Pour chaque **dossier** enfant, un `du -sk` (Python) / `du -skH` (TS) est lancé en parallèle (pool de 8 à 12 workers).
3. Résultats agrégés dans un arbre d'`Entry` / `EntryNode`.

Performance = dépend de `du` + parallélisme, pas de traversée récursive en JS/Python.

### Délégation CLI → GUI (features post-swarm)

Pour `dupes` / `stale` / `clean`, la GUI **ne réimplémente pas** la logique — elle l'appelle :

- `freeit-gui/src/main/subprocess.ts::spawnFreeit(args, ctx)` : spawn `freeit <cmd> --json`, parse stdout ligne-par-ligne comme JSON, pousse chaque message à `ctx.onMessage`.
- Résolution du binaire : `which freeit` → `~/.local/bin/freeit` → `/opt/homebrew/bin/freeit` → fallback `python3 -m helpmefreeit`. Cache module-level.
- Annulation : `AbortSignal` → `proc.kill('SIGTERM')` puis `SIGKILL` après 2 s.
- `freeit-gui/src/main/ipc.ts` expose 6 handlers : `dupes:start`/`:cancel`, `stale:start`/`:cancel`, `clean:start`/`:cancel`. Chaque `:start` tue le précédent via `AbortController`.
- Format NDJSON produit par `helpmefreeit/cli.py::_emit_json` :
  - Progress : `{"type":"progress", ...}` (champs variables selon la commande).
  - Résultat final : `{"type":"result", "data": ...}`.
  - Erreur : `{"type":"error", "message": "..."}`.
- Le flag `--json` désactive l'affichage Rich et redirige les progress vers stdout en NDJSON.

**Ne pas confondre les deux patterns** : `scan` utilise un worker thread Node (`scanner-worker.ts`), les trois autres utilisent `subprocess.ts`. Une future unification passerait par faire aussi déléguer `scan` au CLI Python, mais c'est hors scope actuel.

### Détection de doublons en 3 passes

`helpmefreeit/dupes.py::find_duplicates` :

1. **Scan + group par taille** — via `os.walk`, on skippe symlinks et fichiers non réguliers.
2. **Hash partiel** (`hashing.partial_hash`) — xxh3_64 de 4 KB début + 4 KB fin → 8 octets. Dépendance `xxhash`.
3. **Hash complet** (`hashing.full_hash`) — BLAKE2b streaming, digest 32 octets. Utilisé seulement sur les survivants de la passe 2.

`helpmefreeit/cache.py::Cache` (SQLite via `platformdirs.user_cache_dir('freeit')/cache.db`) évite de recalculer les hashs entre runs — invalidation si `size` ou `mtime` change. Thread-safe via `threading.Lock`, `check_same_thread=False`. Peut se passer (`find_duplicates(..., cache=None)`).

Parallélisme passes 2 et 3 : `ThreadPoolExecutor(max_workers=8)`, I/O-bound, GIL relâché.

### Fichiers anciens et volumineux

`helpmefreeit/stale.py::find_stale_files` : parcours `os.walk`, filtre par `st_atime` (ancienneté en jours) ET `st_size`. Tri par `age_days` desc puis `size` desc. Robuste aux erreurs `stat` (log debug, skip).

### Junk cleaner (presets)

`helpmefreeit/presets.py::PRESETS` : liste hardcodée de 9 presets macOS (`caches-user`, `node-modules`, `python-venv`, `xcode-derived`, `xcode-archives`, `brew-cache`, `downloads-old` (min_age_days=90), `trash`, `ds-store`). Chaque `JunkPreset` a `paths: list[str]` (globs avec `~` et `**`), `safe: bool`, optionnel `min_age_days`.

`resolve_paths(preset)` expanse `~`, glob récursivement depuis `Path.home()` (par défaut), ignore les symlinks, filtre par âge si `min_age_days` défini. Ne lève jamais sur chemin inexistant.

**Le CLI ne supprime rien** — `freeit clean` est dry-run : il liste les chemins et tailles. La suppression se fait **exclusivement via la GUI** (bouton « Mettre à la corbeille » dans `CleanView.tsx`), qui utilise `shell.trashItem` d'Electron (confirmation macOS native).

### Gestion des erreurs `du` — subtil, ne pas simplifier

`freeit-gui/src/main/scanner.ts::getDuSize` contient une logique de fallback :

- `du` peut retourner exit ≠ 0 avec stdout utile (permission denied classiques) → on parse quand même.
- `du` peut échouer avec stdout **vide** sur des cycles de symlinks (typique `/Users` avec OrbStack) → on retente avec `-x`.

Verrouillé par les tests « Test A / B / C » de `scanner.test.ts`. Ne pas retirer le fallback.

### Symlinks

Côté scanner GUI : un symlink **vers un dossier** est traité comme un dossier (`isDir: true`), taille via `du`. Verrouillé par `scanner.test.ts`.
Côté `dupes`, `stale`, `presets` : les symlinks sont **toujours ignorés** (pas de risque de double-comptage ou de loop).

### IPC Electron

- `src/main/index.ts` crée la BrowserWindow, enregistre les handlers via `src/main/ipc.ts`.
- **Canaux disponibles** :
  - `scan:*` — worker thread (`scanner-worker.ts`) pour le scanner historique. Nouveau scan tue le précédent.
  - `dupes:*` / `stale:*` / `clean:*` — subprocess Python via `subprocess.ts`, abort via `AbortController`.
  - `fs:showInFinder` / `fs:copyPath` / `fs:openTerminal` / `fs:trashItem` — actions simples (file manager, clipboard, corbeille macOS native).
  - `dialog:openDirectory` — picker natif.
- `src/preload/index.ts` expose `window.freeit` via `contextBridge` (sandbox actif, `contextIsolation: true`).
- Le renderer n'a **jamais** accès direct à `fs` / `child_process`.

### Vues renderer

- **Scan** : `Explorer.tsx` (table) ou `Treemap.tsx` (D3 hierarchy + squarify), les deux pilotés par `useScanner.ts`.
- **Dupes** : `DupesView.tsx` + `useDupes.ts` → cartes par groupe, boutons Finder/Trash par chemin.
- **Stale** : `StaleView.tsx` + `useStale.ts` → tableau trié, context menu interne minimal.
- **Clean** : `CleanView.tsx` + `useClean.ts` → cartes par preset avec case à cocher, dialog de confirmation inline, `trashAll` en série.
- `App.tsx` gère le viewMode (`'table' | 'treemap' | 'dupes' | 'stale' | 'clean'`). `Toolbar.tsx` expose les 5 boutons.

### Langue

**Code et UI sont en français** : commentaires, messages CLI (Click help), docstrings, labels de boutons, dialogues, erreurs utilisateur. Rester cohérent lors des modifications.

### Points d'entrée par composant

| Composant | Fichier | Rôle |
|-----------|---------|------|
| CLI entry | `helpmefreeit/cli.py::main` | Groupe Click (4 sous-commandes) + wrapper rétro-compat |
| CLI scan | `helpmefreeit/scanner.py` | `du` parallèle, ThreadPoolExecutor(12) |
| CLI dupes | `helpmefreeit/dupes.py` | 3 passes (size → xxh3 → BLAKE2b), cache optionnel |
| CLI stale | `helpmefreeit/stale.py` | `os.walk` + filtre atime/size |
| CLI clean | `helpmefreeit/presets.py` | Catalogue + `resolve_paths` |
| CLI cache | `helpmefreeit/cache.py` | SQLite thread-safe, invalidation mtime/size |
| CLI hash | `helpmefreeit/hashing.py` | `partial_hash` (xxh3, 8 o) + `full_hash` (BLAKE2b, 32 o) |
| CLI display | `helpmefreeit/display.py` | Rich tables/trees pour les 4 sous-commandes |
| GUI main | `freeit-gui/src/main/index.ts` | BrowserWindow, menu |
| GUI scan | `freeit-gui/src/main/scanner.ts` | `du` parallèle TS, fallback OrbStack |
| GUI worker | `freeit-gui/src/main/scanner-worker.ts` | Worker thread pour scan |
| GUI subprocess | `freeit-gui/src/main/subprocess.ts` | Spawn `freeit --json`, streaming NDJSON |
| GUI IPC | `freeit-gui/src/main/ipc.ts` | Handlers scan/dupes/stale/clean/fs/dialog |
| GUI types | `freeit-gui/src/main/types.ts` | Interfaces partagées main/preload |
| GUI preload | `freeit-gui/src/preload/index.ts` | `window.freeit.*` via contextBridge |
| GUI App | `freeit-gui/src/renderer/App.tsx` | viewMode, navigation (history/home/refresh) |
| GUI vues | `freeit-gui/src/renderer/components/{Explorer,Treemap,DupesView,StaleView,CleanView}.tsx` | Une par mode |
| GUI hooks | `freeit-gui/src/renderer/hooks/{useScanner,useDupes,useStale,useClean}.ts` | Gère subscribe/unsub IPC + state |

### Conventions

- Tailles manipulées en **octets** partout ; conversion K/M/G uniquement à l'affichage (`format_size` Python / `formatSize` TS).
- `--one-file-system` (CLI) ↔ `noCrossDevice` (GUI) ↔ `du -x`.
- Dot-files : toujours comptés dans le total parent ; affichés selon `includeHidden`.
- Cache SQLite : `~/Library/Caches/freeit/cache.db` (via `platformdirs.user_cache_dir('freeit')`).
- Hash : `partial_hash` = 8 octets (xxh3_64), `full_hash` = 32 octets (blake2b digest_size=32).
- Deps Python obligatoires : `click`, `rich`, `xxhash`, `platformdirs`. Dev : `pytest`.
- Deps GUI obligatoires : `react@19`, `d3-hierarchy`, `lucide-react`, `electron@34`, `vitest`.
