# Visionneuse CAO en réalité mixte — v1.10.0

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

**Le rayon (laser) des manettes est maintenant TOUJOURS visible** (plus
seulement gâchette tenue), et **ce qui est visé se met en surbrillance** :
un bouton du disque prend un anneau blanc, une pièce se teinte en bleu, un
bouton RAZ ou une flèche/anneau du gizmo grossit légèrement - dans tous les
cas, tu sais ce que tu es sur le point de cliquer AVANT d'appuyer sur la
gâchette.

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
| Régler la transparence de la sélection (opaque → transparent → fantôme) | **A tenu**, pousse le **joystick** haut/bas - progression fine et lente au début, jusqu'à quasi invisible en fin de course |
| **Régler la transparence d'une pièce visée**, sans la sélectionner d'abord | Vise-la au laser (**gâchette tenue**), pousse le **joystick** haut/bas |
| **Revenir à « tout le modèle »** | Bouton **« Libre »** (menu Déplacements) - désélectionne et repasse en déplacement libre |
| **Zoomer** (avant/arrière, sur tout le modèle) | Maintiens le **grip des 2 manettes en même temps** - le % s'affiche en direct entre les 2 mains, et « s'aimante » sur 50/75/100/125/150/200% |
| **Montrer/pointer quelque chose** | Maintiens la **gâchette appuyée** : un laser rouge s'arrête sur la pièce visée |
| Translater / tourner précisément (menu Déplacements > Précis) | Vise une flèche ou un anneau, maintiens la **gâchette**, bouge la main, relâche - la valeur (m / degrés) reste affichée en permanence dans sa case, **du même code couleur que l'axe** (fonctionne aussi sur un groupe de pièces sélectionné) |
| Remettre UN axe à zéro | Vise le petit bouton rouge **« RAZ »** (superposé, en léger premier plan, sur le coin de la case de valeur), **gâchette** |
| **RAZ générale** (menu Déplacements) | Remet le modèle ENTIER à sa position d'origine, **y compris les pièces déjà déplacées individuellement ou en groupe** |
| Déplacer le centre de rotation | Vise un point du modèle (hors flèche/anneau), **gâchette** |
| Colorer une pièce (menu Couleurs > Manuel) | Choisis une couleur dans la palette (roue, affichée directement), puis vise la pièce et appuie sur la **gâchette** |
| **Mesurer une distance** (menu Mesures) | Vise un 1er point puis un 2e avec la **gâchette** : ligne + distance réelle en mm affichées (indépendant du zoom en cours) - chaque mesure est gardée dans l'historique et **suit le modèle** (et chaque pièce déplacée indépendamment) si tu le bouges ensuite |
| **Revoir une mesure déjà prise** | Menu Mesures : la liste affiche toutes les mesures (une seule à l'écran à la fois), clique sur une entrée pour la rappeler |
| **Effacer une mesure** | Vise la petite croix rouge en haut à droite de sa case, **gâchette** - la retire de l'historique |
| **Prendre une photo** (menu Capture > Cadre) | Oriente la pièce face à toi, choisis Cadre : un cadre jaune apparaît (aperçu de ce qui sera capturé). Le prochain appui sur la **gâchette** (n'importe laquelle) déclenche un **flash blanc** puis affiche un aperçu flottant ; reclic dessus pour le fermer. Si Google Drive est configuré (voir plus bas), la photo est aussi **envoyée automatiquement** dans le dossier Drive dédié |
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

## Modèles et photos via Google Drive (optionnel, recommandé)

Depuis la v1.10.0, il existe une **deuxième façon** d'ajouter un modèle,
plus simple que `modeles.json` : le déposer dans un dossier Google Drive
partagé. Il apparaît automatiquement dans la liste au prochain
rechargement de la page, marqué « (Drive) ». Les deux méthodes
cohabitent : les modèles de `modeles.json` restent toujours disponibles.

La prise de photo peut, de la même façon, être automatiquement enregistrée
dans un dossier Drive (en plus de l'aperçu flottant dans le casque).

C'est **optionnel** : tant que `drive-config.js` n'est pas rempli, tout le
reste de l'application fonctionne exactement comme avant, sans rien
demander à personne (pas d'erreur, pas de blocage).

**Pourquoi 2 réglages différents (une clé API + un script) ?** Lire un
dossier Drive et écrire dedans (une photo) ne demandent pas la même chose
niveau sécurité :
- **Lire** peut se faire avec une simple clé, restreinte au strict
  nécessaire (lecture seule, uniquement sur ce site).
- **Écrire** demanderait normalement de se connecter avec un compte
  Google — impossible à faire depuis le casque en pleine session (une
  fenêtre de connexion **casserait la session VR**). On contourne ça avec
  un petit script qui tourne sous TON compte Google et reçoit juste les
  photos, sans jamais demander de connexion au casque.

### A. Faire apparaître des modèles depuis un dossier Drive

1. Va sur **[console.cloud.google.com](https://console.cloud.google.com/)**
   et connecte-toi avec le compte Google qui possède le dossier de
   modèles.
2. En haut de la page, choisis un projet existant ou clique sur
   « Nouveau projet » (donne-lui un nom, par exemple `gmp-visu-vr`).
3. Menu **☰ > APIs et services > Bibliothèque**. Cherche
   **« Google Drive API »**, ouvre-la, clique sur **Activer**.
4. Menu **☰ > APIs et services > Identifiants**. Clique sur
   **« + Créer des identifiants »** → **« Clé API »**. Une longue chaîne
   apparaît (commence par `AIza...`) : copie-la de côté.
5. Clique sur **« Restreindre la clé »** (fortement recommandé) :
   - *Restrictions relatives aux applications* → **Référents HTTP (sites
     web)** → ajoute `https://gmpbordeaux.fr/*`
   - *Restrictions relatives aux API* → **Restreindre la clé** → coche
     uniquement **Google Drive API**
   - **Enregistrer**.
6. Dans Google Drive, crée (ou choisis) le dossier qui contiendra les
   `.glb`. Clic droit dessus → **Partager** → change l'accès général en
   **« Toute personne disposant du lien »**, rôle **Lecteur**.
7. Copie le lien de partage. L'ID du dossier est la partie après
   `/folders/` dans ce lien
   (`https://drive.google.com/drive/folders/`**`CETTE_PARTIE_LA`**`?...`).
8. Ouvre **`drive-config.js`** avec le Bloc-notes, remplace :
   - `apiKey` par la clé copiée à l'étape 4
   - `folderId` par l'ID copié à l'étape 7
9. Republie sur GitHub Pages (voir plus bas). Dépose un `.glb` dans le
   dossier Drive : il apparaît dans la liste au rechargement de la page,
   sous le nom du fichier (suivi de « (Drive) »).

> ⚠️ Cette clé sera visible dans le code source de la page (n'importe qui
> peut l'y voir) — c'est normal et volontaire pour ce type de clé
> restreinte en lecture seule : ce n'est pas un mot de passe, et les
> restrictions de l'étape 5 l'empêchent d'être utilisée ailleurs que sur
> ce site.

### B. Enregistrer automatiquement les photos dans Drive

1. Dans Google Drive, crée un dossier dédié aux photos (peut être
   différent de celui des modèles). Copie son ID (même méthode qu'au
   point 7 ci-dessus).
2. Va sur **[script.google.com](https://script.google.com/)**, connecté
   avec le même compte Google. Clique sur **« Nouveau projet »**.
3. Ouvre le fichier **`apps-script-photo.gs`** (dans ce dossier), copie
   tout son contenu, colle-le dans l'éditeur Apps Script (remplace ce qui
   s'y trouve).
4. Modifie les 2 lignes en haut du script :
   - `FOLDER_ID` = l'ID du dossier créé à l'étape 1
   - `SECRET` = invente un mot de passe simple (garde-le, il ressert à
     l'étape 8)
5. Menu **Déployer > Nouveau déploiement**. Type : **Application Web**.
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
6. Clique sur **Déployer**. Google va demander d'autoriser le script à
   accéder à ton Drive (normal, c'est le script qui va y écrire) :
   accepte.
7. Une **URL se termine par `/exec`** apparaît : copie-la.
8. Ouvre **`drive-config.js`**, remplace :
   - `photoUploadUrl` par l'URL copiée à l'étape 7
   - `photoSecret` par le **même** mot de passe qu'à l'étape 4
9. Republie sur GitHub Pages. Prends une photo dans l'appli : elle
   apparaît dans le dossier Drive de l'étape 1 quelques secondes après.

> Si une photo n'arrive pas dans Drive, ce n'est jamais bloquant pour
> l'appli (l'aperçu flottant dans le casque marche toujours) - vérifie que
> `photoUploadUrl`/`photoSecret` sont bien identiques des deux côtés
> (`drive-config.js` et `apps-script-photo.gs`), et que le déploiement
> Apps Script est bien accessible à « Tout le monde ».

## Publier une mise à jour en ligne (GitHub Pages)

Le projet est hébergé sur **GitHub Pages**, adresse fixe
`https://gmpbordeaux.fr/gmp-visu-vr/` :
- Dépôt : https://github.com/AntoineP3371/gmp-visu-vr (public), branche `main`
- Pour mettre à jour le site après avoir modifié un fichier :
  `git add -A && git commit -m "..." && git push`, puis attendre ~1 minute.
- Pense à changer le `?v=X.Y.Z` dans `index.html` (scripts `app.js` ET
  `drive-config.js`) à chaque nouvelle version, sinon Wolvic garde
  l'ancienne version en cache jusqu'à 10 minutes.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Écran d'accueil (choix du modèle, bouton d'entrée en AR) |
| `app.js` | Toute l'application (placement, manipulation, coloration) |
| `modeles.json` | **Liste des modèles locaux — un fichier à modifier pour en ajouter un sans passer par Drive** |
| `drive-config.js` | **Réglages Google Drive (clé API, dossier, URL Apps Script) — à remplir, voir plus haut** |
| `apps-script-photo.gs` | Code à coller dans script.google.com pour l'enregistrement des photos (voir plus haut) |
| `exemple-cric.glb` | Modèle de démonstration fourni avec le projet |
| `three.min.js` / `GLTFLoader.js` | Bibliothèque 3D (vendored, ne pas modifier) |
| `server.js` / `serveur.bat` | Serveur local + tunnel HTTPS (pour tester avec le casque) |

## Limites connues de la v1

- Un seul modèle manipulé à la fois (pas de scène à plusieurs objets).
- Pas d'import de fichier directement dans l'appli : chaque nouveau
  modèle s'ajoute soit en le déposant dans le dossier Drive configuré
  (voir plus haut), soit en copiant le `.glb` dans le dossier + une ligne
  dans `modeles.json`.
- Les mouvements internes du mécanisme et les interactions entre pièces
  (deuxième temps du projet) ne sont pas encore implémentés.
