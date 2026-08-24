window.addEventListener('load', function () {

// ============================================================================
//  VISIONNEUSE CAO EN REALITE MIXTE
//  Charge un modele GLB (issu d'un export STEP 3DEXPERIENCE converti sur PC),
//  le pose sur une vraie surface, permet de le manipuler (main libre ou
//  gizmo precis avec pivot reglable), de deplacer des pieces independamment,
//  de zoomer, et de colorer ses pieces. Annuler/Refaire sur tout ca.
// ============================================================================

var status  = document.getElementById('status');
var overlay = document.getElementById('overlay');
var canvas  = document.getElementById('c');
var errbox  = document.getElementById('errbox');
var boutonModeleChoisi = document.getElementById('boutonModeleChoisi');
var listeModelesEl     = document.getElementById('listeModeles');

if (typeof THREE === 'undefined') {
  status.textContent = 'Erreur: Three.js non charge';
  return;
}
status.textContent = 'Three.js OK';

// Le bouton "telephone" (AR tactile, cf plus bas) n'a de sens que sur
// Android - iPhone/Safari n'a de toute facon pas cette technologie (hors
// perimetre, decide avec l'utilisateur), et un ordinateur n'a pas de camera
// a filmer pour poser le modele dessus.
var estAndroid = /Android/.test(navigator.userAgent);
var btnTelephoneEl = document.getElementById('btnTelephone');
if (!estAndroid) {
  btnTelephoneEl.disabled = true;
  btnTelephoneEl.textContent = 'Realite augmentee (telephone Android uniquement)';
}

if (!navigator.xr) {
  status.textContent = 'WebXR non disponible';
  btnTelephoneEl.disabled = true;
} else {
  navigator.xr.isSessionSupported('immersive-ar').then(function (ok) {
    status.textContent = ok ? 'AR pret !' : 'AR non supporte';
    if (!ok) document.getElementById('btnCommencer').disabled = true;
    if (!ok && estAndroid) {
      btnTelephoneEl.disabled = true;
      btnTelephoneEl.textContent = 'Realite augmentee sur telephone (AR non supporte)';
    }
  });
}

// --- Liste des modeles : modeles.json (local) + dossier Google Drive
// (optionnel, cf drive-config.js) fusionnes dans la meme liste. Un modele
// Drive est charge directement depuis son URL de telechargement (alt=media) :
// chargerModele() n'a besoin d'aucune adaptation, un chemin relatif local et
// une URL complete se chargent de la meme facon via GLTFLoader.load().
//
// Liste "maison" en boutons plutot qu'un <select> natif : sur Wolvic (le
// navigateur du Quest), le picker natif d'un <select> ne s'ouvrait pas du
// tout au clic - un souci connu des navigateurs VR avec les controles de
// formulaire natifs (le systeme d'exploitation doit dessiner une popup
// par-dessus la vue VR, ce qui ne marche pas toujours).
var listeModelesOptions = [];      // { nom, fichier }
var modeleChoisi = { nom: '', fichier: '' };

function ajouterOptionModele(nom, valeur) {
  listeModelesOptions.push({ nom: nom, fichier: valeur });
  if (!modeleChoisi.fichier) definirModeleChoisi(nom, valeur);
  redessinerListeModeles();
}
function definirModeleChoisi(nom, valeur) {
  modeleChoisi = { nom: nom, fichier: valeur };
  boutonModeleChoisi.textContent = nom;
  redessinerListeModeles();
}
// Panneau toujours visible a cote de la carte d'accueil (plus une liste
// deroulante) : un bouton par modele, celui choisi est mis en evidence.
function redessinerListeModeles() {
  listeModelesEl.innerHTML = '';
  listeModelesOptions.forEach(function (m) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.nom;
    if (m.fichier === modeleChoisi.fichier) b.className = 'actif';
    b.addEventListener('click', function () { definirModeleChoisi(m.nom, m.fichier); });
    listeModelesEl.appendChild(b);
  });
}

function configDriveValide(cle) {
  var cfg = window.DRIVE_CONFIG;
  return !!(cfg && cfg[cle] && cfg[cle].indexOf('COLLE_') !== 0);
}
// Ignore silencieusement toute erreur (cle pas encore configuree, pas de
// reseau, dossier mal partage...) : la liste locale reste toujours
// disponible independamment de Drive.
function chargerListeDrive() {
  if (!configDriveValide('apiKey') || !configDriveValide('folderId')) return Promise.resolve();
  var cfg = window.DRIVE_CONFIG;
  var q = encodeURIComponent("'" + cfg.folderId + "' in parents and trashed=false");
  var url = 'https://www.googleapis.com/drive/v3/files?q=' + q +
    '&key=' + encodeURIComponent(cfg.apiKey) + '&fields=files(id,name)&pageSize=200';
  return fetch(url).then(function (r) { return r.json(); }).then(function (data) {
    (data.files || []).filter(function (f) { return /\.glb$/i.test(f.name); }).forEach(function (f) {
      var urlModele = 'https://www.googleapis.com/drive/v3/files/' + f.id +
        '?alt=media&key=' + encodeURIComponent(cfg.apiKey);
      ajouterOptionModele(f.name.replace(/\.glb$/i, '') + ' (Drive)', urlModele);
    });
  }).catch(function () {});
}

Promise.all([
  fetch('modeles.json').then(function (r) { return r.json(); }).catch(function () { return []; }),
  chargerListeDrive()
]).then(function (resultats) {
  resultats[0].forEach(function (m) { ajouterOptionModele(m.nom, m.fichier); });
  if (!listeModelesOptions.length) {
    boutonModeleChoisi.textContent = 'Aucun modele - voir LISEZ-MOI.md';
    document.getElementById('btnCommencer').disabled = true;
  }
});

// --- Renderer / scene ---
var gl = canvas.getContext('webgl2', { xrCompatible: true }) ||
         canvas.getContext('webgl',  { xrCompatible: true });
var renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
// Sans ca, les modeles GLB (materiaux PBR) ressortent nettement plus sombres
// et ternes que prevu - piege classique three.js, le rendu par defaut n'est
// pas corrige en sRGB pour l'affichage.
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');

var scene  = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
// La camera doit faire partie de la scene pour que des enfants qui lui sont
// attaches (ex : le flash de capture photo, cf plus bas) soient rendus -
// scene.traverse()/renderer.render() ne descend que depuis la racine scene.
scene.add(camera);

// Eclairage renforce (ambiante + 2 directionnelles opposees) : certains
// modeles (materiaux sombres/metalliques issus d'export STEP) restaient trop
// sombres avec une seule lumiere directionnelle - la 2eme, en contre-jour,
// eclaire les faces que la 1ere laisse dans l'ombre.
// Intensites revues a la baisse (etaient 1.8/1.1/0.7) : elles avaient ete
// AUGMENTEES en v1.16.2 pour compenser un modele trop sombre, avant de
// trouver la vraie cause (sRGB manquant, corrige juste au-dessus en v1.17.0)
// - les deux corrections cumulees rendaient les couleurs trop pales/delavees
// au casque (double compensation). Ambiante baissee (c'est elle qui aplatit
// le rendu), directionnelle principale legerement remontee (c'est elle qui
// donne du relief/contraste, l'inverse de "pale").
scene.add(new THREE.AmbientLight(0xffffff, 0.9));
var dirLight = new THREE.DirectionalLight(0xffffff, 1.3);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);
var dirLight2 = new THREE.DirectionalLight(0xffffff, 0.35);
dirLight2.position.set(-1, 0.5, -1.5);
scene.add(dirLight2);

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x+r,y); c.lineTo(x+w-r,y); c.quadraticCurveTo(x+w,y,x+w,y+r);
  c.lineTo(x+w,y+h-r); c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  c.lineTo(x+r,y+h); c.quadraticCurveTo(x,y+h,x,y+h-r);
  c.lineTo(x,y+r); c.quadraticCurveTo(x,y,x+r,y); c.closePath();
}
function hex(n) { return '#' + ('000000' + n.toString(16)).slice(-6); }

// Positionne un petit bouton "coin" (RAZ d'un axe, croix d'une mesure) en
// haut a droite d'un sprite de reference, EN FONCTION DE LA CAMERA COURANTE :
// les deux etant des Sprites (toujours face camera), un decalage MONDE fixe
// ne resterait pas visuellement "au coin" quand on tourne la tete - il faut
// recalculer l'offset chaque frame avec les axes droite/haut ACTUELS de la
// camera plutot qu'un offset perpendiculaire figé dans le monde 3D.
function positionnerBoutonCoin(bouton, spriteRef, decalX, decalY) {
  if (!bouton || !spriteRef) return;
  var right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  var up    = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  var posMonde = spriteRef.getWorldPosition(new THREE.Vector3())
    .addScaledVector(right, decalX)
    .addScaledVector(up, decalY);
  bouton.position.copy(bouton.parent.worldToLocal(posMonde));
}

// ============================================================================
//  HIERARCHIE
//  anchor : posee sur la table (placement)
//    pivot : LE point de manipulation du modele ENTIER (translate/rotate/zoom)
//      racineModele : le GLB centre/mis a l'echelle
//      pivotSelection : cree/detruit a la volee, enveloppe la piece ou le
//                        groupe de pieces actuellement cible independamment
//    gizmoTranslate / gizmoRotate : enfants de anchor (pas de pivot !),
//      repositionnes chaque frame sur la CIBLE courante - ainsi leur taille
//      a l'ecran ne change pas avec le zoom et leur orientation reste
//      toujours alignee sur la table sans calcul de contre-rotation.
// ============================================================================
var anchor = new THREE.Group();
anchor.visible = false;
scene.add(anchor);
var anchorPlaced = false;

var pivot = new THREE.Group();
anchor.add(pivot);

var racineModele    = null;
var pieces           = [];     // tous les meshes coloriables (traverse complet)
var piecesMobiles     = [];    // pieces de haut niveau, deplacables independamment
var pivotSelection    = null;  // enveloppe temporaire de la selection courante
var carPret           = false;
var nomModeleCourant  = '';
var fichierModeleCourant = '';   // pour la diffusion spectateur (quel GLB charger)
var echelleInitiale   = 1;     // facteur applique par ajusterTaille (pour le % d'echelle)

// --- Reticule + repere de placement ---
var hitTestSource          = null;
var hitTestSourceRequested = false;

var reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.09, 0.11, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x2f8fd6 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

var preview = new THREE.Group();
preview.add(new THREE.Mesh(
  new THREE.RingGeometry(0.17, 0.19, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
));
preview.add(new THREE.Mesh(
  new THREE.RingGeometry(0.02, 0.05, 24).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0xff8800, side: THREE.DoubleSide })
));
preview.visible = false;
scene.add(preview);

function replacer() {
  anchorPlaced = false;
  preview.visible = true;
  roue.visible = false;
  desactiverSelectionAB();
  definirMode(MODE.LIBRE);
  effacerMesure();
  sortirModePhoto();
  fermerApercuPhoto();
}
function quitterAR() {
  try {
    var s = renderer.xr.getSession();
    if (s) s.end();
  } catch (e) {}
}

// ============================================================================
//  ANNULER / REFAIRE
//  Historique lineaire d'actions typees. Les transformations sont enregistrees
//  comme des matrices MONDE avant/apres sur des objets stables (racineModele
//  ou les pieces elles-memes - jamais pivotSelection, qui est detruit/recree
//  a chaque changement de selection) : la restauration fonctionne donc meme
//  si la hierarchie a change depuis l'enregistrement.
// ============================================================================
var historique = [];
var refaire    = [];
var MAX_HISTORIQUE = 50;

function enregistrer(action) {
  historique.push(action);
  if (historique.length > MAX_HISTORIQUE) historique.shift();
  refaire.length = 0;
  majPanneau();
  diffuserAction(action, true);
}

// object.updateMatrixWorld(true) ne rafraichit que VERS LE BAS (l'objet et
// ses enfants) - si un parent (pivot, ancre...) vient de changer sans qu'une
// image ne soit encore passee par renderer.render(), matrixWorld peut rester
// perime. On repart donc de la racine (scene.updateMatrixWorld) pour etre
// sur d'avoir un etat a jour de haut en bas avant de lire/ecrire une matrice
// monde - important pour Annuler/Refaire, qui doivent rester exacts meme si
// l'action vient d'etre faite a l'instant.
function capturerMatricesMonde(objets) {
  scene.updateMatrixWorld(true);
  return objets.map(function (o) { return o.matrixWorld.clone(); });
}
function definirMatriceMonde(objet, matriceMonde) {
  if (!objet.parent) return;
  scene.updateMatrixWorld(true);
  var local = objet.parent.matrixWorld.clone().invert().multiply(matriceMonde);
  local.decompose(objet.position, objet.quaternion, objet.scale);
}
function matricesEgales(a, b) {
  for (var i = 0; i < 16; i++) { if (Math.abs(a.elements[i] - b.elements[i]) > 1e-6) return false; }
  return true;
}
function enregistrerTransformSiChange(objets, avant, apres) {
  if (!objets.length) return;
  var change = false;
  for (var i = 0; i < objets.length; i++) { if (!matricesEgales(avant[i], apres[i])) { change = true; break; } }
  if (!change) return;
  enregistrer({ type: 'transform', objets: objets.slice(), avant: avant, apres: apres });
}

function appliquerAction(a, versApres) {
  if (a.type === 'transform') {
    var mats = versApres ? a.apres : a.avant;
    a.objets.forEach(function (o, i) { definirMatriceMonde(o, mats[i]); });
  } else if (a.type === 'echelle') {
    pivot.scale.setScalar(versApres ? a.apres : a.avant);
  } else if (a.type === 'couleur') {
    a.mat.color.setHex(versApres ? a.apres : a.avant);
  } else if (a.type === 'couleur-lot') {
    a.entrees.forEach(function (e) { e.mat.color.setHex(versApres ? e.apres : e.avant); });
  }
}
function annuler() {
  if (!historique.length) return;
  var a = historique.pop();
  appliquerAction(a, false);
  refaire.push(a);
  afficherIndicateurAction('ANNULE', libelleTypeAction(a));
  majPanneau();
  diffuserAction(a, false);
}
function retablir() {
  if (!refaire.length) return;
  var a = refaire.pop();
  appliquerAction(a, true);
  historique.push(a);
  afficherIndicateurAction('RETABLI', libelleTypeAction(a));
  majPanneau();
  diffuserAction(a, true);
}

// ============================================================================
//  CHARGEMENT DU MODELE
// ============================================================================
function ajusterTaille(objet, tailleCible) {
  var box = new THREE.Box3().setFromObject(objet);
  var taille = new THREE.Vector3();
  box.getSize(taille);
  var maxDim = Math.max(taille.x, taille.y, taille.z);
  var facteur = maxDim > 0 ? tailleCible / maxDim : 1;
  objet.scale.setScalar(facteur);
  return facteur;
}
function capturerOrigine(obj) {
  obj.userData.origine = { pos: obj.position.clone(), quat: obj.quaternion.clone() };
}

var loader = new THREE.GLTFLoader();

function chargerModele(fichier) {
  fichierModeleCourant = fichier;
  pivot.position.set(0, 0, 0);
  pivot.quaternion.identity();
  pivot.scale.set(1, 1, 1);

  loader.load(fichier, function (gltf) {
    var root = gltf.scene;

    // ATTENTION : tout le recentrage se fait TANT QUE root n'a PAS de parent.
    // Box3.setFromObject renvoie des coordonnees MONDE : si root etait deja
    // rattache au pivot (deja positionne sur la table), on soustrairait un
    // decalage monde a une position locale et le modele partirait hors de vue.
    echelleInitiale = ajusterTaille(root, 0.30);
    root.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(root);
    var centre = new THREE.Vector3();
    box.getCenter(centre);
    root.position.sub(centre);
    root.position.y += (centre.y - box.min.y) + 0.01;

    pivot.add(root);
    racineModele = root;

    // Un export STEP->GLB partage souvent un materiau entre plusieurs pieces
    // sans lien entre elles : on clone par mesh/sous-materiau pour pouvoir
    // les colorer independamment.
    root.traverse(function (o) {
      if (!o.isMesh) return;
      if (Array.isArray(o.material)) {
        o.material = o.material.map(function (m) { return m.clone(); });
        o.userData.couleursOrigine = o.material.map(function (m) { return m.color.getHex(); });
      } else {
        o.material = o.material.clone();
        o.userData.couleursOrigine = [o.material.color.getHex()];
      }
      pieces.push(o);
    });

    // Pieces de haut niveau (unite de deplacement independant) : on descend
    // sous les groupes d'emballage a enfant unique typiques des exports
    // STEP->GLTF, jusqu'au premier noeud qui a plusieurs enfants (ou aucun).
    var carRacine = root;
    while (carRacine.children.length === 1) carRacine = carRacine.children[0];
    piecesMobiles = carRacine.children.slice();

    pivot.updateMatrixWorld(true);
    capturerOrigine(pivot);

    // Position/orientation d'origine de CHAQUE piece, exprimee dans le repere
    // du pivot (et non de son parent direct, qui change a chaque selection) :
    // c'est ce qui permet au RAZ GENERAL de remettre meme les pieces deplacees
    // individuellement ou en groupe, meme apres plusieurs allers-retours de
    // selection.
    scene.updateMatrixWorld(true);
    piecesMobiles.forEach(function (p) {
      p.userData.matriceRelPivotOrigine = pivot.matrixWorld.clone().invert().multiply(p.matrixWorld);
    });

    carPret = true;
    majPanneau();
  }, undefined, function (e) {
    errbox.textContent = 'Erreur GLB: ' + e;
  });
}

// ============================================================================
//  CIBLE DE MANIPULATION : le modele entier, ou une selection de pieces
//  construite au vol en tenant A + gachette (peut n'en contenir qu'une, ou
//  plusieurs = un groupe - meme mecanisme pour les deux cas).
//  Relacher A desselectionne tout et revient au modele entier.
// ============================================================================
var selection         = [];   // pieces actuellement choisies via A+gachette
var piecesSurlignees   = [];  // meshes actuellement teintes (pour les nettoyer)

function cibleActive() { return selection.length > 0; }
function cibleCourante() {
  return cibleActive() ? pivotSelection : pivot;
}
function parentLogiqueCible() {
  return cibleActive() ? pivot : anchor;
}
function objetsCiblesActuels() {
  if (cibleActive()) return selection.slice();
  return racineModele ? [racineModele] : [];
}
// Comme objetsCiblesActuels(), mais inclut aussi TOUTES les pieces
// individuellement suivies quand la cible est le MODELE ENTIER - necessaire
// pour que l'aimantation, dans ce cas precis, remette aussi en place (comme
// RAZ GENERALE) les pieces deja deplacees individuellement, et que
// l'historique Annuler/Refaire couvre ce deplacement silencieux.
function objetsPourUndoAimant() {
  var base = objetsCiblesActuels();
  return cibleCourante() === pivot ? base.concat(piecesMobiles) : base;
}

function surlignerSelection() {
  piecesSurlignees.forEach(function (m) {
    var mats = Array.isArray(m.material) ? m.material : [m.material];
    mats.forEach(function (mat) { if (mat.emissive) mat.emissive.setHex(0x000000); });
  });
  piecesSurlignees = [];
  selection.forEach(function (piece) {
    piece.traverse(function (o) {
      if (!o.isMesh) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (mat) { if (mat.emissive) mat.emissive.setHex(0x554400); });
      piecesSurlignees.push(o);
    });
  });
}

function restaurerOpaciteDe(pieces_) {
  pieces_.forEach(function (piece) {
    piece.traverse(function (o) {
      if (!o.isMesh) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) { m.opacity = 1; });
    });
    piece.userData.niveauTransp = 0;
  });
}
function appliquerTransparencePiece(piece, opacite) {
  piece.traverse(function (o) {
    if (!o.isMesh) return;
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m) { m.transparent = true; m.opacity = opacite; });
  });
}
function appliquerTransparenceSelection(opacite) {
  selection.forEach(function (piece) { appliquerTransparencePiece(piece, opacite); });
}

// ============================================================================
//  TRANSPARENCE AU JOYSTICK : reglage en VITESSE (pas en position absolue) -
//  la valeur "reste" quand on relache le joystick (qui revient seul au
//  centre) ou la gachette, contrairement a une ancienne version ou relacher
//  le joystick faisait retomber l'opacite a 1 instantanement. Echelle 0-100
//  (0 = opaque, 100 = transparent), bornee des deux cotes.
// ============================================================================
var VITESSE_TRANSP = 130; // points de niveau (0-100) par seconde a pleine deflexion

