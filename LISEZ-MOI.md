# Visionneuse CAO en réalité mixte — v1.4.0

Application WebXR pour Meta Quest 3 : pose n'importe quel modèle 3D (issu
d'une modélisation 3DEXPERIENCE) sur une vraie table, manipule-le à main
levée ou précisément, et colore ses pièces.

**Adresse fixe (à taper dans Wolvic) : https://gmpbordeaux.fr/gmp-visu-vr/**

## Lancer l'application

**En ligne (recommandé)** : ouvre directement
`https://gmpbordeaux.fr/gmp-visu-vr/` dans Wolvic sur le Quest 3. Rien à
allumer sur le PC.

**En local (pour tester une modification avant de la publier)** :

> ⚠️ Ce projet utilise le **port 8080**, comme VR CEC et VR Statique. Ne
> lance qu'une application à la fois. Si une autre tourne encore, le
> script te le dira et s'arrêtera au lieu de servir le mauvais projet.

1. Double-clique sur **`serveur.bat`**.
2. Une adresse `https://xxxxx.trycloudflare.com` s'affiche.
3. Tape cette adresse dans Wolvic sur le Quest 3.
4. Choisis un modèle dans la liste, puis appuie sur « Entrer en réalité
   mixte ».

## Utilisation dans le casque

