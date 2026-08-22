# Visionneuse CAO en réalité mixte — v1.0.0

Application WebXR pour Meta Quest 3 : pose n'importe quel modèle 3D (issu
d'une modélisation 3DEXPERIENCE) sur une vraie table, manipule-le à main
levée ou précisément, et colore ses pièces.

## Lancer l'application

> ⚠️ Ce projet utilise le **port 8080**, comme VR CEC et VR Statique. Ne
> lance qu'une application à la fois. Si une autre tourne encore, le
> script te le dira et s'arrêtera au lieu de servir le mauvais projet.

1. Double-clique sur **`serveur.bat`**.
2. Une adresse `https://xxxxx.trycloudflare.com` s'affiche.
3. Tape cette adresse dans Wolvic sur le Quest 3 (ou ouvre directement
   l'adresse GitHub Pages une fois le projet publié en ligne).
4. Choisis un modèle dans la liste, puis appuie sur « Entrer en réalité
   mixte ».

## Utilisation dans le casque

| Action | Commande |
|---|---|
| Poser le modèle sur la table | Vise la table, appuie sur la **gâchette** |
| Attraper le modèle à main levée (onglet MAIN LIBRE) | Approche la manette du modèle, maintiens le **grip** (gâchette latérale), bouge la main, relâche |
| Translater / tourner précisément (onglet PRÉCISION) | Vise une flèche ou un anneau coloré avec le rayon, maintiens la **gâchette**, bouge la main, relâche |
| Déplacer le centre de rotation (onglet PRÉCISION) | Vise un point du modèle (hors flèche/anneau), **gâchette** |
| Colorer une pièce (onglet COULEUR) | Choisis une couleur dans la palette, puis vise la pièce et appuie sur la **gâchette** |
| Colorer toutes les pièces automatiquement | Bouton « COLORIER AUTO » |
| Appuyer sur un bouton du panneau | Vise le bouton avec le rayon, **gâchette** |

Le placement essaie la détection réelle de surface (hit-test) ; si le
navigateur ne la supporte pas (cas de Wolvic aujourd'hui), le modèle suit
simplement la manette droite jusqu'au clic — sans rien à changer si un futur
navigateur ajoute le support.

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

## Publier en ligne (GitHub Pages)

Comme pour les autres projets, l'hébergement définitif se fait sur
**GitHub Pages** : une adresse fixe, mise à jour par un simple
`git push`, sans avoir besoin d'allumer le PC ni de lancer `serveur.bat`
à chaque fois. Demande à Claude de configurer ça quand tu es prêt·e à
publier.

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