// etat = objet portant .niveauTransp (userData d'une piece pour un reglage
// individuel au laser, ou un objet dedie pour un groupe/selection entier qui
// doit avancer bloc par bloc, sans desynchronisation possible entre ses
// pieces). appliquer(opacite) permet a l'appelant de cibler UNE piece ou
// TOUTE une selection avec la meme logique. Retourne le texte a afficher
// dans l'etiquette flottante.
function ajusterNiveauTransparence(etat, axisValue, dt, appliquer) {
  if (etat.niveauTransp === undefined) etat.niveauTransp = 0;
  var niveau = etat.niveauTransp + axisValue * VITESSE_TRANSP * dt;
  etat.niveauTransp = Math.max(0, Math.min(100, niveau));
  appliquer(1 - etat.niveauTransp / 100);
  return Math.round(100 - etat.niveauTransp) + ' %';
}

// Etat PARTAGE pour l'ajustement via SELECTION (A+gachette) : toutes les
// pieces choisies avancent forcement ensemble (meme increment chaque
// frame), donc un seul etat suffit - pas de risque de desync entre elles.
var etatTranspSelection = { niveauTransp: 0 };

// Etiquette flottante "NN %", ancree AU-DESSUS de la piece en cours de
// reglage, visible seulement pendant l'ajustement actif (contrairement a
// l'indicateur Annuler/Refaire, pas besoin qu'elle persiste apres coup : la
// transparence du modele lui-meme reste le retour visuel permanent).
var tlc = document.createElement('canvas');
tlc.width = 200; tlc.height = 70;
var tlctx = tlc.getContext('2d');
var texTransp = new THREE.CanvasTexture(tlc);
var spriteTransp = new THREE.Sprite(new THREE.SpriteMaterial({ map: texTransp, depthTest: false, transparent: true }));
spriteTransp.scale.set(0.09, 0.09 * 70 / 200, 1);
spriteTransp.renderOrder = 1600;
spriteTransp.visible = false;
scene.add(spriteTransp);
function afficherLabelTransparence(objet, texte) {
  tlctx.clearRect(0, 0, 200, 70);
  rr(tlctx, 2, 2, 196, 66, 14);
  tlctx.fillStyle = 'rgba(20,20,20,0.85)'; tlctx.fill();
  rr(tlctx, 2, 2, 196, 66, 14);
  tlctx.strokeStyle = '#8fd6ff'; tlctx.lineWidth = 3; tlctx.stroke();
  tlctx.fillStyle = '#8fd6ff'; tlctx.font = 'bold 26px sans-serif';
  tlctx.textAlign = 'center'; tlctx.textBaseline = 'middle';
  tlctx.fillText(texte, 100, 37);
  texTransp.needsUpdate = true;

  var box = new THREE.Box3().setFromObject(objet);
  var centre = new THREE.Vector3(); box.getCenter(centre);
  spriteTransp.position.copy(centre);
  spriteTransp.position.y = box.max.y + 0.04;
  spriteTransp.visible = true;
}

function relacherSelection() {
  if (pivotSelection) {
    pivotSelection.children.slice().forEach(function (p) { pivot.attach(p); });
    pivot.remove(pivotSelection);
    pivotSelection = null;
  }
}

// Reconstruit pivotSelection autour du centroide (coordonnees monde) de la
// selection courante, puis y rattache chaque piece (Object3D.attach
// preserve sa position monde : rien ne bouge visuellement).
function reconstruireCible() {
  relacherSelection();
  if (!selection.length) return;
  pivotSelection = new THREE.Group();
  pivot.add(pivotSelection);
  var centre = new THREE.Vector3();
  selection.forEach(function (p) {
    var v = new THREE.Vector3();
    p.getWorldPosition(v);
    centre.add(v);
  });
  centre.divideScalar(selection.length);
  pivotSelection.position.copy(pivot.worldToLocal(centre.clone()));
  pivotSelection.updateMatrixWorld(true);
  selection.forEach(function (p) { pivotSelection.attach(p); });
  capturerOrigine(pivotSelection);
}

// Abandonne toute la selection courante. N'est PLUS appele automatiquement
// au relachement du bouton A (la selection doit rester utilisable ensuite,
// notamment pour la deplacer precisement via le gizmo) : seul le bouton
// "Libre" du menu (ou "DESELECTIONNER" en mode bureau) la declenche.
function desactiverSelectionAB() {
  if (!selection.length) return;
  // Si la selection est en train d'etre saisie (grip), on la relache proprement
  // (et on enregistre le deplacement pour Annuler) AVANT de la detruire.
  if (grabIdx !== -1) terminerGrab();
  restaurerOpaciteDe(selection);
  etatTranspSelection = { niveauTransp: 0 };
  selection = [];
  surlignerSelection();
  relacherSelection();
  dragEtat = null;
  viderFantome();
  majPanneau();
}
// Retour explicite a "tout le modele" : desselectionne ET repasse en
// deplacement libre (bouton "Libre" du menu Deplacements).
function revenirLibre() {
  desactiverSelectionAB();
  definirMode(MODE.LIBRE);
}

function trouverPieceRacine(mesh) {
  var o = mesh;
  while (o) {
    if (piecesMobiles.indexOf(o) !== -1) return o;
    o = o.parent;
  }
  return null;
}
// Un clic gachette PENDANT que A est tenu (sur la meme manette) (de)selectionne
// la piece visee - qu'il n'y en ait qu'une ou plusieurs, meme mecanisme.
function gererClicSelection(ray) {
  var hits = ray.intersectObjects(pieces, false);
  if (!hits.length) return;
  var piece = trouverPieceRacine(hits[0].object);
  if (!piece) return;
  var i = selection.indexOf(piece);
  if (i >= 0) { restaurerOpaciteDe([piece]); selection.splice(i, 1); }
  else { selection.push(piece); }
  surlignerSelection();
  reconstruireCible();
  majPanneau();
}

// ============================================================================
//  REINITIALISATION (position/rotation globale ou par axe)
// ============================================================================
function resetTout() {
  var c = cibleCourante(); if (!c || !c.userData.origine) return;
  var avant = capturerMatricesMonde(objetsCiblesActuels());
  c.position.copy(c.userData.origine.pos);
  c.quaternion.copy(c.userData.origine.quat);
  var apres = capturerMatricesMonde(objetsCiblesActuels());
  enregistrerTransformSiChange(objetsCiblesActuels(), avant, apres);
  majPanneau();
}
function resetPosition() {
  var c = cibleCourante(); if (!c || !c.userData.origine) return;
  var avant = capturerMatricesMonde(objetsCiblesActuels());
  c.position.copy(c.userData.origine.pos);
  var apres = capturerMatricesMonde(objetsCiblesActuels());
  enregistrerTransformSiChange(objetsCiblesActuels(), avant, apres);
  majPanneau();
}
function resetRotation() {
  var c = cibleCourante(); if (!c || !c.userData.origine) return;
  var avant = capturerMatricesMonde(objetsCiblesActuels());
  c.quaternion.copy(c.userData.origine.quat);
  var apres = capturerMatricesMonde(objetsCiblesActuels());
  enregistrerTransformSiChange(objetsCiblesActuels(), avant, apres);
  majPanneau();
}
function resetAxeTranslation(lettre) {
  var c = cibleCourante(); if (!c || !c.userData.origine) return;
  var avant = capturerMatricesMonde(objetsCiblesActuels());
  c.position[lettre] = c.userData.origine.pos[lettre];
  var apres = capturerMatricesMonde(objetsCiblesActuels());
  enregistrerTransformSiChange(objetsCiblesActuels(), avant, apres);
  majPanneau();
}
// RAZ generale : remet le modele ENTIER a sa position/orientation d'origine,
// y compris les pieces deplacees individuellement ou en groupe (contrairement
// a resetTout(), qui ne touche que la cible actuellement selectionnee).
function razGenerale() {
  if (!racineModele) return;
  var objets = [racineModele].concat(piecesMobiles);
  var avant = capturerMatricesMonde(objets);

  desactiverSelectionAB();
  pivot.position.copy(pivot.userData.origine.pos);
  pivot.quaternion.copy(pivot.userData.origine.quat);
  scene.updateMatrixWorld(true);
  piecesMobiles.forEach(function (p) {
    var mondeCible = pivot.matrixWorld.clone().multiply(p.userData.matriceRelPivotOrigine);
    definirMatriceMonde(p, mondeCible);
  });

  var apres = capturerMatricesMonde(objets);
  enregistrerTransformSiChange(objets, avant, apres);
  majPanneau();
}
// Reprend le coeur de razGenerale() (restaurer chaque piece individuellement
// suivie a sa position d'origine relative au pivot), pour que l'aimantation
// du MODELE ENTIER se comporte comme RAZ GENERALE plutot que comme resetTout
// (qui ne touche que le pivot lui-meme) - decide avec l'utilisateur apres
// son retour "si des mouvements d'autres pieces se font, la position est
// perdue" en testant l'aimantation au casque.
function restaurerPiecesMobilesSiPivot(c) {
  if (c !== pivot) return;
  scene.updateMatrixWorld(true);
  piecesMobiles.forEach(function (p) {
    var mondeCible = pivot.matrixWorld.clone().multiply(p.userData.matriceRelPivotOrigine);
    definirMatriceMonde(p, mondeCible);
  });
}
function resetAxeRotation(lettre) {
  var c = cibleCourante(); if (!c || !c.userData.origine) return;
  var avant = capturerMatricesMonde(objetsCiblesActuels());
  // Decomposition Euler (ordre XYZ) : approximation pratique pour isoler UN
  // axe de rotation a la fois - une vraie decomposition orthogonale n'existe
  // pas en general pour des quaternions composes, mais suffit largement pour
  // un bouton "remets cet axe a zero".
  var eActuel  = new THREE.Euler().setFromQuaternion(c.quaternion, 'XYZ');
  var eOrigine = new THREE.Euler().setFromQuaternion(c.userData.origine.quat, 'XYZ');
  eActuel[lettre] = eOrigine[lettre];
  c.quaternion.setFromEuler(eActuel);
  var apres = capturerMatricesMonde(objetsCiblesActuels());
  enregistrerTransformSiChange(objetsCiblesActuels(), avant, apres);
  majPanneau();
}

// ============================================================================
//  A. MAIN LIBRE : saisie 6DOF de la cible courante (modele, piece ou groupe)
// ============================================================================
var SEUIL_MARGE = 0.15;   // marge de tolerance autour de la boite englobante
var grabIdx   = -1;
var grabAvant = null;
var grabAimante = false;             // aimantee a sa position d'origine pendant le grip ?
var grabPosControleurAimant = null;  // position manette au moment de l'accrochage (pour se detacher)

function pointDeGrabProche(posControleur) {
  var objets = objetsCiblesActuels();
  if (!objets.length) return false;
  var box = new THREE.Box3();
  objets.forEach(function (o, i) {
    var b = new THREE.Box3().setFromObject(o);
    if (i === 0) box.copy(b); else box.union(b);
  });
  var sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  return posControleur.distanceTo(sphere.center) < (sphere.radius + SEUIL_MARGE);
}
function terminerGrab() {
  var c = cibleCourante();
  if (c) {
    parentLogiqueCible().attach(c);
    if (grabAvant) {
      var apres = capturerMatricesMonde(objetsPourUndoAimant());
      enregistrerTransformSiChange(objetsPourUndoAimant(), grabAvant, apres);
    }
  }
  grabIdx = -1;
  grabAvant = null;
  grabAimante = false;
  viderFantome();
}

// Aimantation en pleine prise (grip VR/telephone) : contrairement au gizmo,
// l'objet saisi est un enfant du CONTROLEUR (ctrl.attach) - rien ne le
// repositionne par frame de lui-meme, donc une fois aimante il faut le
// reposer explicitement chaque frame (sinon il derive avec le controleur),
// et suivre le deplacement du controleur DEPUIS l'accrochage pour savoir
// quand se detacher (un simple ecart a l'origine ne marche plus une fois
// pose exactement dessus). Appelee chaque frame depuis la boucle de rendu
// tant que grabIdx !== -1.
function majAimantGrab() {
  if (grabIdx === -1) return;
  var c = cibleCourante();
  if (!c || !c.userData.origine) { grabAimante = false; viderFantome(); return; }
  var ctrl = controllers[grabIdx];
  var parentLogique = parentLogiqueCible(); // anchor ou pivot - jamais le controleur
  scene.updateMatrixWorld(true);
  var origineMonde = parentLogique.matrixWorld.clone().multiply(
    new THREE.Matrix4().compose(c.userData.origine.pos, c.userData.origine.quat, new THREE.Vector3(1, 1, 1)));
  var posOrigine = new THREE.Vector3(); var quatOrigine = new THREE.Quaternion(); var _s = new THREE.Vector3();
  origineMonde.decompose(posOrigine, quatOrigine, _s);
  var posControleur = ctrl.getWorldPosition(new THREE.Vector3());

  if (grabAimante) {
    if (posControleur.distanceTo(grabPosControleurAimant) > SEUIL_DETACHE_GRAB) {
      grabAimante = false;
      return;
    }
    definirMatriceMonde(c, origineMonde);
    fantomeGroupe.visible = false;
    restaurerPiecesMobilesSiPivot(c);
    return;
  }

  var posActuelle = c.getWorldPosition(new THREE.Vector3());
  var quatActuelle = c.getWorldQuaternion(new THREE.Quaternion());
  var distPos = posActuelle.distanceTo(posOrigine);
  var distRot = quatActuelle.angleTo(quatOrigine);

  if (distPos < SEUIL_INDICE_POS && distRot < SEUIL_INDICE_ROT) {
    construireFantomeSiBesoin(c);
    positionnerFantome(origineMonde);
    fantomeGroupe.visible = true;
  } else {
    viderFantome();
  }

  if (distPos < SEUIL_AIMANT_POS && distRot < SEUIL_AIMANT_ROT) {
    grabAimante = true;
    grabPosControleurAimant = posControleur;
    definirMatriceMonde(c, origineMonde);
    vibrerManette(ctrl, 0.6, 60);
    fantomeGroupe.visible = false;
    restaurerPiecesMobilesSiPivot(c);
  }
}

// ============================================================================
//  ZOOM A 2 MANETTES (grips simultanes) - agit toujours sur le modele entier
// ============================================================================
var gripEtat = [false, false];
var modeZoom = false;
var zoomDistDepart = 0, zoomEchelleDepart = 1, zoomAvant = null;
var ECHELLE_MIN = 0.05, ECHELLE_MAX = 20;

// Etiquette flottante "NN %" affichee EN DIRECT entre les 2 manettes pendant
// le zoom (sprite = toujours face a la camera, canvas redessine chaque frame
// puisque le pourcentage change en continu).
var ecEchelle = document.createElement('canvas');
ecEchelle.width = 256; ecEchelle.height = 96;
var ectxEchelle = ecEchelle.getContext('2d');
var texEchelle = new THREE.CanvasTexture(ecEchelle);
var spriteEchelle = new THREE.Sprite(new THREE.SpriteMaterial({ map: texEchelle, depthTest: false, transparent: true }));
spriteEchelle.scale.set(0.16, 0.06, 1);
spriteEchelle.renderOrder = 999;
spriteEchelle.visible = false;
scene.add(spriteEchelle);

function dessinerEchelleSprite() {
  ectxEchelle.clearRect(0, 0, 256, 96);
  ectxEchelle.fillStyle = 'rgba(20,20,20,0.85)';
  rr(ectxEchelle, 2, 2, 252, 92, 16); ectxEchelle.fill();
  ectxEchelle.strokeStyle = '#8fd6ff'; ectxEchelle.lineWidth = 3;
  rr(ectxEchelle, 2, 2, 252, 92, 16); ectxEchelle.stroke();
  ectxEchelle.fillStyle = '#8fd6ff'; ectxEchelle.font = 'bold 40px sans-serif';
  ectxEchelle.textAlign = 'center'; ectxEchelle.textBaseline = 'middle';
  ectxEchelle.fillText(Math.round(pourcentageEchelle()) + ' %', 128, 48);
  texEchelle.needsUpdate = true;
}

function demarrerZoom() {
  modeZoom = true;
  var p0 = new THREE.Vector3(); controllers[0].getWorldPosition(p0);
  var p1 = new THREE.Vector3(); controllers[1].getWorldPosition(p1);
  zoomDistDepart = p0.distanceTo(p1);
  zoomEchelleDepart = pivot.scale.x;
  zoomAvant = pivot.scale.x;
  spriteEchelle.visible = true;
  dessinerEchelleSprite();
}
// "Aimante" l'echelle sur des paliers ronds (% de la taille reelle) des que
// l'on s'en approche, pour pouvoir retomber pile sur 100% par exemple.
var SNAP_ECHELLE = [50, 75, 100, 125, 150, 200];
var SNAP_TOLERANCE = 4; // points de pourcentage
function magnetiserEchelle(scaleBrut) {
  var pct = scaleBrut * echelleInitiale * 100;
  for (var i = 0; i < SNAP_ECHELLE.length; i++) {
    if (Math.abs(pct - SNAP_ECHELLE[i]) < SNAP_TOLERANCE) {
      return (SNAP_ECHELLE[i] / 100) / echelleInitiale;
    }
  }
  return scaleBrut;
}

// ============================================================================
//  AIMANTATION AU RETOUR A L'ORIGINE - meme donnee/semantique que les
//  boutons RAZ (resetTout/resetAxeTranslation/...) : "userData.origine" de
//  la cible courante, juste declenchee par la proximite pendant un geste au
//  lieu d'un clic. Fantome semi-transparent en aperçu, vibration manette a
//  l'accrochage (silencieuse si absente : telephone/souris).
// ============================================================================
var SEUIL_INDICE_POS = 0.035;   // 3.5 cm : le fantome apparait
var SEUIL_AIMANT_POS = 0.012;   // 1.2 cm : aimantation (position)
var SEUIL_INDICE_ROT = 0.26;    // ~15 deg : le fantome apparait (rotation)
var SEUIL_AIMANT_ROT = 0.09;    // ~5 deg : aimantation (rotation)
var SEUIL_DETACHE_GRAB = 0.05;  // 5 cm de mouvement manette pour se detacher une fois aimante

function vibrerManette(ctrl, intensite, dureeMs) {
  try {
    var gp = ctrl && ctrl.userData.src && ctrl.userData.src.gamepad;
    var act = gp && gp.hapticActuators && gp.hapticActuators[0];
    if (act && act.pulse) act.pulse(intensite, dureeMs);
  } catch (e) {}
}

var fantomeGroupe = new THREE.Group(); fantomeGroupe.visible = false; scene.add(fantomeGroupe);
var matFantome = new THREE.MeshBasicMaterial({ color: 0x2f8fd6, transparent: true, opacity: 0.35, depthWrite: false });

function viderFantome() {
  while (fantomeGroupe.children.length) fantomeGroupe.remove(fantomeGroupe.children[0]);
  fantomeGroupe.visible = false;
}
// Clone les meshes de "objets" (geometrie partagee, pas clonee) en conservant
// leur position RELATIVE A "c" (la cible en cours de deplacement) - sinon
// chaque clone atterrit a l'origine du groupe fantome et perd son decalage
// interne (bug reel trouve au test casque : le fantome "apparaissait
// n'importe ou" des qu'une piece/un groupe contenait plus d'un mesh, ce qui
// est le cas courant). fantomeGroupe est ensuite positionne a la pose MONDE
// d'origine par positionnerFantome(), donc l'agencement relatif calcule ici
// se retrouve reconstitue a la bonne place.
// Cas particulier du MODELE ENTIER (c === pivot) : comme l'aimantation y
// restaure aussi les pieces individuellement deplacees (cf
// restaurerPiecesMobilesSiPivot), l'apercu doit montrer CETTE position
// VRAIMENT D'ORIGINE (via matriceRelPivotOrigine), pas la position actuelle
// (potentiellement deja deplacee) de chaque piece - sinon l'apercu ne
// correspondrait pas a ce qui va reellement se passer.
function construireFantome(c, objets) {
  viderFantome();
  scene.updateMatrixWorld(true);
  var pivotEstCible = (c === pivot);
  var inverseCible = c.matrixWorld.clone().invert();
  objets.forEach(function (o) {
    o.traverse(function (m) {
      if (!m.isMesh) return;
      var clone = new THREE.Mesh(m.geometry, matFantome);
      var piece = pivotEstCible ? trouverPieceRacine(m) : null;
      if (piece && piece.userData.matriceRelPivotOrigine) {
        var relMeshDansPiece = piece.matrixWorld.clone().invert().multiply(m.matrixWorld);
        clone.matrix.copy(piece.userData.matriceRelPivotOrigine).multiply(relMeshDansPiece);
      } else {
        clone.matrix.copy(inverseCible).multiply(m.matrixWorld);
      }
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      fantomeGroupe.add(clone);
    });
  });
}
// Positionne le groupe fantome (deja construit) a une matrice MONDE donnee -
// puisque ses enfants sont ajoutes sans transformation propre, positionner
// fantomeGroupe suffit a positionner tous les clones ensemble.
function positionnerFantome(matriceMonde) {
  if (!fantomeGroupe.parent) return;
  var local = fantomeGroupe.parent.matrixWorld.clone().invert().multiply(matriceMonde);
  local.decompose(fantomeGroupe.position, fantomeGroupe.quaternion, fantomeGroupe.scale);
}

