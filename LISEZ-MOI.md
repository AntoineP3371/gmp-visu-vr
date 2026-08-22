# Visionneuse CAO en réalité mixte — v1.7.0

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

Le menu plat a été remplacé par un **disque attaché à la main gauche**
(déplaçable sur l'autre main par un clic de joystick). On le pointe avec le
rayon de l'AUTRE manette et on valide à la **gâchette** ; le centre du
disque sert de bouton RETOUR pour remonter d'un niveau. **Le menu ne revient
JAMAIS en arrière tout seul après une action** : il faut toujours appuyer
sur « < RETOUR » (le centre du disque) pour remonter, à chaque niveau.

**Arborescence du menu :**
- **Couleurs** → Automatique / Manuel (ouvre directement la palette) / RAZ
- **Déplacements** → Libre / Précis (Translation / Rotation) / RAZ générale
- **Mesures** → ouvre la liste des mesures déjà prises (pour les rappeler)
- **Annuler / Refaire / Quitter / Remettre sur la table**
- **Capture d'affichage** → Cadre (prendre une photo) / Fond (Réalité
  virtuelle ou Réalité augmentée)

| Action | Commande |
|---|---|
| Poser le modèle sur la table | Vise la table, appuie sur la **gâchette** |
| Attraper **la cible courante** à main levée (tout le modèle, ou la sélection si une pièce/un groupe est choisi) | **Grip** seul (sans rien tenir d'autre), bouge la main, relâche - marche quel que soit le menu ouvert |
| **Choisir une ou plusieurs pièces** à déplacer indépendamment | Maintiens le bouton **A** (ou X), et pendant que tu le tiens, vise chaque pièce avec la **gâchette** pour la (dé)sélectionner (1 pièce = suffisant, plusieurs = un groupe) |
| Déplacer la sélection à main levée ou précisément | Relâche A si besoin : **la sélection reste active**, grip ou gizmo agissent dessus normalement |
| Régler la transparence de la sélection | **A tenu**, pousse le **joystick** haut/bas |
| **Régler la transparence d'une pièce visée**, sans la sélectionner d'abord | Vise-la au laser (**gâchette tenue**), pousse le **joystick** haut/bas |
| **Revenir à « tout le modèle »** | Bouton **« Libre »** (menu Déplacements) - désélectionne et repasse en déplacement libre |
| **Zoomer** (avant/arrière, sur tout le modèle) | Maintiens le **grip des 2 manettes en même temps** - le % s'affiche en direct entre les 2 mains, et « s'aimante » sur 50/75/100/125/150/200% |
| **Montrer/pointer quelque chose** | Maintiens la **gâchette appuyée** : un laser rouge s'arrête sur la pièce visée |
| Translater / tourner précisément (menu Déplacements > Précis) | Vise une flèche ou un anneau, maintiens la **gâchette**, bouge la main, relâche - la valeur (m / degrés) reste affichée en permanence dans sa case (fonctionne aussi sur un groupe de pièces sélectionné) |
| Remettre UN axe à zéro | Vise le petit bouton rouge **« RAZ »** (superposé, en léger premier plan, sur le coin de la case de valeur), **gâchette** |
| **RAZ générale** (menu Déplacements) | Remet le modèle ENTIER à sa position d'origine, **y compris les pièces déjà déplacées individuellement ou en groupe** |
| Déplacer le centre de rotation | Vise un point du modèle (hors flèche/anneau), **gâchette** |
| Colorer une pièce (menu Couleurs > Manuel) | Choisis une couleur dans la palette (roue, affichée directement), puis vise la pièce et appuie sur la **gâchette** |
| **Mesurer une distance** (menu Mesures) | Vise un 1er point puis un 2e avec la **gâchette** : ligne + distance réelle en mm affichées (indépendant du zoom en cours) - chaque mesure est gardée dans l'historique et **suit le modèle** (et chaque pièce déplacée indépendamment) si tu le bouges ensuite |
| **Revoir une mesure déjà prise** | Menu Mesures : la liste affiche toutes les mesures (une seule à l'écran à la fois), clique sur une entrée pour la rappeler |
| **Effacer une mesure** | Vise la petite croix rouge en haut à droite de sa case, **gâchette** - la retire de l'historique |
| **Prendre une photo** (menu Capture > Cadre) | Le prochain appui sur la **gâchette** (n'importe laquelle) capture et affiche un aperçu flottant ; reclic dessus pour le fermer |
| **Annuler / Refaire** | Menu Actions, **ou** pousse le **joystick à gauche/droite** (n'importe quelle manette) |

L'application s'ouvre toujours **modèle entier** sélectionné, pas de menu
« mode » à choisir en premier : le grip agit toujours, la gâchette suit
simplement le dernier choix fait dans le menu (précision, couleur, mesure).
Le menu affiche aussi le **% d'échelle réelle** dans Déplacements.

> ⚠️ **Changement important (v1.6.0)** : une sélection de pièce(s) ne
> disparaît plus automatiquement quand on relâche le bouton A - c'est
> nécessaire pour pouvoir ensuite la déplacer précisément au gizmo (relâcher
> A pour utiliser la gâchette du gizmo effaçait la sélection avant, rendant
> le déplacement précis d'un groupe impossible). Utilise le bouton
> **« Libre »** du menu Déplacements pour revenir explicitement à « tout le
> modèle ».

> ⚠️ **Limite technique (photo)** : WebXR ne donne pas accès aux pixels du
> passthrough à une page web (sécurité/vie privée), donc « Réalité
> augmentée » utilise un fond transparent en secours, pas la vraie caméra du
> casque - déjà rencontré sur VR CEC, ce n'est pas un bug de cette appli.

Le placement essaie la détection réelle de surface (hit-test) ; si le
navigateur ne la supporte pas (cas de Wolvic aujourd'hui), le modèle suit
simplement la manette droite jusqu'au clic — sans rien à changer si un futur
navigateur ajoute le support.

## Utilisation sur ordinateur, sans casque (mode souris)

Sur l'écran d'accueil, bouton **« Voir sur cet écran (souris) »** : même
modèle, mêmes outils (main libre, précision, couleur, mesures, capture,
annuler/refaire), pilotés à la souris - pratique pour préparer une visite
sans avoir le Quest sous la main.

| Action | Commande souris |
|---|---|
| Orbiter la vue | Glisser (clic gauche) |
| Zoomer la vue (caméra) | Molette |
| Choisir une/des pièce(s) | **Maj + clic** sur une pièce (reclic = désélectionne) |
| Déplacer la cible / utiliser le gizmo / peindre / mesurer | **Ctrl + glisser** ou **Ctrl + clic** (selon l'onglet actif) |
| Tout le reste (onglets MAIN LIBRE/PRÉCISION/COULEUR/MESURES/CAPTURE, RAZ, RAZ GÉNÉRALE, palette, annuler/refaire, % d'échelle, fond de capture) | Barre d'outils en haut de l'écran |

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