| Action | Commande |
|---|---|
| Poser le modèle sur la table | Vise la table, appuie sur la **gâchette** |
| Attraper **tout le modèle** à main levée | **Grip** seul (sans rien tenir d'autre), bouge la main, relâche |
| **Choisir une ou plusieurs pièces** à déplacer indépendamment | Maintiens le bouton **A** (ou X), et pendant que tu le tiens, vise chaque pièce avec la **gâchette** pour la (dé)sélectionner (1 pièce = suffisant, plusieurs = un groupe) |
| Déplacer la sélection | Toujours **A tenu**, appuie en plus sur le **grip** et bouge la main |
| Régler la transparence de la sélection | Toujours **A tenu**, pousse le **joystick** (utile pour voir à travers pendant que tu choisis) |
| Désélectionner | **Relâche le bouton A** — retour automatique à « tout le modèle » |
| **Zoomer** (avant/arrière, sur tout le modèle) | Maintiens le **grip des 2 manettes en même temps**, écarte ou rapproche les mains - le % s'affiche en direct entre les 2 mains, et « s'aimante » sur 50/75/100/125/150/200% |
| **Montrer/pointer quelque chose** | Maintiens la **gâchette appuyée** : un laser rouge apparaît et s'arrête sur la pièce visée |
| Translater / tourner précisément (onglet PRÉCISION) | Vise une flèche ou un anneau coloré avec le rayon, maintiens la **gâchette**, bouge la main, relâche - la valeur (mètres/degrés) s'affiche en direct à la place du « 0 » |
| Remettre UN axe à zéro (onglet PRÉCISION) | Vise le petit rond « 0 » à côté de la flèche/l'anneau de cet axe, **gâchette** |
| Remettre TOUTE la position/rotation à zéro (onglet PRÉCISION) | Bouton « TOUT REMETTRE À ZÉRO » (ou « 0 POSITION » / « 0 ROTATION » séparément) |
| Déplacer le centre de rotation (onglet PRÉCISION) | Vise un point du modèle (hors flèche/anneau), **gâchette** |
| Colorer une pièce (onglet COULEUR) | Choisis une couleur dans la palette, puis vise la pièce et appuie sur la **gâchette** |
| Colorer toutes les pièces automatiquement | Bouton « COLORIER AUTO » |
| **Annuler / Refaire** | Boutons « ANNULER » / « REFAIRE » du panneau (déplacements, rotations, zoom, couleurs) |
| Appuyer sur un bouton du panneau | Vise le bouton avec le rayon, **gâchette** |

L'application s'ouvre toujours en mode **MAIN LIBRE**, cible **modèle entier**.
Le panneau affiche aussi le **% d'échelle par rapport à la taille réelle** de l'objet (onglet PRÉCISION), pour savoir si tu regardes le modèle en vrai grandeur ou zoomé/dézoomé.

Le placement essaie la détection réelle de surface (hit-test) ; si le
navigateur ne la supporte pas (cas de Wolvic aujourd'hui), le modèle suit
simplement la manette droite jusqu'au clic — sans rien à changer si un futur
navigateur ajoute le support.

## Utilisation sur ordinateur, sans casque (mode souris)

Sur l'écran d'accueil, bouton **« Voir sur cet écran (souris) »** : même
modèle, mêmes outils (main libre, précision, couleur, annuler/refaire,
échelle), pilotés à la souris - pratique pour préparer une visite sans
avoir le Quest sous la main.

| Action | Commande souris |
|---|---|
| Orbiter la vue | Glisser (clic gauche) |
| Zoomer la vue (caméra) | Molette |
| Choisir une/des pièce(s) | **Maj + clic** sur une pièce (reclic = désélectionne) |
| Déplacer la cible / utiliser le gizmo / peindre | **Ctrl + glisser** (sur le modèle, une flèche/anneau, ou une pièce selon l'onglet actif) |
| Tout le reste (onglets, RAZ, palette, annuler/refaire, % d'échelle) | Barre d'outils en haut de l'écran |

## Ajouter un modèle depuis 3DEXPERIENCE

3DEXPERIENCE n'exporte pas directement en `.glb` (le format utilisé ici).
Il faut passer par un export STEP puis une conversion sur PC, avec un
logiciel gratuit : **FreeCAD**.

1. Dans 3DEXPERIENCE, exporte la pièce/l'assemblage en **STEP** (`.step`
   ou `.stp`).
2. Installe [FreeCAD](https://www.freecad.org/) (gratuit) si ce n'est pas
   déjà fait.
3. Ouvre FreeCAD → **Fichier > Ouvrir** → sélectionne ton fichier `.step`.
4. Sélectionne l'objet dans l'arbre (à gauche) → **Fichier > Exporter**
   → choisis le type **glTF (\*.gltf, \*.glb)** → enregistre en `.glb`
   dans ce dossier (`Visionneuse CAO`).
5. Ouvre **`modeles.json`** avec le Bloc-notes, et ajoute une ligne pour
   ton modèle (attention à la virgule entre les lignes) :
   ```json
   [
     { "nom": "Exemple - cric (test)", "fichier": "exemple-cric.glb" },
     { "nom": "Mon nouveau modèle", "fichier": "mon-modele.glb" }
   ]
   ```
6. Relance `serveur.bat` (ou republie sur GitHub Pages) : le modèle
   apparaît dans la liste déroulante de l'écran d'accueil.

> Si le modèle apparaît tout noir ou aux mauvaises couleurs dans le
> casque, c'est normal : les exports STEP n'ont pas toujours de couleurs
> par pièce. Utilise l'onglet COULEUR (manuel ou « COLORIER AUTO ») pour
> distinguer les pièces une fois dans le casque.

## Publier une mise à jour en ligne (GitHub Pages)

Le projet est hébergé sur **GitHub Pages**, adresse fixe
`https://gmpbordeaux.fr/gmp-visu-vr/` :
- Dépôt : https://github.com/AntoineP3371/gmp-visu-vr (public), branche `main`
- Pour mettre à jour le site après avoir modifié un fichier :
  `git add -A && git commit -m "..." && git push`, puis attendre ~1 minute.
- Pense à changer le `?v=X.Y.Z` dans `index.html` (script `app.js`) à
  chaque nouvelle version, sinon Wolvic garde l'ancienne version en cache
  jusqu'à 10 minutes.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Écran d'accueil (choix du modèle, bouton d'entrée en AR) |
| `app.js` | Toute l'application (placement, manipulation, coloration) |
| `modeles.json` | **Liste des modèles disponibles — le seul fichier à modifier pour en ajouter un** |
| `exemple-cric.glb` | Modèle de démonstration fourni avec le projet |
| `three.min.js` / `GLTFLoader.js` | Bibliothèque 3D (vendored, ne pas modifier) |
| `server.js` / `serveur.bat` | Serveur local + tunnel HTTPS (pour tester avec le casque) |

## Limites connues de la v1

- Un seul modèle manipulé à la fois (pas de scène à plusieurs objets).
- Pas d'import de fichier directement dans l'appli : chaque nouveau
  modèle s'ajoute en copiant le `.glb` dans le dossier + une ligne dans
  `modeles.json`.
- Les mouvements internes du mécanisme et les interactions entre pièces
  (deuxième temps du projet) ne sont pas encore implémentés.