// Verifie/applique l'aimantation sur UN SEUL axe (gizmo precis, VR et
// souris) - reprend exactement le calcul de resetAxeTranslation/
// resetAxeRotation, juste applique en continu pendant le glissement plutot
// qu'au clic. Retourne true si aimante sur cet appel (pour la vibration,
// declenchee par l'appelant au front montant uniquement).
function verifierAimantAxe(c, axeLettre, mode, ctrl) {
  if (!c.userData.origine) { viderFantome(); return false; }
  var aimante;
  if (mode === 'translate') {
    var ecart = Math.abs(c.position[axeLettre] - c.userData.origine.pos[axeLettre]);
    if (ecart < SEUIL_INDICE_POS) {
      construireFantomeSiBesoin(c);
      var posFantome = c.position.clone(); posFantome[axeLettre] = c.userData.origine.pos[axeLettre];
      positionnerFantome(new THREE.Matrix4().compose(
        c.parent.localToWorld(posFantome.clone()),
        c.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(1, 1, 1)));
      fantomeGroupe.visible = true;
    } else { viderFantome(); }
    aimante = ecart < SEUIL_AIMANT_POS;
    if (aimante) { c.position[axeLettre] = c.userData.origine.pos[axeLettre]; fantomeGroupe.visible = false; restaurerPiecesMobilesSiPivot(c); }
  } else {
    var eActuel  = new THREE.Euler().setFromQuaternion(c.quaternion, 'XYZ');
    var eOrigine = new THREE.Euler().setFromQuaternion(c.userData.origine.quat, 'XYZ');
    var ecartRot = Math.abs(eActuel[axeLettre] - eOrigine[axeLettre]);
    if (ecartRot < SEUIL_INDICE_ROT) {
      construireFantomeSiBesoin(c);
      var eFantome = eActuel.clone(); eFantome[axeLettre] = eOrigine[axeLettre];
      positionnerFantome(new THREE.Matrix4().compose(
        c.getWorldPosition(new THREE.Vector3()),
        c.parent.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(eFantome)),
        new THREE.Vector3(1, 1, 1)));
      fantomeGroupe.visible = true;
    } else { viderFantome(); }
    aimante = ecartRot < SEUIL_AIMANT_ROT;
    if (aimante) { eActuel[axeLettre] = eOrigine[axeLettre]; c.quaternion.setFromEuler(eActuel); fantomeGroupe.visible = false; restaurerPiecesMobilesSiPivot(c); }
  }
  return aimante;
}
var _dernierAimantAxe = null; // objet actuellement previsualise, pour ne reconstruire le fantome que si besoin
function construireFantomeSiBesoin(c) {
  if (_dernierAimantAxe === c && fantomeGroupe.children.length) return;
  _dernierAimantAxe = c;
  construireFantome(c, objetsCiblesActuels());
}

// Glisser libre a la souris (Ctrl+glisser, mode 'libre' de majDragBureau) :
// position complete (jamais de rotation dans ce mode), pas de manette donc
// pas de vibration. Le detachement est automatique ici (contrairement au
// grip VR) puisque majDragBureau recalcule la position brute a partir du
// rayon souris a chaque appel - s'eloigner suffit a ne plus etre aimante.
function verifierAimantLibreSouris(c) {
  if (!c.userData.origine) { viderFantome(); return; }
  var ecart = c.position.distanceTo(c.userData.origine.pos);
  if (ecart < SEUIL_INDICE_POS) {
    construireFantomeSiBesoin(c);
    positionnerFantome(new THREE.Matrix4().compose(
      c.parent.localToWorld(c.userData.origine.pos.clone()),
      c.getWorldQuaternion(new THREE.Quaternion()), new THREE.Vector3(1, 1, 1)));
    fantomeGroupe.visible = true;
  } else { viderFantome(); }
  if (ecart < SEUIL_AIMANT_POS) { c.position.copy(c.userData.origine.pos); fantomeGroupe.visible = false; restaurerPiecesMobilesSiPivot(c); }
}

function majZoom() {
  var p0 = new THREE.Vector3(); controllers[0].getWorldPosition(p0);
  var p1 = new THREE.Vector3(); controllers[1].getWorldPosition(p1);
  if (zoomDistDepart >= 1e-4) {
    var facteur = p0.distanceTo(p1) / zoomDistDepart;
    var nouvelle = Math.max(ECHELLE_MIN, Math.min(ECHELLE_MAX, zoomEchelleDepart * facteur));
    pivot.scale.setScalar(magnetiserEchelle(nouvelle));
  }
  spriteEchelle.position.copy(p0).add(p1).multiplyScalar(0.5);
  dessinerEchelleSprite();
}
function terminerZoom() {
  modeZoom = false;
  spriteEchelle.visible = false;
  if (zoomAvant !== null && Math.abs(pivot.scale.x - zoomAvant) > 1e-6) {
    enregistrer({ type: 'echelle', avant: zoomAvant, apres: pivot.scale.x });
  }
  zoomAvant = null;
}
function pourcentageEchelle() {
  return pivot.scale.x * echelleInitiale * 100;
}

// ============================================================================
//  B. GIZMO DE MANIPULATION PRECISE (translation + rotation)
// ============================================================================
var AXES = [
  { nom: 'x', dir: new THREE.Vector3(1, 0, 0), couleur: 0xff3333 },
  { nom: 'y', dir: new THREE.Vector3(0, 1, 0), couleur: 0x33ff55 },
  { nom: 'z', dir: new THREE.Vector3(0, 0, 1), couleur: 0x3388ff }
];
var LONGUEUR_FLECHE = 0.15;
var RAYON_ANNEAU    = 0.12;

function creerFleche(couleur, rayon) {
  var g = new THREE.Group();
  var mat = new THREE.MeshBasicMaterial({ color: couleur, depthTest: false });
  var corps = new THREE.Mesh(new THREE.CylinderGeometry(rayon, rayon, 1, 10), mat);
  var tete  = new THREE.Mesh(new THREE.ConeGeometry(rayon * 2.8, rayon * 8, 12), mat);
  g.add(corps, tete);
  g.userData = { corps: corps, tete: tete, rayon: rayon };
  return g;
}
function majFleche(f, depuis, vers) {
  var dir = vers.clone().sub(depuis);
  var longueur = dir.length();
  if (longueur < 1e-5) { f.visible = false; return; }
  dir.normalize();
  var d = f.userData;
  var lTete  = Math.min(d.rayon * 8, longueur * 0.45);
  var lCorps = longueur - lTete;
  d.corps.scale.set(1, Math.max(lCorps, 1e-4), 1);
  d.corps.position.set(0, lCorps / 2, 0);
  d.tete.scale.set(1, lTete / (d.rayon * 8), 1);
  d.tete.position.set(0, lCorps + lTete / 2, 0);
  f.position.copy(depuis);
  f.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
}
function perpendiculaire(axe) {
  var aide = Math.abs(axe.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3().crossVectors(axe, aide).normalize();
}

// Marqueur d'axe (sprite = toujours face a la camera) : affiche "0" au repos
// (bouton de reinitialisation), ou la valeur EN DIRECT (m / degres) pendant
// qu'on fait glisser CET axe - chacun a son propre canvas puisqu'ils
// n'affichent pas tous la meme chose en meme temps.
// La case (rectangulaire, pas ronde) affiche la valeur EN PERMANENCE - donc
// assez large pour un texte du genre "+0.123m" ou "-180.0°".
var MV_W = 160, MV_H = 64;
function creerMarqueurAxe(couleurAxe) {
  var c = document.createElement('canvas');
  c.width = MV_W; c.height = MV_H;
  var cx = c.getContext('2d');
  var tex = new THREE.CanvasTexture(c);
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.07, 0.07 * MV_H / MV_W, 1);
  s.renderOrder = 999;
  s.userData.canvas = c; s.userData.ctx = cx; s.userData.tex = tex;
  dessinerMarqueurAxe(s, '0', false, couleurAxe);
  return s;
}
// Le cadre et le texte reprennent la couleur de LEUR fleche/anneau (plus
// facile a associer visuellement a l'axe correspondant) - seul le texte
// passe en jaune pendant qu'on glisse CET axe precis, pour garder un signal
// "en cours" clair meme si l'axe est deja une couleur vive.
function dessinerMarqueurAxe(s, texte, actif, couleurAxe) {
  var c = s.userData.canvas, cx = s.userData.ctx;
  var couleurHex = hex(couleurAxe);
  cx.clearRect(0, 0, MV_W, MV_H);
  rr(cx, 3, 3, MV_W - 6, MV_H - 6, 14);
  cx.fillStyle = actif ? 'rgba(70,55,10,0.94)' : 'rgba(20,20,20,0.88)'; cx.fill();
  cx.strokeStyle = couleurHex; cx.lineWidth = actif ? 5 : 2.5; cx.stroke();
  cx.fillStyle = actif ? '#ffee00' : couleurHex;
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.font = 'bold 26px sans-serif';
  cx.fillText(texte, MV_W / 2, MV_H / 2 + 1);
  s.userData.tex.needsUpdate = true;
}
function texteAxeTranslation(lettre) {
  var c = cibleCourante();
  if (!c || !c.userData.origine) return '0';
  var v = c.position[lettre] - c.userData.origine.pos[lettre];
  return (v >= 0 ? '+' : '') + v.toFixed(3) + 'm';
}
function texteAxeRotation(lettre) {
  var c = cibleCourante();
  if (!c || !c.userData.origine) return '0';
  var eActuel  = new THREE.Euler().setFromQuaternion(c.quaternion, 'XYZ');
  var eOrigine = new THREE.Euler().setFromQuaternion(c.userData.origine.quat, 'XYZ');
  var deg = (eActuel[lettre] - eOrigine[lettre]) * 180 / Math.PI;
  return (deg >= 0 ? '+' : '') + deg.toFixed(1) + '°';
}

// Petit bouton RAZ (texture statique partagee - le texte "RAZ" ne change
// jamais, pas besoin d'un canvas par instance comme le marqueur de valeur).
var rzc = document.createElement('canvas');
rzc.width = 64; rzc.height = 64;
var rzctx = rzc.getContext('2d');
rzctx.beginPath(); rzctx.arc(32, 32, 29, 0, Math.PI * 2);
rzctx.fillStyle = 'rgba(70,30,30,0.92)'; rzctx.fill();
rzctx.strokeStyle = '#ff8888'; rzctx.lineWidth = 3; rzctx.stroke();
rzctx.fillStyle = '#ff8888'; rzctx.font = 'bold 15px sans-serif';
rzctx.textAlign = 'center'; rzctx.textBaseline = 'middle';
rzctx.fillText('RAZ', 32, 34);
var matBoutonRAZ = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(rzc), depthTest: false, transparent: true });
function creerBoutonRAZ() {
  var s = new THREE.Sprite(matBoutonRAZ);
  s.scale.set(0.022, 0.022, 0.022);
  // Superpose au coin de la case de valeur (renderOrder 999) : DOIT etre
  // strictement plus eleve, sinon les deux sprites depthTest:false ont un
  // ordre de tri par distance camera quasi identique (ils sont presque au
  // meme endroit) qui peut s'inverser d'une frame a l'autre -> clignotement.
  s.renderOrder = 1000;
  return s;
}

// gizmoTranslate/gizmoRotate sont enfants de anchor (pas de pivot) : ils sont
// repositionnes chaque frame sur la cible courante dans la boucle de rendu.
var gizmoTranslate = new THREE.Group();
var gizmoRotate    = new THREE.Group();
anchor.add(gizmoTranslate, gizmoRotate);
gizmoTranslate.visible = false;
gizmoRotate.visible    = false;

var poignees = [];        // { mesh (sert au raycast), axe, type, axeLettre? }
var marqueursValeur = []; // { sprite, type: 'translate'|'rotate', axeLettre } - affichage seul

AXES.forEach(function (a) {
  var perp = perpendiculaire(a.dir);

  var fleche = creerFleche(a.couleur, 0.006);
  majFleche(fleche, new THREE.Vector3(), a.dir.clone().multiplyScalar(LONGUEUR_FLECHE));
  // Zone cliquable reduite (0.025->0.013) : l'ancienne etait trop genereuse
  // et empietait sur le bouton RAZ voisin, qui pouvait alors recevoir un
  // clic de translation au lieu d'une reinitialisation.
  var halo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.013, 0.013, LONGUEUR_FLECHE, 8),
    new THREE.MeshBasicMaterial({ color: a.couleur, transparent: true, opacity: 0.18, depthTest: false })
  );
  halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir);
  halo.position.copy(a.dir).multiplyScalar(LONGUEUR_FLECHE / 2);
  gizmoTranslate.add(fleche, halo);
  poignees.push({ mesh: halo, axe: a.dir.clone(), type: 'translate', axeLettre: a.nom });

  // La valeur reste affichee en permanence (pas seulement pendant le
  // glissement) ; le bouton RAZ, lui, est une poignee cliquable a part,
  // superposee en haut a droite de la case (cf positionnerBoutonCoin, appele
  // chaque frame dans la boucle de rendu).
  var valeurT = creerMarqueurAxe(a.couleur);
  valeurT.position.copy(a.dir).multiplyScalar(-0.045);
  gizmoTranslate.add(valeurT);
  var razT = creerBoutonRAZ();
  gizmoTranslate.add(razT);
  poignees.push({ mesh: razT, axe: a.dir.clone(), type: 'raz-t', axeLettre: a.nom });
  marqueursValeur.push({ sprite: valeurT, type: 'translate', axeLettre: a.nom, razSprite: razT, couleur: a.couleur });

  var anneau = new THREE.Mesh(
    new THREE.TorusGeometry(RAYON_ANNEAU, 0.006, 8, 32),
    new THREE.MeshBasicMaterial({ color: a.couleur, depthTest: false })
  );
  // Meme reduction de zone cliquable que la translation (0.026->0.014).
  var haloAnneau = new THREE.Mesh(
    new THREE.TorusGeometry(RAYON_ANNEAU, 0.014, 8, 32),
    new THREE.MeshBasicMaterial({ color: a.couleur, transparent: true, opacity: 0.15, depthTest: false })
  );
  var qAnneau = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), a.dir);
  anneau.quaternion.copy(qAnneau);
  haloAnneau.quaternion.copy(qAnneau);
  gizmoRotate.add(anneau, haloAnneau);
  poignees.push({ mesh: haloAnneau, axe: a.dir.clone(), type: 'rotate', axeLettre: a.nom });

  var valeurR = creerMarqueurAxe(a.couleur);
  valeurR.position.copy(perp).multiplyScalar(RAYON_ANNEAU);
  gizmoRotate.add(valeurR);
  var razR = creerBoutonRAZ();
  gizmoRotate.add(razR);
  poignees.push({ mesh: razR, axe: a.dir.clone(), type: 'raz-r', axeLettre: a.nom });
  marqueursValeur.push({ sprite: valeurR, type: 'rotate', axeLettre: a.nom, razSprite: razR, couleur: a.couleur });
});

// Deplace le pivot de la cible courante (et le gizmo, qui le suit puisqu'il
// est resynchronise chaque frame) SANS deplacer visuellement ce qu'elle
// porte : on re-attache ses enfants apres coup, ce qui recalcule leur
// position locale pour compenser.
function reposerCible(pointMonde) {
  var c = cibleCourante(); if (!c) return;
  var local = c.parent.worldToLocal(pointMonde.clone());
  c.position.copy(local);
  c.updateMatrixWorld(true);
  c.children.slice().forEach(function (child) { c.attach(child); });
}

function projeteSurPlan(v, axe) {
  return v.clone().sub(axe.clone().multiplyScalar(v.dot(axe)));
}
function angleSigneAutourAxe(a, b, axe) {
  var croix = new THREE.Vector3().crossVectors(a, b);
  return Math.atan2(croix.dot(axe), a.dot(b));
}

var dragEtat = null;

function demarrerDragTranslate(idx, poignee) {
  var c = cibleCourante(); if (!c) return;
  var p = new THREE.Vector3();
  controllers[idx].getWorldPosition(p);
  var posPivot = new THREE.Vector3();
  c.getWorldPosition(posPivot);
  dragEtat = {
    idx: idx, poignee: poignee, mode: 'translate', axeLettre: poignee.axeLettre,
    posDepartControleur: p, posDepartPivot: posPivot,
    objets: objetsPourUndoAimant(), avant: capturerMatricesMonde(objetsPourUndoAimant())
  };
}
// Deplacement brut de la manette projete sur l'axe (figé au debut du drag,
// exprime dans le repere de l'ancre) : la manette donnant deja une position
// 3D a chaque frame, inutile de chercher le point le plus proche sur une
// droite (technique reservee a une souris 2D sans profondeur).
function majDragTranslate() {
  var c = cibleCourante(); if (!c) return;
  var pActuel = new THREE.Vector3();
  controllers[dragEtat.idx].getWorldPosition(pActuel);
  var delta = pActuel.clone().sub(dragEtat.posDepartControleur);
  var qAncre = new THREE.Quaternion();
  anchor.getWorldQuaternion(qAncre);
  var axeMonde = dragEtat.poignee.axe.clone().applyQuaternion(qAncre);
  var deplacement = axeMonde.multiplyScalar(delta.dot(axeMonde));
  var nouveauMonde = dragEtat.posDepartPivot.clone().add(deplacement);
  c.position.copy(c.parent.worldToLocal(nouveauMonde));
  var aimante = verifierAimantAxe(c, dragEtat.axeLettre, 'translate', controllers[dragEtat.idx]);
  if (aimante && !dragEtat.aimante) vibrerManette(controllers[dragEtat.idx], 0.6, 60);
  dragEtat.aimante = aimante;
}

function demarrerDragRotate(idx, poignee) {
  var c = cibleCourante(); if (!c) return;
  var pivotPos = new THREE.Vector3();
  c.getWorldPosition(pivotPos);
  var pC = new THREE.Vector3();
  controllers[idx].getWorldPosition(pC);
  var qAncre = new THREE.Quaternion();
  anchor.getWorldQuaternion(qAncre);
  var axeMonde = poignee.axe.clone().applyQuaternion(qAncre);
  var qPivot = new THREE.Quaternion();
  c.getWorldQuaternion(qPivot);
  dragEtat = {
    idx: idx, poignee: poignee, mode: 'rotate', axeLettre: poignee.axeLettre,
    axeMonde: axeMonde, pivotPos: pivotPos,
    vDepart: projeteSurPlan(pC.clone().sub(pivotPos), axeMonde).normalize(),
    quatDepartPivot: qPivot,
    objets: objetsPourUndoAimant(), avant: capturerMatricesMonde(objetsPourUndoAimant())
  };
}
// Angle signe autour de l'axe, entre le vecteur de depart et le vecteur
// courant (manette - pivot, projetes sur le plan perpendiculaire a l'axe).
function majDragRotate() {
  var c = cibleCourante(); if (!c) return;
  var pC = new THREE.Vector3();
  controllers[dragEtat.idx].getWorldPosition(pC);
  var vActuel = projeteSurPlan(pC.clone().sub(dragEtat.pivotPos), dragEtat.axeMonde).normalize();
  var angle = angleSigneAutourAxe(dragEtat.vDepart, vActuel, dragEtat.axeMonde);
  var qDelta = new THREE.Quaternion().setFromAxisAngle(dragEtat.axeMonde, angle);
  var qCible = qDelta.multiply(dragEtat.quatDepartPivot);
  var qParentInv = new THREE.Quaternion();
  c.parent.getWorldQuaternion(qParentInv).invert();
  c.quaternion.copy(qParentInv.multiply(qCible));
  var aimante = verifierAimantAxe(c, dragEtat.axeLettre, 'rotate', controllers[dragEtat.idx]);
  if (aimante && !dragEtat.aimante) vibrerManette(controllers[dragEtat.idx], 0.6, 60);
  dragEtat.aimante = aimante;
}

// ============================================================================
//  C. COLORATION
// ============================================================================
var PALETTE = [
  0xffffff, 0x111111, 0xc0392b, 0xe74c3c, 0xe67e22, 0xf1c40f,
  0x2ecc71, 0x16a085, 0x3498db, 0x2c3e8f, 0x9b59b6, 0xe84393
];
var couleurIdx = 2;
function couleurCourante() { return PALETTE[couleurIdx]; }

function remplirPiece(inter) {
  var o = inter.object;
  if (!o.isMesh) return;
  var mat, matIdx;
  if (Array.isArray(o.material)) {
    matIdx = (inter.face && inter.face.materialIndex) || 0;
    if (!o.material[matIdx]) return;
    mat = o.material[matIdx];
  } else {
    matIdx = 0;
    mat = o.material;
  }
  var avant = mat.color.getHex();
  var apres = couleurCourante();
  if (avant === apres) return;
  mat.color.setHex(apres);
  enregistrer({ type: 'couleur', mat: mat, avant: avant, apres: apres, pieceIdx: pieces.indexOf(o), matIdx: matIdx });
}

