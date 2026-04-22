# helpmefreeit

Outil CLI pour visualiser l'utilisation disque et identifier les fichiers/dossiers volumineux.

## Installation

```bash
pipx install .
```

## Utilisation

```bash
# Scanner le dossier courant
freeit .

# Scanner un dossier spécifique avec profondeur 2
freeit /Users/me/Library -d 2

# Afficher uniquement le top 10
freeit ~/Library -n 10

# Inclure les fichiers cachés
freeit . -a

# Afficher aussi les fichiers (pas seulement les dossiers)
freeit . -f

# Filtrer par taille minimum (ex: 100MB)
freeit . -m 100M

# Mode arbre
freeit . --tree -d 3

# Ne pas traverser les points de montage
freeit / -x
```

## Alias

La commande est disponible sous deux noms : `helpmefreeit` et `freeit`.
