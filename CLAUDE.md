# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Structure du dépôt

Deux projets frères, indépendants, qui exposent la **même fonctionnalité** (scan d'utilisation disque) via deux surfaces différentes :

- `helpmefreeit/` — CLI Python (Click + Rich), commande `freeit` / `helpmefreeit`.
- `freeit-gui/` — Application desktop Electron + React 19 + Vite + Tailwind v4 + D3.

Les deux scanners font globalement le même travail et gèrent les mêmes edge cases, mais **ne partagent pas de code**. Une modification de comportement dans un des scanners doit généralement être répercutée dans l'autre.

## Commandes

### CLI Python (Poetry, Python ≥ 3.11)

```bash
# Installation locale
pipx install .
# ou en éditable :
poetry install

# Lancer
freeit .
python -m helpmefreeit .
```

Pas de suite de tests Python dans ce dépôt.

### GUI Electron (`freeit-gui/`)

```bash
cd freeit-gui
npm install
npm run dev              # dev server (electron-vite)
npm run build            # build prod dans ./out
npx vitest run           # tests unitaires (scanner.test.ts)
npx vitest run -t "nom"  # un test précis
```

## Architecture à connaître

### Les deux scanners s'appuient sur `du(1)`

Les deux implémentations (`helpmefreeit/scanner.py` et `freeit-gui/src/main/scanner.ts`) suivent le même pattern :

1. `scandir`/`readdir` listent l'entrée au niveau courant pour obtenir les tailles des fichiers instantanément via `stat`/`lstat`.
2. Pour chaque **dossier** enfant, un `du -sk` (Python) / `du -skH` (TS) est lancé en parallèle (pool de 8 à 12 workers) pour obtenir la taille récursive.
3. Les résultats sont ensuite agrégés dans un arbre d'`Entry` / `EntryNode`.

Conséquence : pas de traversée récursive en JS/Python ; la performance dépend de `du` et du parallélisme.

### Gestion des erreurs `du` — subtil, ne pas simplifier

`freeit-gui/src/main/scanner.ts::getDuSize` contient une logique de fallback spécifique :

- `du` peut retourner exit ≠ 0 mais avec un stdout utile (permission denied classiques) → on parse quand même.
- `du` peut échouer avec stdout **vide** sur des cycles de symlinks (typique `/Users` avec OrbStack) → on retente avec `-x` (ne pas traverser les points de montage).

Ces deux cas sont verrouillés par les tests « Test A / B / C » dans `scanner.test.ts`. Ne pas retirer le fallback sans comprendre pourquoi.

### Symlinks

Côté GUI : un symlink **vers un dossier** doit être traité comme un dossier (`isDir: true`) et sa taille calculée via `du`, pas via la taille du lien. Verrouillé par le test `scanner.test.ts` « symlink vers un dossier doit avoir une taille > 0 ».

### IPC Electron

- `src/main/index.ts` crée la BrowserWindow et enregistre les handlers via `src/main/ipc.ts`.
- Le scan tourne dans un **worker thread** (`scanner-worker.ts`) lancé par `ipc.ts`, pour ne pas bloquer le main process. Un nouveau scan tue le worker précédent.
- `src/preload/index.ts` expose l'API typée `window.freeit` via `contextBridge` (sandbox actif côté renderer, `contextIsolation: true`).
- Le renderer n'a **jamais** accès direct à `fs`/`child_process` — tout passe par les canaux IPC : `scan:*`, `fs:*`, `dialog:*`.

### Langue

**Code et UI sont en français** : commentaires, messages CLI (Click help), labels de boutons, titres de boîtes de dialogue, messages d'erreur utilisateur. Rester cohérent avec cette convention lors des modifications.

### Points d'entrée par composant

| Composant    | Fichier                              | Rôle                                          |
| ------------ | ------------------------------------ | --------------------------------------------- |
| CLI          | `helpmefreeit/cli.py::main`          | Click command, options, progress callback     |
| CLI scan     | `helpmefreeit/scanner.py`            | `du` parallèle (ThreadPoolExecutor, 12 workers) |
| CLI display  | `helpmefreeit/display.py`            | Rich Table / Tree, barres Unicode, seuils couleur |
| GUI main     | `freeit-gui/src/main/index.ts`       | BrowserWindow, menu, loadURL/loadFile         |
| GUI scan     | `freeit-gui/src/main/scanner.ts`     | Logique pure, testable — `runScan`, `getDuSize` |
| GUI worker   | `freeit-gui/src/main/scanner-worker.ts` | Wrapper worker_threads autour de `runScan` |
| GUI preload  | `freeit-gui/src/preload/index.ts`    | `contextBridge.exposeInMainWorld('freeit', ...)` |
| GUI renderer | `freeit-gui/src/renderer/App.tsx`    | État de navigation (`currentPath`, history), re-scan |

### Conventions

- Tailles manipulées en **octets** partout ; la conversion en K/M/G est faite uniquement à l'affichage (`format_size` Python / `formatSize` TS).
- L'option « ne pas traverser les points de montage » correspond au flag `-x` de `du` (nommé `--one-file-system` côté CLI, `noCrossDevice` côté GUI).
- Dot-files : la taille est **toujours comptée** dans le total du parent, mais l'affichage dépend du flag `includeHidden`.