function colorierAutomatiquement() {
  var total = 0;
  pieces.forEach(function (o) { total += Array.isArray(o.material) ? o.material.length : 1; });
  var i = 0, entrees = [];
  pieces.forEach(function (o) {
    var pieceIdx = pieces.indexOf(o);
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m, matIdx) {
      var avant = m.color.getHex();
      var apres = new THREE.Color().setHSL(i / Math.max(total, 1), 0.65, 0.55).getHex();
      m.color.setHex(apres);
      entrees.push({ mat: m, avant: avant, apres: apres, pieceIdx: pieceIdx, matIdx: matIdx });
      i++;
    });
  });
  if (entrees.length) enregistrer({ type: 'couleur-lot', entrees: entrees });
}

function reinitialiserCouleurs() {
  var entrees = [];
  pieces.forEach(function (o) {
    var orig = o.userData.couleursOrigine;
    if (!orig) return;
    var pieceIdx = pieces.indexOf(o);
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m, i) {
      var avant = m.color.getHex();
      var apres = orig[i];
      if (avant === apres) return;
      m.color.setHex(apres);
      entrees.push({ mat: m, avant: avant, apres: apres, pieceIdx: pieceIdx, matIdx: i });
    });
  });
  if (entrees.length) enregistrer({ type: 'couleur-lot', entrees: entrees });
}

// ============================================================================
//  DIFFUSION TEMPS REEL (ECRAN SPECTATEUR) - optionnelle, degradation
//  silencieuse comme drive-config.js si supabase-config.js n'est pas rempli.
//  Diffuse les actions du casque/telephone (jamais du mode souris - ce n'est
//  pas un emetteur, juste un mode d'utilisation normal) vers un canal
//  Supabase Realtime en mode broadcast (pas d'ecriture en base) ;
//  spectateur.html reconstruit le modele a partir de ces messages. Meme
//  principe que la diffusion deja en production sur VR CEC (peinture.js /
//  spectateur-deco.html), meme projet Supabase, canal dedie.
// ============================================================================
function configSupabaseValide(cle) {
  var cfg = window.SUPABASE_CONFIG;
  return !!(cfg && cfg[cle] && cfg[cle].indexOf('COLLE_') !== 0);
}
var SID = Math.random().toString(36).slice(2, 10);
var canalLive = null;
var diffusionPrete = false;

function initDiffusion() {
  try {
    if (typeof supabase === 'undefined') return;
    if (!configSupabaseValide('url') || !configSupabaseValide('anonKey')) return;
    var client = supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.anonKey);
    canalLive = client.channel(window.SUPABASE_CONFIG.canal || 'visu-cao-live');
    // Un spectateur qui arrive demande l'etat courant : on lui envoie l'instantane.
    canalLive.on('broadcast', { event: 'join' }, function () {
      if (carPret) diffuser('snap', construireSnap());
    });
    canalLive.subscribe(function (statut) { diffusionPrete = (statut === 'SUBSCRIBED'); });
  } catch (e) { canalLive = null; diffusionPrete = false; }
}
function diffuser(evenement, donnees) {
  try {
    if (modeBureau || !canalLive || !diffusionPrete) return;
    canalLive.send({ type: 'broadcast', event: evenement, payload: donnees });
  } catch (e) {}
}
initDiffusion();

// Identifiant stable d'un objet manipulable pour le protocole reseau : 'm'
// pour le modele entier, sinon son index dans piecesMobiles. null = objet
// non reconnu (ne devrait jamais arriver - filtre par securite a l'envoi).
function idDeObjet(o) {
  if (o === racineModele) return 'm';
  var i = piecesMobiles.indexOf(o);
  return i === -1 ? null : i;
}

// Une matrice monde brute inclut le placement AR sur la table (anchor),
// arbitraire et sans interet pour un spectateur qui a son propre point de
// vue en orbite libre. Meme logique que VR CEC qui diffuse ses decalques en
// coordonnees locales a la voiture plutot qu'en coordonnees monde.
// - Le MODELE ENTIER (racineModele) est envoye relatif a l'ANCRE : ca inclut
//   deja tout ce qui compte (echelle+deplacement du pivot, petit decalage de
//   centrage) - le spectateur applique cette valeur telle quelle a son noeud
//   racine (parent = son ancre fixe a l'origine).
// - Une PIECE est envoyee relative au MODELE (racineModele), pas a l'ancre :
//   le spectateur la recompose avec SA PROPRE transformation du modele
//   entier, ce qui reste correct quelle que soit la profondeur de groupes
//   intermediaires dans le GLB entre racineModele et la piece.
function matriceRelativeAncre(matriceMonde) {
  scene.updateMatrixWorld(true);
  return anchor.matrixWorld.clone().invert().multiply(matriceMonde);
}
function matriceRelativeModele(matriceMonde) {
  scene.updateMatrixWorld(true);
  return racineModele.matrixWorld.clone().invert().multiply(matriceMonde);
}
function matriceObjetPourReseau(o, matriceMonde) {
  return (o === racineModele) ? matriceRelativeAncre(matriceMonde) : matriceRelativeModele(matriceMonde);
}

// Diffuse une action deja jouee localement (enregistree, annulee ou refaite) -
// envoie toujours la valeur FINALE resultante, pas un delta : le spectateur
// n'a donc pas besoin de savoir si c'etait un Annuler ou un Refaire.
function diffuserAction(a, versApres) {
  if (a.type === 'transform') {
    var mats = versApres ? a.apres : a.avant;
    var obj = [], m = [];
    a.objets.forEach(function (o, i) {
      var id = idDeObjet(o);
      if (id === null) return;
      obj.push(id); m.push(matriceObjetPourReseau(o, mats[i]).toArray());
    });
    if (obj.length) diffuser('action', { sid: SID, k: 't', obj: obj, m: m });
  } else if (a.type === 'echelle') {
    diffuser('action', { sid: SID, k: 's', v: versApres ? a.apres : a.avant });
  } else if (a.type === 'couleur') {
    diffuser('action', { sid: SID, k: 'c', p: a.pieceIdx, mi: a.matIdx, c: versApres ? a.apres : a.avant });
  } else if (a.type === 'couleur-lot') {
    diffuser('action', { sid: SID, k: 'cb', e: a.entrees.map(function (e) {
      return [e.pieceIdx, e.matIdx, versApres ? e.apres : e.avant];
    }) });
  }
}

// Etat complet courant (pas l'historique) - envoye a un spectateur qui vient
// d'arriver, pour qu'il affiche directement ou en est le modele.
function construireSnap() {
  var colors = [];
  pieces.forEach(function (o, pi) {
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m, mi) { colors.push([pi, mi, m.color.getHex()]); });
  });
  var transforms = [];
  scene.updateMatrixWorld(true);
  if (racineModele) transforms.push(['m', matriceRelativeAncre(racineModele.matrixWorld).toArray()]);
  piecesMobiles.forEach(function (o, i) { transforms.push([i, matriceRelativeModele(o.matrixWorld).toArray()]); });
  return {
    sid: SID, modele: fichierModeleCourant, nom: nomModeleCourant,
    colors: colors, transforms: transforms, echelle: pivot.scale.x
  };
}

// Pose en direct de l'objet en cours de manipulation (gizmo precis ou main
// libre), en plus de la diffusion "action" a la fin du geste - throttle a
// ~10 Hz pour un rendu fluide cote spectateur sans saturer le reseau.
var dernierePoseLiveEnvoi = 0;
function diffuserPoseLiveSiActif(t) {
  if (!dragEtat && grabIdx === -1) return;
  if (t - dernierePoseLiveEnvoi < 90) return;
  dernierePoseLiveEnvoi = t;
  var objets = objetsCiblesActuels();
  if (!objets.length) return;
  var mats = capturerMatricesMonde(objets);
  var obj = [], m = [];
  objets.forEach(function (o, i) {
    var id = idDeObjet(o);
    if (id === null) return;
    obj.push(id); m.push(matriceObjetPourReseau(o, mats[i]).toArray());
  });
  if (obj.length) diffuser('live', { sid: SID, obj: obj, m: m });
}

// Presence legere (~1 Hz) - signale au spectateur que le casque/telephone est
// actif ET quel modele charger (plusieurs modeles possibles ici, contrairement
// a la voiture unique de VR CEC).
var dernierePresEnvoi = 0;
function diffuserPresenceSiActif(t) {
  if (!carPret) return;
  if (t - dernierePresEnvoi < 1000) return;
  dernierePresEnvoi = t;
  diffuser('pres', { sid: SID, modele: fichierModeleCourant, nom: nomModeleCourant });
}

// Position/orientation de la tete (camera) - permet au spectateur d'afficher
// un avatar simple representant l'utilisateur casque/telephone. Relative a
// l'ancre, comme tout le reste (meme raison : la position physique dans la
// piece n'a aucun sens pour le spectateur).
var derniereTeteEnvoi = 0;
function diffuserTeteSiActif(t) {
  if (!carPret) return;
  if (t - derniereTeteEnvoi < 100) return;
  derniereTeteEnvoi = t;
  scene.updateMatrixWorld(true);
  var relatif = anchor.matrixWorld.clone().invert().multiply(camera.matrixWorld);
  var pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  relatif.decompose(pos, quat, scl);
  diffuser('tete', { sid: SID, o: pos.toArray(), q: quat.toArray() });
}

// Etat du laser d'une manette (origine + direction du rayon) - diffuse tant
// que la gachette est tenue, throttle a ~14 Hz ; un message "off" au
// relachement pour que le spectateur l'eteigne (sinon il resterait affiche
// indefiniment a sa derniere position).
var dernierLaserEnvoi = [0, 0];
var laserEtaitDiffuse = [false, false];
function diffuserLaserEtat(idx, ray) {
  if (ray) {
    var t = performance.now();
    if (t - dernierLaserEnvoi[idx] < 70) return;
    dernierLaserEnvoi[idx] = t;
    laserEtaitDiffuse[idx] = true;
    // Origine/direction converties dans le repere de l'ancre (meme raison que
    // matriceRelativeAncre : la position physique dans la piece n'a aucun sens
    // pour le spectateur, qui a sa propre camera libre).
    scene.updateMatrixWorld(true);
    var qAncreInv = anchor.getWorldQuaternion(new THREE.Quaternion()).invert();
    var oLocal = anchor.worldToLocal(ray.ray.origin.clone());
    var dLocal = ray.ray.direction.clone().applyQuaternion(qAncreInv);
    diffuser('laser', { sid: SID, o: oLocal.toArray(), d: dLocal.toArray() });
  } else if (laserEtaitDiffuse[idx]) {
    laserEtaitDiffuse[idx] = false;
    diffuser('laser', { sid: SID, off: true });
  }
}

// ============================================================================
//  MODE (comment on manipule la cible courante)
// ============================================================================
var MODE = { LIBRE: 'libre', GIZMO_T: 'gizmo-t', GIZMO_R: 'gizmo-r', COULEUR: 'couleur', MESURE: 'mesure' };
var mode = MODE.LIBRE;

function definirMode(m) {
  mode = m;
  dragEtat = null;
  viderFantome();
  majPanneau();
}

// ============================================================================
//  MESURES : gachette sur un 1er point, puis un 2eme -> ligne + distance
//  REELLE (pas la distance affichee, qui depend du zoom courant).
//  Chaque mesure prise est GARDEE dans un historique (mesures[]), consultable
//  et rappelable depuis le sous-menu "Mesures" de la roue - une seule mesure
//  est affichee dans la scene a la fois. Une petite croix, superposee en haut
//  a droite de la case, supprime la mesure actuellement affichee.
//  Chaque point est enregistre en coordonnees LOCALES par rapport a la piece
//  visee au clic (pas en coordonnees monde figees) : la mesure SUIT donc le
//  modele (et chaque piece deplacee independamment) a chaque deplacement,
//  zoom ou RAZ - la distance affichee est recalculee EN DIRECT, chaque frame,
//  a partir de la position monde ACTUELLE de la/les piece(s) mesuree(s).
// ============================================================================
var mesures         = [];    // historique complet : { id, p0: {mesh,local}, p1: {mesh,local} }
var mesureIdSuivant  = 1;
var mesureActiveId   = null; // id de la mesure actuellement affichee (ou null)
var mesureEnCours    = [];   // points deja poses pour la mesure en train d'etre prise
var mesurePointMarkers = []; // petites spheres 3D de la mesure affichee
var mesureLigne = null;
var mesureLabel = null;
var mesureCroix = null;

// Bouton croix (texture statique partagee, meme principe que creerBoutonRAZ).
var xzc = document.createElement('canvas');
xzc.width = 48; xzc.height = 48;
var xzctx = xzc.getContext('2d');
xzctx.beginPath(); xzctx.arc(24, 24, 21, 0, Math.PI * 2);
xzctx.fillStyle = 'rgba(70,20,20,0.95)'; xzctx.fill();
xzctx.strokeStyle = '#ff8888'; xzctx.lineWidth = 3; xzctx.stroke();
xzctx.strokeStyle = '#fff'; xzctx.lineWidth = 4; xzctx.lineCap = 'round';
xzctx.beginPath(); xzctx.moveTo(15, 15); xzctx.lineTo(33, 33); xzctx.moveTo(33, 15); xzctx.lineTo(15, 33); xzctx.stroke();
var matCroix = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(xzc), depthTest: false, transparent: true });
function creerCroix() {
  var s = new THREE.Sprite(matCroix);
  s.scale.set(0.026, 0.026, 0.026);
  s.renderOrder = 1402;
  return s;
}

function majPositionCroixMesure() {
  // Decalage reduit dans les memes proportions que l'etiquette (0.075/0.1).
  positionnerBoutonCoin(mesureCroix, mesureLabel, 0.0345, 0.011);
}
// Position monde ACTUELLE d'un point de mesure, recalculee a partir de la
// piece a laquelle il est rattache (peut avoir bouge depuis la prise).
function pointMondeMesure(pt) {
  return pt.mesh.localToWorld(pt.local.clone());
}
function distanceMesureActuelle(m) {
  var p0 = pointMondeMesure(m.p0), p1 = pointMondeMesure(m.p1);
  // Independante du zoom d'affichage courant : cf pourcentageEchelle(),
  // meme logique de conversion (echelle initiale x zoom courant).
  return (p0.distanceTo(p1) / (echelleInitiale * pivot.scale.x)) * 1000;
}

// Etiquette de distance avec son propre canvas (comme creerMarqueurAxe) -
// necessaire pour pouvoir redessiner le texte chaque frame (la distance
// change en direct si la/les piece(s) mesuree(s) bougent).
function creerEtiquetteMesure() {
  var c = document.createElement('canvas');
  c.width = 220; c.height = 76;
  var cx = c.getContext('2d');
  var tex = new THREE.CanvasTexture(c);
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  // Plus petite (0.1->0.075) et plus transparente (cf dessinerEtiquetteMesure)
  // qu'avant - elle masquait trop le modele derriere.
  s.scale.set(0.075, 0.075 * 76 / 220, 1);
  s.renderOrder = 1401;
  s.userData.canvas = c; s.userData.ctx = cx; s.userData.tex = tex;
  return s;
}
function dessinerEtiquetteMesure(s, texte) {
  var c = s.userData.canvas, cx = s.userData.ctx;
  cx.clearRect(0, 0, c.width, c.height);
  rr(cx, 2, 2, c.width - 4, c.height - 4, 14); cx.fillStyle = 'rgba(20,20,20,0.55)'; cx.fill();
  rr(cx, 2, 2, c.width - 4, c.height - 4, 14); cx.strokeStyle = '#ffee00'; cx.lineWidth = 3; cx.stroke();
  cx.fillStyle = '#ffee00'; cx.font = 'bold 30px sans-serif';
  cx.textAlign = 'center'; cx.textBaseline = 'middle';
  cx.fillText(texte, c.width / 2, c.height / 2 + 3);
  s.userData.tex.needsUpdate = true;
}

// Enleve les objets 3D de la mesure actuellement AFFICHEE (pas l'historique).
function nettoyerAffichageMesure() {
  mesurePointMarkers.forEach(function (m) { scene.remove(m); });
  mesurePointMarkers = [];
  if (mesureLigne) { scene.remove(mesureLigne); mesureLigne.geometry.dispose(); mesureLigne = null; }
  if (mesureLabel) { scene.remove(mesureLabel); mesureLabel = null; }
  if (mesureCroix) { scene.remove(mesureCroix); mesureCroix = null; }
  mesureActiveId = null;
}
// Supprime TOUT l'historique (utilise a la fin d'une session / en remettant
// le modele sur la table).
function effacerMesure() {
  nettoyerAffichageMesure();
  mesureEnCours = [];
  mesures = [];
}

function afficherMesureParId(id) {
  var existe = mesures.some(function (m) { return m.id === id; });
  if (!existe) return;
  nettoyerAffichageMesure();
  mesureActiveId = id;

  [0, 1].forEach(function () {
    var marqueur = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffee00, depthTest: false })
    );
    marqueur.renderOrder = 1399;
    scene.add(marqueur);
    mesurePointMarkers.push(marqueur);
  });

  var geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  mesureLigne = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee00, depthTest: false }));
  mesureLigne.renderOrder = 1400;
  scene.add(mesureLigne);

  mesureLabel = creerEtiquetteMesure();
  scene.add(mesureLabel);

  mesureCroix = creerCroix();
  scene.add(mesureCroix);

  majAffichageMesureActive();
  majPanneau();
}

// Appele CHAQUE FRAME (tant qu'une mesure est affichee) : recalcule les
// positions monde des 2 points a partir de leur piece (qui a pu bouger) et
// redessine la ligne/l'etiquette/la croix en consequence.
function majAffichageMesureActive() {
  if (mesureActiveId == null) return;
  var m = null;
  for (var i = 0; i < mesures.length; i++) { if (mesures[i].id === mesureActiveId) { m = mesures[i]; break; } }
  if (!m) return;
  var p0 = pointMondeMesure(m.p0), p1 = pointMondeMesure(m.p1);

  mesurePointMarkers[0].position.copy(p0);
  mesurePointMarkers[1].position.copy(p1);

  var pos = mesureLigne.geometry.attributes.position;
  pos.setXYZ(0, p0.x, p0.y, p0.z);
  pos.setXYZ(1, p1.x, p1.y, p1.z);
  pos.needsUpdate = true;
  mesureLigne.geometry.computeBoundingSphere();

  var distanceMm = (p0.distanceTo(p1) / (echelleInitiale * pivot.scale.x)) * 1000;
  dessinerEtiquetteMesure(mesureLabel, distanceMm.toFixed(1) + ' mm');
  mesureLabel.position.copy(p0).add(p1).multiplyScalar(0.5);

  majPositionCroixMesure();
}

// Clic sur la croix : supprime la mesure affichee DE L'HISTORIQUE (pas
// seulement de l'affichage).
function supprimerMesureActive() {
  if (mesureActiveId == null) return;
  var idASupprimer = mesureActiveId;
  mesures = mesures.filter(function (m) { return m.id !== idASupprimer; });
  nettoyerAffichageMesure();
  majPanneau();
}

function indexMesureActive() {
  for (var i = 0; i < mesures.length; i++) { if (mesures[i].id === mesureActiveId) return i; }
  return -1;
}
function mesureSuivante() {
  if (!mesures.length) return;
  var i = (indexMesureActive() + 1 + mesures.length) % mesures.length;
  afficherMesureParId(mesures[i].id);
}
function mesurePrecedente() {
  if (!mesures.length) return;
  var i = (indexMesureActive() - 1 + mesures.length) % mesures.length;
  afficherMesureParId(mesures[i].id);
}

function gererClicMesure(inter) {
  // Point enregistre en LOCAL par rapport a la piece visee (pas en monde
  // fige) : c'est ce qui permet a la mesure de suivre le modele ensuite.
  var mesh = inter.object;
  var local = mesh.worldToLocal(inter.point.clone());
  if (mesureEnCours.length === 0) nettoyerAffichageMesure(); // on quitte l'affichage precedent
  mesureEnCours.push({ mesh: mesh, local: local });
  if (mesureEnCours.length === 1) {
    var marqueur = new THREE.Mesh(
      new THREE.SphereGeometry(0.006, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xffee00, depthTest: false })
    );
    marqueur.position.copy(inter.point);
    marqueur.renderOrder = 1399;
    scene.add(marqueur);
    mesurePointMarkers.push(marqueur);
  } else {
    var entree = { id: mesureIdSuivant++, p0: mesureEnCours[0], p1: mesureEnCours[1] };
    mesures.push(entree);
    mesureEnCours = [];
    afficherMesureParId(entree.id);
  }
}

// ============================================================================
//  CAPTURE D'AFFICHAGE : "Cadre" (vise et prend une photo) + "Fond" (ce qui
//  apparait derriere le modele sur la photo).
//  ATTENTION - limite technique connue (deja rencontree sur VR CEC) : WebXR
//  ne donne PAS acces aux pixels reels du passthrough a une page web (raison
//  de securite/vie privee, pas un choix d'implementation ici). "Realite
//  augmentee" utilise donc un fond transparent en secours (le plus proche
//  possible du reel avec les moyens disponibles), PAS le vrai flux camera.
// ============================================================================
var fondCapture = 'ar';  // 'ar' (transparent) ou 'vr' (bleu GMP)
var COULEUR_FOND_VR = 0x2f8fd6;

var modePhoto = false;
var camPhoto = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 20);
var previewPhoto = null;

// Texte d'aide en mode "Cadre", attache a la CAMERA (suit toujours le regard,
// contrairement a l'ancien cadre jaune fixe sur une manette). Statique (pas
// besoin de redessiner a chaque frame), mais cache PENDANT la passe de
// capture hors-ecran de capturerPhoto() - donc n'apparait jamais sur la
// photo enregistree, meme si le texte est visible en continu a l'ecran.
var APC_W = 820, APC_H = 120;
var apc = document.createElement('canvas');
apc.width = APC_W; apc.height = APC_H;
var apctx = apc.getContext('2d');
var texAidePhoto = new THREE.CanvasTexture(apc);
var textePhoto = new THREE.Sprite(new THREE.SpriteMaterial({ map: texAidePhoto, depthTest: false, transparent: true }));
textePhoto.scale.set(0.42, 0.42 * APC_H / APC_W, 1);
textePhoto.position.set(0, -0.15, -0.4);
textePhoto.renderOrder = 1999;
textePhoto.visible = false;
camera.add(textePhoto);
rr(apctx, 2, 2, APC_W - 4, APC_H - 4, 18); apctx.fillStyle = 'rgba(20,20,20,0.85)'; apctx.fill();
rr(apctx, 2, 2, APC_W - 4, APC_H - 4, 18); apctx.strokeStyle = '#ffee00'; apctx.lineWidth = 3; apctx.stroke();
apctx.fillStyle = '#ffee00';
apctx.textAlign = 'center'; apctx.textBaseline = 'middle';
// Reduit la police si besoin pour que les 2 lignes ne soient jamais coupees,
// quelles que soient les metriques de police du navigateur/systeme.
var lignes = ['Regardez ce que vous voulez prendre en photo', 'et appuyez sur la gachette'];
var taillePolice = 26;
do {
  apctx.font = 'bold ' + taillePolice + 'px sans-serif';
  var largeurMax = Math.max(apctx.measureText(lignes[0]).width, apctx.measureText(lignes[1]).width);
  if (largeurMax <= APC_W - 40) break;
  taillePolice -= 1;
} while (taillePolice > 12);
apctx.fillText(lignes[0], APC_W / 2, APC_H / 2 - 16);
apctx.fillText(lignes[1], APC_W / 2, APC_H / 2 + 16);
texAidePhoto.needsUpdate = true;

// Flash blanc plein ecran simulant une prise de photo - un quad attache a
// la CAMERA (donc toujours "devant les yeux" quelle que soit la direction du
// regard), rendu SEULEMENT dans les frames normales (jamais dans la passe
// hors-ecran de capturerPhoto, qui a deja fini de lire ses pixels avant que
// declencherFlash() ne soit appele - donc pas de risque de flash visible
// DANS la photo elle-meme).
var flashPhoto = new THREE.Mesh(
  new THREE.PlaneGeometry(4, 4),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false })
);
flashPhoto.position.set(0, 0, -0.3);
flashPhoto.renderOrder = 2000;
camera.add(flashPhoto);
function declencherFlash() { flashPhoto.material.opacity = 0.85; }
// Appele chaque frame (boucle de rendu) : fondu exponentiel, pas besoin de
// suivre un delta de temps pour un effet purement cosmetique.
function majFlash() {
  if (flashPhoto.material.opacity <= 0.002) { flashPhoto.material.opacity = 0; return; }
  flashPhoto.material.opacity *= 0.82;
}

// Etiquette "ANNULE : ..." / "RETABLI : ..." qui reste affichee 1 seconde
// (temps REEL, pas un nombre de frames - le Quest peut tourner a 72/90/120Hz)
// a chaque annuler/refaire, quel que soit le declencheur (joystick, bouton
// du menu, barre bureau). Attachee a la camera comme le flash photo.
var icIndic = document.createElement('canvas');
icIndic.width = 360; icIndic.height = 90;
var ictxIndic = icIndic.getContext('2d');
var texIndic = new THREE.CanvasTexture(icIndic);
var indicAction = new THREE.Sprite(new THREE.SpriteMaterial({ map: texIndic, depthTest: false, transparent: true }));
indicAction.scale.set(0.2, 0.2 * 90 / 360, 1);
indicAction.position.set(0, 0.09, -0.4);
indicAction.renderOrder = 2001;
indicAction.visible = false;
camera.add(indicAction);
var indicActionJusqua = 0;
function libelleTypeAction(a) {
  switch (a && a.type) {
    case 'transform':    return 'deplacement';
    case 'echelle':       return 'zoom';
    case 'couleur':        return 'couleur';
    case 'couleur-lot':      return 'couleur';
    default: return '';
  }
}
function afficherIndicateurAction(titre, sousTitre) {
  ictxIndic.clearRect(0, 0, 360, 90);
  rr(ictxIndic, 2, 2, 356, 86, 18); ictxIndic.fillStyle = 'rgba(20,20,20,0.92)'; ictxIndic.fill();
  rr(ictxIndic, 2, 2, 356, 86, 18); ictxIndic.strokeStyle = '#ffee00'; ictxIndic.lineWidth = 3; ictxIndic.stroke();
  ictxIndic.fillStyle = '#ffee00'; ictxIndic.textAlign = 'center';
  ictxIndic.font = 'bold 28px sans-serif'; ictxIndic.textBaseline = 'middle';
  ictxIndic.fillText(titre, 180, sousTitre ? 34 : 46);
  if (sousTitre) {
    ictxIndic.font = '20px sans-serif';
    ictxIndic.fillText(sousTitre, 180, 64);
  }
  texIndic.needsUpdate = true;
  indicAction.visible = true;
  indicActionJusqua = performance.now() + 1000;
}
function majIndicateurAction(tempsActuel) {
  if (indicAction.visible && tempsActuel > indicActionJusqua) indicAction.visible = false;
}

function entrerModePhoto() { modePhoto = true; textePhoto.visible = true; }
function sortirModePhoto() { modePhoto = false; textePhoto.visible = false; }

function fermerApercuPhoto() {
  if (!previewPhoto) return;
  anchor.remove(previewPhoto);
  previewPhoto.material.map.dispose();
  previewPhoto.material.dispose();
  previewPhoto = null;
}
function afficherApercuPhoto(cv) {
  fermerApercuPhoto();
  var texP = new THREE.CanvasTexture(cv);
  previewPhoto = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3 * cv.height / cv.width),
    new THREE.MeshBasicMaterial({ map: texP, transparent: true, depthTest: false })
  );
  previewPhoto.position.set(0, 0.65, 0);
  previewPhoto.renderOrder = 1500;
  anchor.add(previewPhoto);
}

// Envoi (fire-and-forget) de la photo a l'Apps Script configure dans
// drive-config.js. Un simple fetch POST texte/JSON - pas de popup de
// connexion, donc ca ne casse pas une session WebXR immersive en cours (une
// authentification OAuth classique, elle, le ferait). Echoue en silence si
// Drive n'est pas configure ou si le reseau/l'Apps Script ne repond pas :
// l'apercu flottant existant reste le retour visuel garanti dans tous les cas.
function televerserPhotoDrive(cv) {
  if (!configDriveValide('photoUploadUrl')) return;
  var cfg = window.DRIVE_CONFIG;
  var base64 = cv.toDataURL('image/png').split(',')[1];
  var nom = 'photo-' + (nomModeleCourant || 'modele').replace(/[^a-zA-Z0-9-_]+/g, '_') +
    '-' + new Date().toISOString().replace(/[:.]/g, '-') + '.png';
  fetch(cfg.photoUploadUrl, {
    method: 'POST',
    body: JSON.stringify({ secret: cfg.photoSecret, image: base64, nom: nom })
  }).catch(function () {});
}

// Capture hors-ecran a la pose de tete courante (camera est deja synchronisee
// sur la tete par Three.js pendant une session XR active). Meme technique que
// VR CEC/peinture.js : rendu dans une cible hors ecran, renderer.xr.enabled
// mis a false le temps du rendu (sinon le moteur substitue la camera casque).
function capturerPhoto() {
  if (!carPret) { sortirModePhoto(); return; }
  flashPhoto.material.opacity = 0; // au cas ou un flash precedent n'ait pas fini de s'estomper
  var L = 512, H = 384;
  camPhoto.aspect = L / H;
  camPhoto.position.copy(camera.position);
  camPhoto.quaternion.copy(camera.quaternion);
  camPhoto.updateProjectionMatrix();
  camPhoto.updateMatrixWorld(true);

  var visRoue = roue.visible, visGT = gizmoTranslate.visible, visGR = gizmoRotate.visible;
  var visTexte = textePhoto.visible, visMarq = marqueursValeur.map(function (m) { return m.sprite.visible; });
  roue.visible = false; gizmoTranslate.visible = false; gizmoRotate.visible = false; textePhoto.visible = false;

  var rt = new THREE.WebGLRenderTarget(L, H);
  var xrEtait = renderer.xr.enabled;
  var couleurAvant = new THREE.Color(); renderer.getClearColor(couleurAvant);
  var alphaAvant = renderer.getClearAlpha();

  renderer.xr.enabled = false;
  renderer.setRenderTarget(rt);
  if (fondCapture === 'vr') renderer.setClearColor(COULEUR_FOND_VR, 1);
  else renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camPhoto);
  renderer.setRenderTarget(null);
  renderer.setClearColor(couleurAvant, alphaAvant);
  renderer.xr.enabled = xrEtait;

  roue.visible = visRoue; gizmoTranslate.visible = visGT; gizmoRotate.visible = visGR; textePhoto.visible = visTexte;

  var buf = new Uint8Array(L * H * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, L, H, buf);
  rt.dispose();

  var cv = document.createElement('canvas'); cv.width = L; cv.height = H;
  var c2 = cv.getContext('2d');
  var img = c2.createImageData(L, H);
  for (var y = 0; y < H; y++) {
    var src = (H - 1 - y) * L * 4;
    img.data.set(buf.subarray(src, src + L * 4), y * L * 4);
  }
  c2.putImageData(img, 0, 0);
  afficherApercuPhoto(cv);
  televerserPhotoDrive(cv);
  sortirModePhoto();
  declencherFlash();
}

// ============================================================================
//  MENU RADIAL - disque attache a la main gauche par defaut (deplacable sur
//  l'autre main par un clic de joystick), pointe et valide avec la gachette
//  de l'AUTRE manette. Remplace le panneau plat des versions precedentes.
//  Arborescence figee ici, une seule fois (dessin ET clic la relisent).
// ============================================================================
// "accent" : une couleur par categorie racine (retour utilisateur "une
// couleur par cercle") - appliquee au cercle lui-meme (fond) sur ce noeud ET
// sur tous ses descendants, pour reperer d'un coup d'oeil dans quelle
// branche on se trouve. Le fil "actif" (yeux appuye dessus) reste indique
// UNIQUEMENT par l'anneau jaune epais, plus par un changement de fond -
// sinon les deux se marcheraient dessus.
var MENU_RACINE = [
  { label: 'Couleurs', icone: 'palette', accent: '#993556', sub: [
      { label: 'Automatique', icone: 'pinceau', action: colorierAutomatiquement },
      { label: 'Manuel', icone: 'pinceau', action: function () { definirMode(MODE.COULEUR); }, couleurs: true },
      { label: 'RAZ', icone: 'reset', action: reinitialiserCouleurs }
  ] },
  { label: 'Deplacements', icone: 'deplacer', accent: '#185fa5', sub: [
      { label: 'Libre', icone: 'deplacer', action: revenirLibre },
      { label: 'Precis', icone: 'cible', sub: [
          { label: 'Translation', icone: 'flechedouble', action: function () { definirMode(MODE.GIZMO_T); } },
          { label: 'Rotation',    icone: 'reset',        action: function () { definirMode(MODE.GIZMO_R); } }
      ] },
      { label: 'RAZ generale', texte: 'RAZ tout', icone: 'reset', action: razGenerale }
  ] },
  { label: 'Mesures', texte: 'Mesures', icone: 'regle', accent: '#0f6e56', action: function () { definirMode(MODE.MESURE); }, mesures: true },
  { label: 'Annuler / Refaire / Quitter / Remettre', texte: 'Actions', icone: 'undo', accent: '#534ab7', sub: [
      { label: 'Annuler', icone: 'undo', action: annuler },
      { label: 'Refaire', icone: 'redo', action: retablir },
      { label: 'Quitter', icone: 'porte', action: quitterAR },
      { label: 'Remettre sur la table', texte: 'Remettre', icone: 'table', action: replacer }
  ] },
  { label: "Capture d'affichage", texte: 'Capture', icone: 'camera', accent: '#854f0b', sub: [
      { label: 'Cadre', icone: 'camera', action: entrerModePhoto },
      { label: 'Fond', icone: 'image', sub: [
          { label: 'Realite virtuelle',  texte: 'Bleu GMP', action: function () { fondCapture = 'vr'; } },
          { label: 'Realite augmentee',  texte: 'Reel (AR)', action: function () { fondCapture = 'ar'; } }
      ] }
  ] }
];

var roueStack = [];    // navigation (drill-down) : pile des noeuds "sub" ouverts
var menuCtrlIdx = 0;   // manette qui porte le menu - main gauche par defaut
var summonPrev  = [false, false];

// Cercles agrandis (RHUB/RRING/RNODE) et disque physique plus grand (0.27 au
// lieu de 0.22) suite au retour "pas assez lisible" apres le premier essai
// au casque.
var RCV = 600, RHUB = 100, RRING = 190, RNODE = 96;
var rc = document.createElement('canvas'); rc.width = RCV; rc.height = RCV;
var rctx = rc.getContext('2d');
var rtex = new THREE.CanvasTexture(rc);
var roue = new THREE.Mesh(
  new THREE.PlaneGeometry(0.27, 0.27),
  new THREE.MeshBasicMaterial({ map: rtex, transparent: true, depthTest: false, side: THREE.DoubleSide })
);
roue.renderOrder = 1200;
roue.visible = false;

var panneauSale = true;      // nom garde pour tous les appels existants ;
function majPanneau() { panneauSale = true; }   // marque desormais la ROUE a redessiner

// Logo GMP au centre du menu racine (retour utilisateur "logo GMP a la
// place du texte MENU") - charge une fois, redessine la roue des que
// disponible (elle peut deja avoir ete dessinee avec le texte de secours
// avant la fin du chargement).
var logoRoueImg = new Image();
var logoRoueChargee = false;
logoRoueImg.onload = function () { logoRoueChargee = true; majPanneau(); };
logoRoueImg.src = 'gmp-logo.png';

// Racine de la branche courante (roueStack[0]) : porte la couleur "accent"
// a appliquer a TOUS les noeuds de cette branche, a n'importe quelle
// profondeur - au niveau racine, chaque noeud garde sa PROPRE couleur.
function accentBrancheCourante() {
  return roueStack.length ? roueStack[0].accent : null;
}
// Reduit la taille de police jusqu'a ce que le texte tienne dans la largeur
// donnee (retour utilisateur : le texte depassait des cercles) - jamais en
// dessous de 10px pour rester lisible.
function ajusterPoliceRoue(texte, largeurMax, tailleDepart) {
  var taille = tailleDepart;
  rctx.font = 'bold ' + taille + 'px sans-serif';
  while (taille > 10 && rctx.measureText(texte).width > largeurMax) {
    taille -= 1;
    rctx.font = 'bold ' + taille + 'px sans-serif';
  }
  return taille;
}

var _palRoueNodes = null;
function noeudsRoue() {
  var v = roueStack.length ? roueStack[roueStack.length - 1] : null;
  if (v && v.couleurs) {
    if (!_palRoueNodes) _palRoueNodes = PALETTE.map(function (couleur, i) { return { couleur: couleur, idx: i }; });
    return _palRoueNodes;
  }
  if (v && v.mesures) {
    // Liste dynamique de l'historique des mesures - reconstruite a chaque
    // ouverture puisque de nouvelles mesures peuvent avoir ete prises entre
    // temps (pas de cache, contrairement a la palette qui ne change jamais).
    return mesures.map(function (m, i) {
      return { label: (i + 1) + ' : ' + distanceMesureActuelle(m).toFixed(0) + ' mm', mesureId: m.id };
    });
  }
  return v ? v.sub : MENU_RACINE;
}
function centresRoue(list) {
  var n = list.length, out = [], c = RCV / 2;
  for (var i = 0; i < n; i++) {
    var ang = -Math.PI / 2 + i * (2 * Math.PI / n);
    out.push({ node: list[i], x: c + Math.cos(ang) * RRING, y: c + Math.sin(ang) * RRING });
  }
  return out;
}
// Identifiant STABLE d'un noeud, utilise pour comparer "ce qui est vise" au
// fil des frames - un simple === sur l'objet ne marche pas pour les listes
// regenerees a chaque appel (palette figee mais mesures reconstruites a
// chaque fois : 2 objets differents pour la MEME mesure d'un appel a l'autre).
function identifiantNoeud(node) {
  if (node === 'back') return 'back';
  if (!node) return null;
  if (node.couleur !== undefined) return 'coul-' + node.idx;
  if (node.mesureId !== undefined) return 'mes-' + node.mesureId;
  return 'lbl-' + node.label;
}
var idHoverRoue = null;
// Sonde chaque frame (pas seulement au clic) ce que l'AUTRE manette (celle
// qui ne porte pas le menu) vise sur le disque, pour le mettre en
// surbrillance AVANT que l'utilisateur appuie sur la gachette.
function pollSurvolRoue() {
  if (!roue.visible) {
    if (idHoverRoue !== null) { idHoverRoue = null; majPanneau(); }
    return;
  }
  var ray = rayonDe(controllers[1 - menuCtrlIdx]);
  var hits = ray.intersectObject(roue, false);
  var nouvelId = (hits.length && hits[0].uv) ? identifiantNoeud(zoneRoue(hits[0].uv)) : null;
  if (nouvelId !== idHoverRoue) { idHoverRoue = nouvelId; majPanneau(); }
}

function estActifRoue(node) {
  if (node.mesureId !== undefined) return node.mesureId === mesureActiveId;
  switch (node.label) {
    case 'Libre':                  return mode === MODE.LIBRE;
    case 'Translation':          return mode === MODE.GIZMO_T;
    case 'Rotation':              return mode === MODE.GIZMO_R;
    case 'Manuel':                 return mode === MODE.COULEUR;
    case 'Mesures':                 return mode === MODE.MESURE;
    case 'Realite virtuelle':        return fondCapture === 'vr';
    case 'Realite augmentee':         return fondCapture === 'ar';
    default: return false;
  }
}
function cerclePlein(x, y, r) { rctx.beginPath(); rctx.arc(x, y, r, 0, Math.PI * 2); rctx.closePath(); }

// ============================================================================
//  PETITES ICONES DU MENU RADIAL - dessinees au trait sur le meme canvas 2D
//  que le reste (pas de fichier image a charger), pour repondre au retour
//  "je voudrais des petites icones en plus du texte".
// ============================================================================
function dessinerPointeFleche(x, y, angle, taille) {
  rctx.save(); rctx.translate(x, y); rctx.rotate(angle);
  rctx.beginPath(); rctx.moveTo(0, 0); rctx.lineTo(-taille, -taille * 0.6); rctx.lineTo(-taille, taille * 0.6); rctx.closePath();
  rctx.fill();
  rctx.restore();
}
function dessinerFlecheCourbe(cx, cy, s, sens) {
  var a0 = sens > 0 ? Math.PI * 1.15 : -0.15, a1 = sens > 0 ? -0.15 : Math.PI * 1.15;
  rctx.beginPath(); rctx.arc(cx, cy, s * 0.6, a0, a1, sens < 0); rctx.stroke();
  var ax = cx + Math.cos(a1) * s * 0.6, ay = cy + Math.sin(a1) * s * 0.6;
  dessinerPointeFleche(ax, ay, a1 + (sens > 0 ? -Math.PI / 2 : Math.PI / 2), s * 0.3);
}
function dessinerCroixDeplacement(cx, cy, s) {
  [0, Math.PI / 2, Math.PI, -Math.PI / 2].forEach(function (a) {
    var x = cx + Math.cos(a) * s * 0.8, y = cy + Math.sin(a) * s * 0.8;
    rctx.beginPath(); rctx.moveTo(cx, cy); rctx.lineTo(x, y); rctx.stroke();
    dessinerPointeFleche(x, y, a, s * 0.28);
  });
}
function dessinerIcone(cle, cx, cy, s) {
  rctx.save();
  rctx.strokeStyle = '#fff'; rctx.fillStyle = '#fff';
  rctx.lineWidth = Math.max(2, s * 0.16); rctx.lineCap = 'round'; rctx.lineJoin = 'round';
  if (cle === 'palette') {
    rctx.beginPath(); rctx.arc(cx, cy + s * 0.1, s * 0.75, 0.15 * Math.PI, 0.95 * Math.PI, true); rctx.stroke();
    [[-0.5, -0.1, '#e74c3c'], [0, -0.55, '#2ecc71'], [0.5, -0.1, '#3498db']].forEach(function (p) {
      rctx.beginPath(); rctx.arc(cx + p[0] * s, cy + p[1] * s, s * 0.17, 0, Math.PI * 2); rctx.fillStyle = p[2]; rctx.fill();
    });
  } else if (cle === 'pinceau') {
    rctx.beginPath(); rctx.moveTo(cx - s * 0.55, cy + s * 0.6); rctx.lineTo(cx + s * 0.5, cy - s * 0.55); rctx.stroke();
    rctx.beginPath(); rctx.arc(cx + s * 0.55, cy - s * 0.6, s * 0.16, 0, Math.PI * 2); rctx.fill();
  } else if (cle === 'reset') {
    dessinerFlecheCourbe(cx, cy, s, 1);
  } else if (cle === 'undo') {
    dessinerFlecheCourbe(cx, cy, s, -1);
  } else if (cle === 'redo') {
    dessinerFlecheCourbe(cx, cy, s, 1);
  } else if (cle === 'deplacer') {
    dessinerCroixDeplacement(cx, cy, s);
  } else if (cle === 'cible') {
    rctx.beginPath(); rctx.arc(cx, cy, s * 0.6, 0, Math.PI * 2); rctx.stroke();
    rctx.beginPath();
    rctx.moveTo(cx - s * 0.85, cy); rctx.lineTo(cx - s * 0.35, cy);
    rctx.moveTo(cx + s * 0.35, cy); rctx.lineTo(cx + s * 0.85, cy);
    rctx.moveTo(cx, cy - s * 0.85); rctx.lineTo(cx, cy - s * 0.35);
    rctx.moveTo(cx, cy + s * 0.35); rctx.lineTo(cx, cy + s * 0.85);
    rctx.stroke();
  } else if (cle === 'flechedouble') {
    rctx.beginPath(); rctx.moveTo(cx - s * 0.7, cy); rctx.lineTo(cx + s * 0.7, cy); rctx.stroke();
    dessinerPointeFleche(cx - s * 0.7, cy, Math.PI, s * 0.35);
    dessinerPointeFleche(cx + s * 0.7, cy, 0, s * 0.35);
  } else if (cle === 'regle') {
    rctx.strokeRect(cx - s * 0.75, cy - s * 0.35, s * 1.5, s * 0.7);
    for (var i = -2; i <= 2; i++) {
      rctx.beginPath(); rctx.moveTo(cx + i * s * 0.3, cy - s * 0.35); rctx.lineTo(cx + i * s * 0.3, cy - s * 0.02); rctx.stroke();
    }
  } else if (cle === 'porte') {
    rctx.strokeRect(cx - s * 0.55, cy - s * 0.75, s * 0.75, s * 1.5);
    rctx.beginPath(); rctx.moveTo(cx - s * 0.1, cy); rctx.lineTo(cx + s * 0.75, cy); rctx.stroke();
    dessinerPointeFleche(cx + s * 0.75, cy, 0, s * 0.3);
  } else if (cle === 'table') {
    rctx.beginPath();
    rctx.moveTo(cx - s * 0.8, cy - s * 0.3); rctx.lineTo(cx + s * 0.8, cy - s * 0.3);
    rctx.moveTo(cx - s * 0.6, cy - s * 0.3); rctx.lineTo(cx - s * 0.6, cy + s * 0.7);
    rctx.moveTo(cx + s * 0.6, cy - s * 0.3); rctx.lineTo(cx + s * 0.6, cy + s * 0.7);
    rctx.stroke();
  } else if (cle === 'camera') {
    rctx.strokeRect(cx - s * 0.75, cy - s * 0.45, s * 1.5, s * 0.9);
    rctx.strokeRect(cx - s * 0.25, cy - s * 0.65, s * 0.5, s * 0.2);
    rctx.beginPath(); rctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2); rctx.stroke();
  } else if (cle === 'image') {
    rctx.strokeRect(cx - s * 0.75, cy - s * 0.55, s * 1.5, s * 1.1);
    rctx.beginPath(); rctx.arc(cx - s * 0.35, cy - s * 0.15, s * 0.16, 0, Math.PI * 2); rctx.stroke();
    rctx.beginPath();
    rctx.moveTo(cx - s * 0.6, cy + s * 0.4); rctx.lineTo(cx - s * 0.1, cy - s * 0.1);
    rctx.lineTo(cx + s * 0.2, cy + s * 0.15); rctx.lineTo(cx + s * 0.6, cy - s * 0.25); rctx.lineTo(cx + s * 0.6, cy + s * 0.4);
    rctx.closePath(); rctx.stroke();
  }
  rctx.restore();
}

function dessinerRoue() {
  panneauSale = false;
  var c = RCV / 2;
  rctx.clearRect(0, 0, RCV, RCV);
  rctx.fillStyle = 'rgba(16,20,26,0.92)';
  cerclePlein(c, c, RRING + RNODE / 2 + 14); rctx.fill();
  rctx.strokeStyle = '#2f8fd6'; rctx.lineWidth = 3;
  cerclePlein(c, c, RRING + RNODE / 2 + 14); rctx.stroke();

  var list = noeudsRoue();
  centresRoue(list).forEach(function (p) {
    var survole = idHoverRoue !== null && identifiantNoeud(p.node) === idHoverRoue;
    if (p.node.couleur !== undefined) {
      rctx.fillStyle = hex(p.node.couleur);
      cerclePlein(p.x, p.y, RNODE / 2); rctx.fill();
      rctx.strokeStyle = (p.node.idx === couleurIdx) ? '#ffee00' : '#3a4553';
      rctx.lineWidth = (p.node.idx === couleurIdx) ? 5 : 2;
      cerclePlein(p.x, p.y, RNODE / 2); rctx.stroke();
      if (survole) { rctx.strokeStyle = '#ffffff'; rctx.lineWidth = 6; cerclePlein(p.x, p.y, RNODE / 2 + 8); rctx.stroke(); }
      return;
    }
    var actif = estActifRoue(p.node);
    // Couleur du cercle = identite de branche (retour utilisateur "une
    // couleur par cercle") : propre a chaque noeud racine, ou heritee de la
    // racine de branche a toute profondeur en dessous. Le fil "actif" n'est
    // plus indique par un changement de fond (sinon ca ecraserait cette
    // couleur), seulement par l'anneau jaune epais ci-dessous.
    rctx.fillStyle = p.node.accent || accentBrancheCourante() || '#242c37';
    cerclePlein(p.x, p.y, RNODE / 2); rctx.fill();
    rctx.strokeStyle = actif ? '#ffee00' : '#3a4553';
    rctx.lineWidth = actif ? 5 : 2;
    cerclePlein(p.x, p.y, RNODE / 2); rctx.stroke();
    // Surbrillance de VISEE (distincte du "actif" ci-dessus) : un anneau
    // blanc supplementaire, plus grand, pour qu'on voie TOUJOURS lequel le
    // rayon vise en ce moment - avant meme d'appuyer sur la gachette.
    if (survole) { rctx.strokeStyle = '#ffffff'; rctx.lineWidth = 6; cerclePlein(p.x, p.y, RNODE / 2 + 8); rctx.stroke(); }
    // Petite icone au-dessus du texte (si ce noeud en a une) : le texte
    // descend d'autant pour lui laisser la place.
    var avecIcone = !!p.node.icone;
    if (avecIcone) dessinerIcone(p.node.icone, p.x, p.y - 22, 15);
    var decalageY = avecIcone ? 18 : 0;

    rctx.fillStyle = '#fff'; rctx.textAlign = 'center';
    var texteNoeud = p.node.texte || p.node.label;
    // Largeur max = corde du cercle a la hauteur du texte, avec une marge -
    // sinon un libelle un peu long depasse visuellement du cercle (retour
    // utilisateur).
    var largeurMaxTexte = RNODE * 0.82;
    var mots = texteNoeud.split(' ');
    if (mots.length === 1) {
      ajusterPoliceRoue(texteNoeud, largeurMaxTexte, texteNoeud.length > 9 ? 15 : 18);
      rctx.fillText(texteNoeud, p.x, p.y + 6 + decalageY);
    } else {
      // Repartit les mots sur 2 lignes en equilibrant leur longueur (plutot
      // que de toujours couper apres le 1er mot) - plus lisible pour les
      // libelles a plusieurs mots.
      var meilleureCoupe = 1, meilleurEcart = 1e9;
      for (var s = 1; s < mots.length; s++) {
        var l1 = mots.slice(0, s).join(' ').length, l2 = mots.slice(s).join(' ').length;
        var ecart = Math.abs(l1 - l2);
        if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleureCoupe = s; }
      }
      var ligne1 = mots.slice(0, meilleureCoupe).join(' '), ligne2 = mots.slice(meilleureCoupe).join(' ');
      var tailleCommune = Math.min(
        ajusterPoliceRoue(ligne1, largeurMaxTexte, 15),
        ajusterPoliceRoue(ligne2, largeurMaxTexte, 15)
      );
      rctx.font = 'bold ' + tailleCommune + 'px sans-serif';
      rctx.fillText(ligne1, p.x, p.y - 10 + decalageY);
      rctx.fillText(ligne2, p.x, p.y + 10 + decalageY);
    }
  });

  var survoleHub = idHoverRoue === 'back';
  cerclePlein(c, c, RHUB);
  rctx.fillStyle = survoleHub ? 'rgba(50,70,95,0.98)' : 'rgba(28,34,44,0.96)'; rctx.fill();
  rctx.strokeStyle = survoleHub ? '#ffffff' : '#2f8fd6';
  rctx.lineWidth = survoleHub ? 5 : 2;
  cerclePlein(c, c, RHUB); rctx.stroke();
  if (roueStack.length) {
    rctx.fillStyle = '#fff'; rctx.font = 'bold 16px sans-serif'; rctx.textAlign = 'center';
    rctx.fillText('< RETOUR', c, c + 6);
  } else if (logoRoueChargee) {
    // Logo GMP a la place du texte "MENU" (retour utilisateur), garde ses
    // proportions naturelles.
    var logoL = RHUB * 1.15, logoH = logoL * (logoRoueImg.naturalHeight / logoRoueImg.naturalWidth);
    rctx.drawImage(logoRoueImg, c - logoL / 2, c - logoH / 2, logoL, logoH);
  } else {
    rctx.fillStyle = '#fff'; rctx.font = 'bold 16px sans-serif'; rctx.textAlign = 'center';
    rctx.fillText('MENU', c, c + 6);
  }

  rtex.needsUpdate = true;
}

function zoneRoue(uv) {
  var c = RCV / 2, cx = uv.x * RCV, cy = (1 - uv.y) * RCV;
  if (Math.hypot(cx - c, cy - c) < RHUB) return 'back';
  var best = null, bd = 1e9;
  centresRoue(noeudsRoue()).forEach(function (p) {
    var d = Math.hypot(cx - p.x, cy - p.y);
    if (d < bd) { bd = d; best = p; }
  });
  return (best && bd < RNODE * 0.9) ? best.node : null;
}

// Ne revient JAMAIS automatiquement en arriere apres une action - seul le
// bouton central "< RETOUR" (ou "back" ci-dessous) fait remonter d'un
// niveau, a chaque niveau, meme apres avoir declenche une action terminale.
function traiterClicRoue(zone) {
  if (!zone) return;
  if (zone === 'back') {
    var noeudQuitte = roueStack[roueStack.length - 1];
    roueStack.pop();
    // Quitter le sous-menu Mesures desarme le mode mesure ET cache la
    // mesure actuellement affichee (ligne/etiquette/points/croix) : sinon
    // un clic sur le modele continuait a prendre des points, ET la mesure
    // precedente restait visible dans la scene alors que le menu est deja
    // referme, ce qui est trompeur dans les deux cas.
    if (noeudQuitte && noeudQuitte.mesures) {
      if (mode === MODE.MESURE) definirMode(MODE.LIBRE);
      nettoyerAffichageMesure();
    }
    majPanneau();
    return;
  }
  if (zone.couleur !== undefined) { couleurIdx = zone.idx; majPanneau(); return; }
  if (zone.mesureId !== undefined) { afficherMesureParId(zone.mesureId); return; }
  if (zone.action) zone.action();
  if (zone.sub || zone.mesures || zone.couleurs) roueStack.push(zone);
  majPanneau();
}

// ============================================================================
//  MANETTES
// ============================================================================
var controllers = [renderer.xr.getController(0), renderer.xr.getController(1)];
var raycaster   = new THREE.Raycaster();
var tempMatrix  = new THREE.Matrix4();

function rayonDe(ctrl) {
  tempMatrix.identity().extractRotation(ctrl.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  raycaster.far = 3;
  // OBLIGATOIRE pour tester un clic sur un THREE.Sprite (les marqueurs "0") :
  // sans ceci, Sprite.raycast() plante (raycaster.camera est null), ce qui
  // interrompt TOUT intersectObjects() de la liste - y compris les vraies
  // poignees de translation/rotation testees dans le meme appel.
  raycaster.camera = camera;
  return raycaster;
}

function gererSelectStart(idx, ctrl) {
  if (!anchorPlaced) {
    anchorPlaced    = true;
    reticle.visible = false;
    preview.visible = false;
    return;
  }
  if (!carPret) return;

  var ray = rayonDe(ctrl);

  if (previewPhoto) {
    var hitsApercu = ray.intersectObject(previewPhoto, false);
    if (hitsApercu.length) { fermerApercuPhoto(); return; }
  }

  if (mesureCroix) {
    var hitsCroix = ray.intersectObject(mesureCroix, false);
    if (hitsCroix.length) { supprimerMesureActive(); return; }
  }

  if (roue.visible) {
    var hitsRoue = ray.intersectObject(roue, false);
    if (hitsRoue.length && hitsRoue[0].uv) {
      traiterClicRoue(zoneRoue(hitsRoue[0].uv));
      return;
    }
  }

  if (modePhoto) { capturerPhoto(); return; }

  // A tenu + gachette = (de)selectionner une piece, prioritaire sur tout le
  // reste (gizmo, couleur...).
  if (boutonAppuye(ctrl, 4)) { gererClicSelection(ray); return; }

  if (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R) {
    var typeActif = (mode === MODE.GIZMO_T) ? 'translate' : 'rotate';
    var typeRAZ   = (mode === MODE.GIZMO_T) ? 'raz-t' : 'raz-r';
    var poigneesActives = poignees.filter(function (pg) { return pg.type === typeActif || pg.type === typeRAZ; });
    var hitsPoignee = ray.intersectObjects(poigneesActives.map(function (pg) { return pg.mesh; }), false);
    if (hitsPoignee.length) {
      var poignee = poigneesActives.filter(function (pg) { return pg.mesh === hitsPoignee[0].object; })[0];
      if (poignee.type === 'raz-t') { resetAxeTranslation(poignee.axeLettre); return; }
      if (poignee.type === 'raz-r') { resetAxeRotation(poignee.axeLettre); return; }
      if (mode === MODE.GIZMO_T) demarrerDragTranslate(idx, poignee);
      else demarrerDragRotate(idx, poignee);
      return;
    }
    if (pieces.length) {
      var hitsModele = ray.intersectObjects(pieces, false);
      if (hitsModele.length) reposerCible(hitsModele[0].point);
    }
    return;
  }

  if (mode === MODE.COULEUR && pieces.length) {
    var hitsModele2 = ray.intersectObjects(pieces, false);
    if (hitsModele2.length) remplirPiece(hitsModele2[0]);
    return;
  }

  if (mode === MODE.MESURE && pieces.length) {
    var hitsMesure = ray.intersectObjects(pieces, false);
    if (hitsMesure.length) gererClicMesure(hitsMesure[0]);
    return;
  }
  // MODE.LIBRE : rien au clic gachette, la saisie se fait au grip - sauf sur
  // telephone, qui n'a pas de capteur de prehension : le tap+glisser reprend
  // exactement la logique du grip (squeezestart plus bas), simplement
  // declenchee par 'select' au lieu de 'squeeze'.
  if (modeTelephone && mode === MODE.LIBRE && grabIdx === -1 && !modeZoom) {
    var cLibre = cibleCourante();
    if (cLibre) {
      var pLibre = new THREE.Vector3();
      ctrl.getWorldPosition(pLibre);
      if (cibleActive() || pointDeGrabProche(pLibre)) {
        grabIdx = idx;
        grabAvant = capturerMatricesMonde(objetsPourUndoAimant());
        ctrl.attach(cLibre);
      }
    }
  }
}

// Lit l'etat d'un bouton de la manette (A/X = bouton 4 sur le mapping
// standard WebXR "xr-standard" des manettes Quest) - WebXR n'a pas
// d'evenement natif pour ce bouton, il faut lire le Gamepad a la demande.
function boutonAppuye(ctrl, index) {
  try {
    var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
    return !!(gp && gp.buttons && gp.buttons[index] && gp.buttons[index].pressed);
  } catch (e) { return false; }
}

// Le menu est attache a la main gauche par defaut ; un clic de joystick
// (bouton 3, meme mapping que VR CEC/peinture.js) sur l'AUTRE manette le
// deplace dessus - pratique pour les gauchers ou selon la tache en cours.
function pollAppelRoue() {
  controllers.forEach(function (ctrl, i) {
    var pressed = boutonAppuye(ctrl, 3);
    if (pressed && !summonPrev[i] && menuCtrlIdx !== i) {
      menuCtrlIdx = i;
      ctrl.add(roue);
      roue.position.set(0, 0.06, -0.04);
      roue.rotation.x = -0.5;
      roueStack = [];
      majPanneau();
    }
    summonPrev[i] = pressed;
  });
}

// Annuler/Refaire au joystick gauche/droite (axes[2] = axe X du pouce),
// UNIQUEMENT depuis la manette qui porte le menu (menuCtrlIdx) - sur
// demande explicite, pour eviter tout conflit avec l'autre manette (qui
// sert a pointer/valider). Un seul declenchement par poussee (rearme quand
// le joystick revient pres du centre), pour ne pas annuler 60 fois par
// seconde tant qu'on le maintient. Reste egalement disponible dans le menu
// Actions.
var UNDO_REDO_SEUIL = 0.6;
var undoRedoArme = [true, true];
function pollUndoRedoJoystick() {
  var i = menuCtrlIdx;
  var ctrl = controllers[i];
  var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
  var x = (gp && gp.axes && gp.axes.length > 2) ? (gp.axes[2] || 0) : 0;
  if (Math.abs(x) < UNDO_REDO_SEUIL * 0.5) { undoRedoArme[i] = true; return; }
  if (!undoRedoArme[i]) return;
  undoRedoArme[i] = false;
  if (x <= -UNDO_REDO_SEUIL) annuler();
  else if (x >= UNDO_REDO_SEUIL) retablir();
}

// Laser + pointeur : visibles EN PERMANENCE des que le modele est charge
// (plus seulement gachette tenue). Avant, comme l'action (peindre/mesurer/
// RAZ...) se declenche DES l'appui de la gachette, le laser n'apparaissait
// qu'au moment meme du clic - trop tard pour "voir ce qu'on vise" avant
// d'agir, cause probable du retour "on voit mal ce que vise la manette".
// Trait plus discret hors gachette tenue, pleine intensite pendant (glisser
// un gizmo, etc.) pour distinguer visuellement les deux etats.
var selectTenu = [false, false];
var pieceSurvolee          = [null, null]; // mesh individuel actuellement vise, par manette
var objetSurvolePrecedent  = [null, null]; // poignee/bouton RAZ du gizmo actuellement vise
var ECHELLE_SURVOL = 1.3;

// Surbrillance d'un MESH individuel (teinte emissive) - au niveau du mesh et
// non de la "piece racine", pour marcher meme sur un modele sans piecesMobiles
// (comme le modele de demo) et parce que colorer/mesurer visent deja le mesh.
// Ignoree si ce mesh appartient a une piece deja selectionnee (A+gachette),
// dont la teinte ambre de selection ne doit pas etre ecrasee.
function appliquerSurvolPiece(idx, mesh) {
  var precedent = pieceSurvolee[idx];
  if (precedent && precedent !== mesh) {
    var autreIdx = 1 - idx;
    var encoreVise = pieceSurvolee[autreIdx] === precedent;
    var estSelectionne = selection.indexOf(trouverPieceRacine(precedent)) !== -1;
    if (!encoreVise && !estSelectionne) {
      var matsPrec = Array.isArray(precedent.material) ? precedent.material : [precedent.material];
      matsPrec.forEach(function (m) { if (m.emissive) m.emissive.setHex(0x000000); });
    }
  }
  pieceSurvolee[idx] = mesh;
  if (mesh && selection.indexOf(trouverPieceRacine(mesh)) === -1) {
    var mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(function (m) { if (m.emissive) m.emissive.setHex(0x2255aa); });
  }
}

// Surbrillance d'une poignee/bouton RAZ du gizmo : agrandissement (marche
// meme quand le materiau est PARTAGE entre plusieurs instances, comme les
// boutons RAZ - modifier sa couleur/opacite affecterait les 6 a la fois,
// modifier .scale ne touche QUE l'objet vise) + boost d'opacite du halo
// SEULEMENT s'il a son propre materiau (les halos de fleche/anneau, pas
// les sprites RAZ).
function restaurerSurvolObjet(objet) {
  if (objet.userData.echelleBase) objet.scale.copy(objet.userData.echelleBase);
  if (objet.userData.opaciteBase !== undefined) objet.material.opacity = objet.userData.opaciteBase;
}
function appliquerSurvolObjet(idx, objet) {
  var precedent = objetSurvolePrecedent[idx];
  if (precedent && precedent !== objet) {
    var autreIdx = 1 - idx;
    if (objetSurvolePrecedent[autreIdx] !== precedent) restaurerSurvolObjet(precedent);
  }
  objetSurvolePrecedent[idx] = objet;
  if (objet) {
    if (!objet.userData.echelleBase) objet.userData.echelleBase = objet.scale.clone();
    objet.scale.copy(objet.userData.echelleBase).multiplyScalar(ECHELLE_SURVOL);
    if (objet.isMesh) {
      if (objet.userData.opaciteBase === undefined) objet.userData.opaciteBase = objet.material.opacity;
      objet.material.opacity = Math.min(1, objet.userData.opaciteBase * 2.5 + 0.15);
    }
  }
}

function majLaser(idx) {
  var ctrl = controllers[idx];
  var laser = ctrl.userData.laser, point = ctrl.userData.pointeurLaser;
  ctrl.userData.pieceLaser = null;
  if (!carPret || !anchorPlaced) {
    laser.visible = false; point.visible = false;
    appliquerSurvolPiece(idx, null);
    appliquerSurvolObjet(idx, null);
    diffuserLaserEtat(idx, null);
    return;
  }
  var ray = rayonDe(ctrl);
  diffuserLaserEtat(idx, selectTenu[idx] ? ray : null);

  // Cibles pointables : les pieces + les poignees/RAZ du gizmo actuellement
  // affiche (sinon impossible de survoler un bouton RAZ avant de cliquer).
  var ciblesGizmo = [];
  if (gizmoTranslate.visible) {
    poignees.forEach(function (pg) { if (pg.type === 'translate' || pg.type === 'raz-t') ciblesGizmo.push(pg.mesh); });
  }
  if (gizmoRotate.visible) {
    poignees.forEach(function (pg) { if (pg.type === 'rotate' || pg.type === 'raz-r') ciblesGizmo.push(pg.mesh); });
  }
  var hits = ray.intersectObjects(ciblesGizmo.concat(pieces), false);

  laser.visible = true;
  laser.material.opacity = selectTenu[idx] ? 0.9 : 0.4;
  laser.scale.z = hits.length ? hits[0].distance : 3;
  point.visible = hits.length > 0;

  if (!hits.length) {
    appliquerSurvolPiece(idx, null);
    appliquerSurvolObjet(idx, null);
    return;
  }
  var objet = hits[0].object;
  point.position.copy(hits[0].point);
  if (pieces.indexOf(objet) !== -1) {
    ctrl.userData.pieceLaser = trouverPieceRacine(objet);
    appliquerSurvolPiece(idx, objet);
    appliquerSurvolObjet(idx, null);
  } else {
    appliquerSurvolObjet(idx, objet);
    appliquerSurvolPiece(idx, null);
  }
}

controllers.forEach(function (ctrl, idx) {
  scene.add(ctrl);
  var geoL = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  var ligne = new THREE.Line(geoL, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  ligne.scale.z = 1.5;
  ctrl.add(ligne);

  var geoLaser = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  var laser = new THREE.Line(geoLaser, new THREE.LineBasicMaterial({ color: 0xff2222, transparent: true, opacity: 0.9, depthTest: false }));
  laser.renderOrder = 997;
  laser.visible = false;
  ctrl.add(laser);
  ctrl.userData.laser = laser;
  var pointeurLaser = new THREE.Mesh(
    new THREE.SphereGeometry(0.0027, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xff2222, depthTest: false })
  );
  pointeurLaser.renderOrder = 998;
  pointeurLaser.visible = false;
  scene.add(pointeurLaser);
  ctrl.userData.pointeurLaser = pointeurLaser;

  // Le menu est attache par defaut a controllers[0] (fallback en attendant
  // de connaitre la vraie latéralité), puis recale sur la VRAIE main gauche
  // des que WebXR la signale (handedness n'est connu qu'a la connexion).
  if (idx === 0) { ctrl.add(roue); roue.position.set(0, 0.06, -0.04); roue.rotation.x = -0.5; }

  ctrl.addEventListener('connected', function (e) {
    ctrl.userData.src = e.data;
    if (e.data.handedness === 'left' && menuCtrlIdx !== idx) {
      menuCtrlIdx = idx;
      ctrl.add(roue);
      roue.position.set(0, 0.06, -0.04);
      roue.rotation.x = -0.5;
    }
  });
  ctrl.addEventListener('disconnected', function ()  { ctrl.userData.src = null; });

  ctrl.addEventListener('squeezestart', function () {
    if (!anchorPlaced) return;
    gripEtat[idx] = true;
    if (gripEtat[0] && gripEtat[1]) {
      if (grabIdx !== -1) terminerGrab();
      demarrerZoom();
      return;
    }
    // Le grip attrape la cible courante quel que soit le mode d'action de la
    // gachette (precision/couleur/mesure) - plus de restriction a MAIN LIBRE
    // depuis que ce n'est plus un onglet a part.
    if (grabIdx !== -1 || modeZoom) return;

    var c = cibleCourante();
    if (!c) return;
    var p = new THREE.Vector3();
    ctrl.getWorldPosition(p);
    // Une selection deja faite (A+gachette) est saisissable de n'importe ou -
    // elle a ete choisie deliberement au laser. Sans selection, on saisit le
    // modele entier, qui lui garde l'exigence de proximite (main proche).
    if (cibleActive() || pointDeGrabProche(p)) {
      grabIdx = idx;
      grabAvant = capturerMatricesMonde(objetsPourUndoAimant());
      ctrl.attach(c);
      grabAimante = false;
    }
  });
  ctrl.addEventListener('squeezeend', function () {
    gripEtat[idx] = false;
    if (modeZoom) { if (!gripEtat[0] && !gripEtat[1]) terminerZoom(); return; }
    if (grabIdx !== idx) return;
    terminerGrab();
  });

  ctrl.addEventListener('selectstart', function () {
    selectTenu[idx] = true;
    gererSelectStart(idx, ctrl);
  });
  ctrl.addEventListener('selectend', function () {
    selectTenu[idx] = false;
    if (modeTelephone && grabIdx === idx) terminerGrab();
    if (dragEtat && dragEtat.idx === idx) {
      var apres = capturerMatricesMonde(dragEtat.objets);
      enregistrerTransformSiChange(dragEtat.objets, dragEtat.avant, apres);
      dragEtat = null;
      viderFantome();
    }
  });
});

// ============================================================================
//  BOUCLE DE RENDU
// ============================================================================
var dernierTemps = null;
renderer.setAnimationLoop(function (time, frame) {
  // Delta de temps REEL (pas un nombre fixe de frames) - le Quest peut
  // tourner a 72/90/120Hz, un reglage en VITESSE (transparence) doit rester
  // a la meme vitesse perçue quel que soit le taux de rafraichissement.
  // Plafonne a 0.1s pour eviter un saut apres un long arret (onglet en
  // arriere-plan, etc).
  var dt = dernierTemps === null ? 0 : Math.min(0.1, (time - dernierTemps) / 1000);
  dernierTemps = time;
  majIndicateurAction(time);

  if (frame && !anchorPlaced) {
    var session  = renderer.xr.getSession();
    var refSpace = renderer.xr.getReferenceSpace();

    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true;
      try {
        session.requestReferenceSpace('viewer').then(function (viewerSpace) {
          session.requestHitTestSource({ space: viewerSpace }).then(function (source) {
            hitTestSource = source;
          }).catch(function () {});
        }).catch(function () {});
      } catch (e) {}
      session.addEventListener('end', function () {
        hitTestSourceRequested = false;
        hitTestSource = null;
      });
    }

    var cible    = new THREE.Vector3();
    var surTable = false;
    if (hitTestSource && refSpace) {
      var hits = frame.getHitTestResults(hitTestSource);
      if (hits.length > 0) {
        var pose = hits[0].getPose(refSpace);
        reticle.matrix.fromArray(pose.transform.matrix);
        cible.setFromMatrixPosition(reticle.matrix);
        surTable = true;
      }
    }
    if (!surTable) {
      // Sur telephone, controllers[0] ne represente une position que PENDANT
      // un toucher (source d'entree tactile transitoire, pas une manette
      // suivie en continu) - se rabattre sur la camera pour un apercu de pose
      // coherent avant le 1er tap.
      if (modeTelephone) camera.getWorldPosition(cible);
      else controllers[0].getWorldPosition(cible);
    }

    preview.position.copy(cible);
    preview.visible = true;
    anchor.position.copy(cible);
    if (surTable) anchor.quaternion.setFromRotationMatrix(reticle.matrix);
    anchor.visible = true;
  }

  if (anchorPlaced) {
    preview.visible = false;
    roue.visible = carPret && !modeBureau && !modeTelephone;
  }

  if (modeBureau) majCameraBureau();

  if (modeZoom) majZoom();
  if (dragEtat) { if (dragEtat.mode === 'translate') majDragTranslate(); else majDragRotate(); }
  if (grabIdx !== -1) majAimantGrab();
  diffuserPoseLiveSiActif(time);
  diffuserPresenceSiActif(time);
  diffuserTeteSiActif(time);
  if (flashPhoto.material.opacity > 0) majFlash();
  if (mesureActiveId != null) {
    // Une piece a pu bouger juste au-dessus (grip, zoom, glissement gizmo) :
    // sans ce rafraichissement la mesure lirait une matrixWorld perimee d'une
    // frame (meme piege que le mecanisme Annuler/Refaire, cf plus haut).
    scene.updateMatrixWorld(true);
    majAffichageMesureActive();
  }

  // Gizmo : visible seulement si une cible existe, repositionne sur elle
  // chaque frame (enfant de anchor, donc taille ecran stable et toujours
  // aligne sur la table sans calcul de contre-rotation).
  var cibleActuelle = cibleCourante();
  var gizmoActif = !!cibleActuelle && (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R);
  gizmoTranslate.visible = gizmoActif && mode === MODE.GIZMO_T;
  gizmoRotate.visible    = gizmoActif && mode === MODE.GIZMO_R;
  if (gizmoActif) {
    var posMonde = new THREE.Vector3();
    cibleActuelle.getWorldPosition(posMonde);
    var posLocale = anchor.worldToLocal(posMonde);
    gizmoTranslate.position.copy(posLocale);
    gizmoRotate.position.copy(posLocale);
    // On vient de changer la position du gizmo cette meme frame : sa
    // matrixWorld (et celle de ses enfants) est donc perimee tant que
    // renderer.render() n'a pas tourne - necessaire ici puisque
    // positionnerBoutonCoin() lit/ecrit des positions MONDE juste apres.
    scene.updateMatrixWorld(true);

    // Valeur toujours affichee (pas seulement pendant le glissement),
    // surlignee en jaune quand on est en train de glisser CET axe precis ;
    // le bouton RAZ est superpose en haut a droite de sa case.
    marqueursValeur.forEach(function (mv) {
      var dragActuel = dragEtat || dragBureau;    // manette (VR) ou souris (bureau)
      var modeGlisse = dragEtat ? dragEtat.mode : (dragBureau ? dragBureau.type : null);
      var actif = !!(dragActuel && dragActuel.axeLettre === mv.axeLettre && modeGlisse === mv.type);
      var texte = mv.type === 'translate' ? texteAxeTranslation(mv.axeLettre) : texteAxeRotation(mv.axeLettre);
      dessinerMarqueurAxe(mv.sprite, texte, actif, mv.couleur);
      positionnerBoutonCoin(mv.razSprite, mv.sprite, 0.028, 0.012);
    });
  }

  // A tenu + selection : le joystick regle la transparence des pieces
  // choisies (l'appui deux mains simultane est reserve au zoom). La
  // selection elle-meme PERSISTE apres avoir relache A (cf revenirLibre) -
  // sinon la manipulation precise d'un groupe est impossible des qu'on lache
  // A pour utiliser le gizmo a la gachette.
  // Sans rien tenir d'autre : viser une piece au laser (gachette tenue) et
  // pousser le joystick haut/bas regle SA transparence directement, sans
  // passer par une selection A+gachette au prealable.
  if (!modeBureau && !modeTelephone) {
    pollAppelRoue();
    pollUndoRedoJoystick();
    pollSurvolRoue();
    var transpAffichee = false;
    controllers.forEach(function (ctrl, ci) {
      majLaser(ci);
      var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
      if (boutonAppuye(ctrl, 4) && selection.length) {
        if (gp && gp.axes && gp.axes.length > 3) {
          var t = gp.axes[3] || 0;
          if (Math.abs(t) > 0.08) {
            var texteSel = ajusterNiveauTransparence(etatTranspSelection, t, dt, appliquerTransparenceSelection);
            afficherLabelTransparence(selection[0], texteSel);
            transpAffichee = true;
          }
        }
      } else if (selectTenu[ci] && ctrl.userData.pieceLaser) {
        var tLaser = (gp && gp.axes && gp.axes.length > 3) ? (gp.axes[3] || 0) : 0;
        if (Math.abs(tLaser) > 0.08) {
          var piece = ctrl.userData.pieceLaser;
          var texteLaser = ajusterNiveauTransparence(piece.userData, tLaser, dt,
            function (op) { appliquerTransparencePiece(piece, op); });
          afficherLabelTransparence(piece, texteLaser);
          transpAffichee = true;
        }
      }
    });
    if (!transpAffichee) spriteTransp.visible = false;
  }

  if (panneauSale && !modeTelephone) dessinerRoue();
  if (modeBureau || modeTelephone) majBarreBureau();

  renderer.render(scene, camera);
});

// Certains casques/navigateurs rejettent la session en bloc si UNE SEULE
// fonctionnalite optionnelle listee n'est pas accordable (alors que la norme
// dit qu'elle devrait juste etre ignoree) : on retente donc avec une
// configuration de plus en plus reduite plutot que d'abandonner d'un coup.
// Partagee entre le bouton casque et le bouton telephone (configs differentes).
function tenterSessionCascade(configs, i) {
  return navigator.xr.requestSession('immersive-ar', configs[i]).catch(function (e) {
    if (i + 1 < configs.length) {
      status.textContent = 'Config AR ' + (i + 1) + ' refusee, nouvel essai...';
      return tenterSessionCascade(configs, i + 1);
    }
    throw e;
  });
}

// --- Bouton "Entrer en realite mixte" ---
document.getElementById('btnCommencer').addEventListener('click', function () {
  var fichier = modeleChoisi.fichier;
  if (!fichier) { status.textContent = 'Choisissez un modele'; return; }
  nomModeleCourant = modeleChoisi.nom;
  historique = []; refaire = [];

  // Seul 'local' est reellement utilise par le code (renderer.xr.setReferenceSpaceType) ;
  // 'hit-test' et 'local-floor' sont un bonus, jamais indispensables.
  var CONFIGS_AR = [
    { optionalFeatures: ['hit-test', 'local-floor', 'local'] },
    { optionalFeatures: ['local'] },
    {}
  ];

  tenterSessionCascade(CONFIGS_AR, 0).then(function (session) {
    status.textContent = 'Session creee !';
    renderer.xr.setSession(session).then(function () {
      overlay.style.display = 'none';
      chargerModele(fichier);

      session.addEventListener('end', function () {
        overlay.style.display = 'flex';
        reinitialiserApresSession();
      });
    }).catch(function (e2) {
      status.textContent = 'Erreur setSession: ' + e2.message;
    });
  }).catch(function (e) {
    status.textContent = 'Erreur AR: ' + e.message;
  });
});

// Remise a zero commune entre la fin d'une session AR et la sortie du mode
// bureau, pour pouvoir choisir un autre modele proprement dans les deux cas.
function reinitialiserApresSession() {
  modeTelephone   = false;
  anchorPlaced    = false;
  anchor.visible  = false;
  reticle.visible = false;
  preview.visible = false;
  roue.visible    = false;
  roueStack = [];
  relacherSelection();
  selection = [];
  piecesSurlignees = [];
  definirMode(MODE.LIBRE);
  grabIdx = -1; grabAvant = null;
  modeZoom = false; gripEtat = [false, false];
  dragBureau = null;
  effacerMesure();
  sortirModePhoto();
  fermerApercuPhoto();

  if (racineModele) { pivot.remove(racineModele); racineModele = null; }
  pieces = [];
  piecesMobiles = [];
  carPret = false;
  pieceSurvolee = [null, null];
  objetSurvolePrecedent = [null, null];
  idHoverRoue = null;
  etatTranspSelection = { niveauTransp: 0 };
  spriteTransp.visible = false;

  // Historique Annuler/Refaire et aimantation : sans ca, changer de modele
  // laissait trainer des references a des objets de l'ANCIEN modele (detache
  // de la scene) - Annuler pouvait sembler ne rien faire, et le fantome
  // d'aimantation pouvait rester construit sur l'ancienne geometrie tant que
  // la meme cible (le pivot, stable d'un modele a l'autre) redeclenchait le
  // cache de construireFantomeSiBesoin().
  historique = []; refaire = [];
  dragEtat = null;
  viderFantome();
  _dernierAimantAxe = null;
  // Fond gris du mode bureau (cf btnBureau) : jamais pertinent en AR/VR, ou
  // la scene doit rester transparente pour laisser voir le passthrough.
  scene.background = null;
}

// ============================================================================
//  MODE BUREAU : meme visionneuse, a la souris, sans casque (navigateur
//  classique). Reutilise TOUT le moteur (pivot, gizmo, coloration, Annuler/
//  Refaire) - seules la camera (orbite souris au lieu de la tete) et les
//  gestes d'entree (souris/clavier au lieu des manettes) sont propres au
//  mode bureau. Le panneau 3D est remplace par la barre HTML #barreBureau.
// ============================================================================
var modeBureau = false;
var modeTelephone = false;
var dragBureau = null;
var orbite = { cible: new THREE.Vector3(0, 0.15, 0), distance: 0.6, yaw: 0.6, tangage: 0.45 };
var etatSourisOrbite = null;
var etatPanSouris = null; // clic molette maintenu = translater la cible (pan)

// Le canvas ne redimensionne jamais son buffer de rendu tout seul (WebXR
// gere ca via le compositeur du casque, mais pas nous en mode bureau) :
// sans ceci il reste a 300x150 par defaut, agrandi en CSS - image floue et
// ratio d'aspect faux, ce qui decale aussi les clics (raycasting).
function redimensionnerBureau() {
  if (!modeBureau) return;
  var w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener('resize', redimensionnerBureau);

function majCameraBureau() {
  var p = orbite.cible.clone();
  var cosT = Math.cos(orbite.tangage);
  p.x += orbite.distance * cosT * Math.sin(orbite.yaw);
  p.y += orbite.distance * Math.sin(orbite.tangage);
  p.z += orbite.distance * cosT * Math.cos(orbite.yaw);
  camera.position.copy(p);
  camera.lookAt(orbite.cible);
}

function rayonSourisDepuis(evt) {
  var rect = canvas.getBoundingClientRect();
  var mx = ((evt.clientX - rect.left) / rect.width) * 2 - 1;
  var my = -((evt.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(new THREE.Vector2(mx, my), camera);
  raycaster.far = 20;
  raycaster.camera = camera; // meme piege que rayonDe() : obligatoire pour les Sprite (marqueurs "0")
  return raycaster;
}

// Point de la droite (axeOrig + t*axeDir) le plus proche du rayon souris -
// equivalent bureau du deplacement par position de manette (une souris n'a
// pas de profondeur, donc pas le choix : on utilise cette technique
// classique plutot que la position brute comme en VR).
function pointProcheAxe(rayOrig, rayDir, axeOrig, axeDir) {
  var w0 = axeOrig.clone().sub(rayOrig);
  var a = axeDir.dot(axeDir), b = axeDir.dot(rayDir), c = rayDir.dot(rayDir);
  var d = axeDir.dot(w0), e = rayDir.dot(w0);
  var denom = a * c - b * b;
  var t = Math.abs(denom) < 1e-6 ? 0 : (b * e - c * d) / denom;
  return axeOrig.clone().add(axeDir.clone().multiplyScalar(t));
}
function pointSurPlan(rayOrig, rayDir, planPoint, planNormale) {
  var denom = planNormale.dot(rayDir);
  if (Math.abs(denom) < 1e-6) return null;
  var t = planNormale.dot(planPoint.clone().sub(rayOrig)) / denom;
  if (t < 0) return null;
  return rayOrig.clone().add(rayDir.clone().multiplyScalar(t));
}

function demarrerDragTranslateSouris(poignee, rayOrig, rayDir) {
  var c = cibleCourante(); if (!c) return;
  var qAncre = new THREE.Quaternion(); anchor.getWorldQuaternion(qAncre);
  var axeMonde = poignee.axe.clone().applyQuaternion(qAncre);
  var origineMonde = c.getWorldPosition(new THREE.Vector3());
  dragBureau = {
    type: 'translate', axeLettre: poignee.axeLettre, axeMonde: axeMonde, posDepartPivot: origineMonde,
    pointDepart: pointProcheAxe(rayOrig, rayDir, origineMonde, axeMonde),
    objets: objetsPourUndoAimant(), avant: capturerMatricesMonde(objetsPourUndoAimant())
  };
}
function demarrerDragRotateSouris(poignee, rayOrig, rayDir) {
  var c = cibleCourante(); if (!c) return;
  var qAncre = new THREE.Quaternion(); anchor.getWorldQuaternion(qAncre);
  var axeMonde = poignee.axe.clone().applyQuaternion(qAncre);
  var pivotPos = c.getWorldPosition(new THREE.Vector3());
  var pt = pointSurPlan(rayOrig, rayDir, pivotPos, axeMonde);
  if (!pt) return;
  dragBureau = {
    type: 'rotate', axeLettre: poignee.axeLettre, axeMonde: axeMonde, pivotPos: pivotPos,
    vDepart: projeteSurPlan(pt.clone().sub(pivotPos), axeMonde).normalize(),
    quatDepartPivot: c.getWorldQuaternion(new THREE.Quaternion()),
    objets: objetsPourUndoAimant(), avant: capturerMatricesMonde(objetsPourUndoAimant())
  };
}
function demarrerDragLibreSouris(pointClic) {
  var c = cibleCourante(); if (!c) return;
  var normale = new THREE.Vector3(); camera.getWorldDirection(normale);
  dragBureau = {
    type: 'libre', plan: { point: pointClic.clone(), normale: normale },
    posDepartPivot: c.getWorldPosition(new THREE.Vector3()),
    objets: objetsPourUndoAimant(), avant: capturerMatricesMonde(objetsPourUndoAimant())
  };
}
function majDragBureau(rayOrig, rayDir) {
  var c = cibleCourante(); if (!c || !dragBureau) return;
  if (dragBureau.type === 'translate') {
    var pt1 = pointProcheAxe(rayOrig, rayDir, dragBureau.posDepartPivot, dragBureau.axeMonde);
    var delta1 = pt1.clone().sub(dragBureau.pointDepart);
    c.position.copy(c.parent.worldToLocal(dragBureau.posDepartPivot.clone().add(delta1)));
    verifierAimantAxe(c, dragBureau.axeLettre, 'translate', null);
  } else if (dragBureau.type === 'rotate') {
    var pt2 = pointSurPlan(rayOrig, rayDir, dragBureau.pivotPos, dragBureau.axeMonde);
    if (!pt2) return;
    var vActuel = projeteSurPlan(pt2.clone().sub(dragBureau.pivotPos), dragBureau.axeMonde).normalize();
    var angle = angleSigneAutourAxe(dragBureau.vDepart, vActuel, dragBureau.axeMonde);
    var qDelta = new THREE.Quaternion().setFromAxisAngle(dragBureau.axeMonde, angle);
    var qCible = qDelta.multiply(dragBureau.quatDepartPivot);
    var qParentInv = new THREE.Quaternion(); c.parent.getWorldQuaternion(qParentInv).invert();
    c.quaternion.copy(qParentInv.multiply(qCible));
    verifierAimantAxe(c, dragBureau.axeLettre, 'rotate', null);
  } else {
    var pt3 = pointSurPlan(rayOrig, rayDir, dragBureau.plan.point, dragBureau.plan.normale);
    if (!pt3) return;
    var delta3 = pt3.clone().sub(dragBureau.plan.point);
    c.position.copy(c.parent.worldToLocal(dragBureau.posDepartPivot.clone().add(delta3)));
    verifierAimantLibreSouris(c);
  }
}
function terminerDragBureau() {
  if (!dragBureau) return;
  var apres = capturerMatricesMonde(dragBureau.objets);
  enregistrerTransformSiChange(dragBureau.objets, dragBureau.avant, apres);
  dragBureau = null;
  viderFantome();
}

canvas.addEventListener('mousedown', function (evt) {
  if (!modeBureau || !anchorPlaced) return;
  if (evt.button === 1) {
    // Clic MOLETTE (bouton du milieu) maintenu = translater la vue (pan),
    // comme dans un logiciel 3D classique - prioritaire sur tout le reste.
    evt.preventDefault();
    etatPanSouris = { x: evt.clientX, y: evt.clientY };
    return;
  }
  var ray = rayonSourisDepuis(evt);

  if (mesureCroix) {
    var hitsCroixB = ray.intersectObject(mesureCroix, false);
    if (hitsCroixB.length) { supprimerMesureActive(); return; }
  }

  if (evt.shiftKey) {
    gererClicSelection(ray);
    return;
  }
  if (evt.ctrlKey || evt.metaKey) {
    if (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R) {
      var typeActif = (mode === MODE.GIZMO_T) ? 'translate' : 'rotate';
      var typeRAZ   = (mode === MODE.GIZMO_T) ? 'raz-t' : 'raz-r';
      var poigneesActives = poignees.filter(function (pg) { return pg.type === typeActif || pg.type === typeRAZ; });
      var hitsPoignee = ray.intersectObjects(poigneesActives.map(function (pg) { return pg.mesh; }), false);
      if (hitsPoignee.length) {
        var poignee = poigneesActives.filter(function (pg) { return pg.mesh === hitsPoignee[0].object; })[0];
        if (poignee.type === 'raz-t') { resetAxeTranslation(poignee.axeLettre); return; }
        if (poignee.type === 'raz-r') { resetAxeRotation(poignee.axeLettre); return; }
        if (mode === MODE.GIZMO_T) demarrerDragTranslateSouris(poignee, ray.ray.origin, ray.ray.direction);
        else demarrerDragRotateSouris(poignee, ray.ray.origin, ray.ray.direction);
        return;
      }
      if (pieces.length) {
        var hitsModele = ray.intersectObjects(pieces, false);
        if (hitsModele.length) reposerCible(hitsModele[0].point);
      }
      return;
    }
    if (mode === MODE.COULEUR && pieces.length) {
      var hitsC = ray.intersectObjects(pieces, false);
      if (hitsC.length) remplirPiece(hitsC[0]);
      return;
    }
    if (mode === MODE.MESURE && pieces.length) {
      var hitsM = ray.intersectObjects(pieces, false);
      if (hitsM.length) gererClicMesure(hitsM[0]);
      return;
    }
    if (mode === MODE.LIBRE && cibleCourante() && pieces.length) {
      var hitsL = ray.intersectObjects(pieces, false);
      if (hitsL.length) demarrerDragLibreSouris(hitsL[0].point);
    }
    return;
  }

  etatSourisOrbite = { x: evt.clientX, y: evt.clientY };
});
canvas.addEventListener('auxclick', function (evt) {
  if (modeBureau && evt.button === 1) evt.preventDefault();
});
window.addEventListener('mousemove', function (evt) {
  if (!modeBureau) return;
  if (etatPanSouris) {
    var dxP = evt.clientX - etatPanSouris.x, dyP = evt.clientY - etatPanSouris.y;
    etatPanSouris = { x: evt.clientX, y: evt.clientY };
    var droite = new THREE.Vector3(), haut = new THREE.Vector3(), avant = new THREE.Vector3();
    camera.matrixWorld.extractBasis(droite, haut, avant);
    var echellePan = orbite.distance * 0.0015;
    orbite.cible.addScaledVector(droite, -dxP * echellePan);
    orbite.cible.addScaledVector(haut, dyP * echellePan);
    return;
  }
  if (dragBureau) {
    var ray = rayonSourisDepuis(evt);
    majDragBureau(ray.ray.origin, ray.ray.direction);
    return;
  }
  if (etatSourisOrbite) {
    var dx = evt.clientX - etatSourisOrbite.x, dy = evt.clientY - etatSourisOrbite.y;
    orbite.yaw -= dx * 0.008;
    orbite.tangage = Math.max(-1.4, Math.min(1.4, orbite.tangage + dy * 0.008));
    etatSourisOrbite = { x: evt.clientX, y: evt.clientY };
  }
});
window.addEventListener('mouseup', function () {
  if (!modeBureau) return;
  if (dragBureau) terminerDragBureau();
  etatSourisOrbite = null;
  etatPanSouris = null;
});
canvas.addEventListener('wheel', function (evt) {
  if (!modeBureau) return;
  evt.preventDefault();
  orbite.distance = Math.max(0.15, Math.min(3, orbite.distance * (1 + evt.deltaY * 0.001)));
}, { passive: false });

// --- Barre d'outils HTML (equivalent bureau du panneau 3D) ---
var barreBureau  = document.getElementById('barreBureau');
var secLibre     = document.getElementById('secLibre');
var secPrecision = document.getElementById('secPrecision');
var secEchelle   = document.getElementById('secEchelle');
var secCouleur   = document.getElementById('secCouleur');
var secCouleur2  = document.getElementById('secCouleur2');
var secMesure    = document.getElementById('secMesure');
var secCapture   = document.getElementById('secCapture');

PALETTE.forEach(function (couleur, i) {
  var sw = document.createElement('button');
  sw.className = 'swatch';
  sw.style.background = hex(couleur);
  sw.title = hex(couleur);
  sw.addEventListener('click', function () { couleurIdx = i; majBarreBureau(); });
  sw.dataset.idx = i;
  secCouleur.appendChild(sw);
});

var ongletBureauCapture = false;   // l'onglet CAPTURE n'est pas un "mode" (n'affecte pas la gachette/le clic)
document.getElementById('bTabLibre').addEventListener('click', function () { ongletBureauCapture = false; definirMode(MODE.LIBRE); });
document.getElementById('bTabPrecision').addEventListener('click', function () { ongletBureauCapture = false; definirMode(MODE.GIZMO_T); });
document.getElementById('bTabCouleur').addEventListener('click', function () { ongletBureauCapture = false; definirMode(MODE.COULEUR); });
document.getElementById('bTabMesure').addEventListener('click', function () { ongletBureauCapture = false; definirMode(MODE.MESURE); });
document.getElementById('bTabCapture').addEventListener('click', function () { ongletBureauCapture = true; majBarreBureau(); });
document.getElementById('bDeselectionner').addEventListener('click', function () { desactiverSelectionAB(); });
document.getElementById('bTranslater').addEventListener('click', function () { definirMode(MODE.GIZMO_T); });
document.getElementById('bTourner').addEventListener('click', function () { definirMode(MODE.GIZMO_R); });
document.getElementById('b0Pos').addEventListener('click', resetPosition);
document.getElementById('b0Rot').addEventListener('click', resetRotation);
document.getElementById('b0Tout').addEventListener('click', resetTout);
document.getElementById('bColorierAuto').addEventListener('click', colorierAutomatiquement);
document.getElementById('bReinitCouleurs').addEventListener('click', reinitialiserCouleurs);
document.getElementById('bAnnuler').addEventListener('click', annuler);
document.getElementById('bRefaire').addEventListener('click', retablir);
document.getElementById('bRazGenerale').addEventListener('click', razGenerale);
document.getElementById('bMesurePrecedente').addEventListener('click', mesurePrecedente);
document.getElementById('bMesureSuivante').addEventListener('click', mesureSuivante);
document.getElementById('bSupprimerMesure').addEventListener('click', supprimerMesureActive);
document.getElementById('bPrendrePhoto').addEventListener('click', capturerPhoto);
document.getElementById('bFondAR').addEventListener('click', function () { fondCapture = 'ar'; majBarreBureau(); });
document.getElementById('bFondVR').addEventListener('click', function () { fondCapture = 'vr'; majBarreBureau(); });
document.getElementById('bQuitterBureau').addEventListener('click', function () {
  // En mode telephone, la barre est affichee PAR-DESSUS une session WebXR
  // active (dom-overlay) : il faut terminer cette session (la camera reste
  // sinon allumee derriere l'ecran d'accueil) - le nettoyage (overlay,
  // reinitialiserApresSession...) est alors fait par le listener 'end' pose
  // au demarrage de la session, pas ici.
  if (modeTelephone) {
    var sessionActive = renderer.xr.getSession();
    if (sessionActive) sessionActive.end();
    return;
  }
  reinitialiserApresSession();
  modeBureau = false;
  barreBureau.classList.remove('visible');
  overlay.style.display = 'flex';
});
Array.prototype.forEach.call(secEchelle.querySelectorAll('button[data-pct]'), function (btn) {
  btn.addEventListener('click', function () {
    var pct = parseFloat(btn.dataset.pct);
    var avant = pivot.scale.x;
    var nouvelle = (pct / 100) / echelleInitiale;
    pivot.scale.setScalar(nouvelle);
    if (Math.abs(nouvelle - avant) > 1e-6) enregistrer({ type: 'echelle', avant: avant, apres: nouvelle });
    majBarreBureau();
  });
});

function majBarreBureau() {
  var enPrecision = !ongletBureauCapture && (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R);
  var enLibre     = !ongletBureauCapture && mode === MODE.LIBRE;
  var enCouleur   = !ongletBureauCapture && mode === MODE.COULEUR;
  var enMesure    = !ongletBureauCapture && mode === MODE.MESURE;

  document.getElementById('bTabLibre').className     = enLibre ? 'actif' : '';
  document.getElementById('bTabPrecision').className = enPrecision ? 'actif' : '';
  document.getElementById('bTabCouleur').className   = enCouleur ? 'actif' : '';
  document.getElementById('bTabMesure').className    = enMesure ? 'actif' : '';
  document.getElementById('bTabCapture').className   = ongletBureauCapture ? 'actif' : '';

  secLibre.className     = 'ligne section' + (enLibre ? ' visible' : '');
  secPrecision.className = 'ligne section' + (enPrecision ? ' visible' : '');
  secEchelle.className   = 'ligne section' + (enPrecision ? ' visible' : '');
  secCouleur.className   = 'ligne section' + (enCouleur ? ' visible' : '');
  secCouleur2.className  = 'ligne section' + (enCouleur ? ' visible' : '');
  secMesure.className    = 'ligne section' + (enMesure ? ' visible' : '');
  secCapture.className   = 'ligne section' + (ongletBureauCapture ? ' visible' : '');

  document.getElementById('bTranslater').className = mode === MODE.GIZMO_T ? 'actif' : '';
  document.getElementById('bTourner').className    = mode === MODE.GIZMO_R ? 'actif' : '';
  document.getElementById('bEchelleTxt').textContent = Math.round(pourcentageEchelle()) + ' %';
  document.getElementById('bAnnuler').disabled = !historique.length;
  document.getElementById('bRefaire').disabled = !refaire.length;
  document.getElementById('bInfoCible').textContent = cibleActive()
    ? (selection.length + ' piece(s) selectionnee(s)') : 'Modele entier';
  document.getElementById('bFondAR').className = fondCapture === 'ar' ? 'actif' : '';
  document.getElementById('bFondVR').className = fondCapture === 'vr' ? 'actif' : '';
  var idxMesure = indexMesureActive();
  document.getElementById('bInfoMesures').textContent = !mesures.length
    ? 'Aucune mesure'
    : (idxMesure === -1 ? ('Aucune affichee (' + mesures.length + ' en memoire)') : ((idxMesure + 1) + ' / ' + mesures.length + ' mesure(s)'));
  var boutonsMesure = !mesures.length;
  document.getElementById('bMesurePrecedente').disabled = boutonsMesure;
  document.getElementById('bMesureSuivante').disabled   = boutonsMesure;
  document.getElementById('bSupprimerMesure').disabled  = mesureActiveId == null;

  Array.prototype.forEach.call(secCouleur.querySelectorAll('.swatch'), function (sw) {
    sw.classList.toggle('actif', parseInt(sw.dataset.idx, 10) === couleurIdx);
  });

  // La barre est partagee entre le mode souris (aide = gestes souris) et le
  // mode telephone (aide = gestes tactiles) - meme structure, texte adapte.
  document.getElementById('aideLibre').textContent = modeTelephone
    ? 'Tapoter et glisser sur le modele : le deplacer a main levee (s\'aimante pres de sa position d\'origine)'
    : 'Glisser = orbiter · Molette = zoom vue · Clic molette = translater la vue · Maj+clic = choisir une piece · Ctrl+glisser = deplacer la cible (s\'aimante pres de l\'origine)';
  document.getElementById('aidePrecision').textContent = modeTelephone
    ? 'Tapoter + glisser sur une fleche/anneau (s\'aimante pres de l\'origine)'
    : 'Ctrl+glisser sur une fleche/anneau (s\'aimante pres de l\'origine)';
  document.getElementById('aideMesure').textContent = modeTelephone
    ? 'Tapoter un 1er point, puis un 2eme : distance reelle affichee (mm)'
    : 'Ctrl+clic sur un 1er point, puis un 2eme : distance reelle affichee (mm)';
}

// --- Bouton "Voir sur cet ecran (souris)" ---
document.getElementById('btnBureau').addEventListener('click', function () {
  var fichier = modeleChoisi.fichier;
  if (!fichier) { status.textContent = 'Choisissez un modele'; return; }
  nomModeleCourant = modeleChoisi.nom;
  historique = []; refaire = [];

  modeBureau = true;
  overlay.style.display = 'none';
  barreBureau.classList.add('visible');
  redimensionnerBureau();
  // Fond noir par defaut (couleur d'effacement WebGL standard, jamais definie
  // explicitement jusqu'ici) remplace par un gris neutre de style visionneuse
  // CAO, pour ne pas gener la lecture des couleurs du modele.
  scene.background = new THREE.Color(0x3a4048);

  anchor.position.set(0, 0, 0);
  anchor.quaternion.identity();
  anchor.visible = true;
  anchorPlaced = true;
  reticle.visible = false;
  preview.visible = false;

  chargerModele(fichier);
  majBarreBureau();
});

// --- Bouton "Realite augmentee sur telephone" (Android, tactile) ---
document.getElementById('btnTelephone').addEventListener('click', function () {
  var fichier = modeleChoisi.fichier;
  if (!fichier) { status.textContent = 'Choisissez un modele'; return; }
  nomModeleCourant = modeleChoisi.nom;
  historique = []; refaire = [];

  // Meme cascade de repli que le casque, avec en plus 'dom-overlay' pour
  // afficher la barre d'outils du mode souris par-dessus l'image de la
  // camera - pas de manette sur telephone, donc pas de menu en disque : on
  // reutilise directement #barreBureau (mêmes boutons, mêmes fonctions).
  var CONFIGS_AR_TEL = [
    { optionalFeatures: ['hit-test', 'dom-overlay'], domOverlay: { root: barreBureau } },
    { optionalFeatures: ['dom-overlay'], domOverlay: { root: barreBureau } },
    { optionalFeatures: ['hit-test'] },
    {}
  ];

  // La barre doit deja etre visible/dans la mise en page AVANT la demande de
  // session (le navigateur lit domOverlay.root a ce moment-la) - on la
  // recache si la demande echoue finalement.
  barreBureau.classList.add('visible');

  tenterSessionCascade(CONFIGS_AR_TEL, 0).then(function (session) {
    status.textContent = 'Session creee !';
    renderer.xr.setSession(session).then(function () {
      overlay.style.display = 'none';
      modeTelephone = true;
      chargerModele(fichier);
      majBarreBureau();

      session.addEventListener('end', function () {
        barreBureau.classList.remove('visible');
        overlay.style.display = 'flex';
        reinitialiserApresSession();
      });
    }).catch(function (e2) {
      barreBureau.classList.remove('visible');
      status.textContent = 'Erreur setSession: ' + e2.message;
    });
  }).catch(function (e) {
    barreBureau.classList.remove('visible');
    status.textContent = 'Erreur AR: ' + e.message;
  });
});

}); // fin window.addEventListener('load', ...)
