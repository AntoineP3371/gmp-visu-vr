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
var selectModele = document.getElementById('selectModele');

if (typeof THREE === 'undefined') {
  status.textContent = 'Erreur: Three.js non charge';
  return;
}
status.textContent = 'Three.js OK';

if (!navigator.xr) {
  status.textContent = 'WebXR non disponible';
} else {
  navigator.xr.isSessionSupported('immersive-ar').then(function (ok) {
    status.textContent = ok ? 'AR pret !' : 'AR non supporte';
    if (!ok) document.getElementById('btnCommencer').disabled = true;
  });
}

// --- Liste des modeles : modeles.json (local) + dossier Google Drive
// (optionnel, cf drive-config.js) fusionnes dans le meme <select>. Un
// modele Drive est charge directement depuis son URL de telechargement
// (alt=media) : chargerModele() n'a besoin d'aucune adaptation, un chemin
// relatif local et une URL complete se chargent de la meme facon via
// GLTFLoader.load().
function ajouterOptionModele(nom, valeur) {
  var opt = document.createElement('option');
  opt.value = valeur;
  opt.textContent = nom;
  selectModele.appendChild(opt);
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
  if (!selectModele.options.length) {
    ajouterOptionModele('Aucun modele - voir LISEZ-MOI.md', '');
    document.getElementById('btnCommencer').disabled = true;
  }
});

// --- Renderer / scene ---
var gl = canvas.getContext('webgl2', { xrCompatible: true }) ||
         canvas.getContext('webgl',  { xrCompatible: true });
var renderer = new THREE.WebGLRenderer({ canvas: canvas, context: gl, alpha: true, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local');

var scene  = new THREE.Scene();
var camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
// La camera doit faire partie de la scene pour que des enfants qui lui sont
// attaches (ex : le flash de capture photo, cf plus bas) soient rendus -
// scene.traverse()/renderer.render() ne descend que depuis la racine scene.
scene.add(camera);

scene.add(new THREE.AmbientLight(0xffffff, 1.5));
var dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);

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
  majPanneau();
}
function retablir() {
  if (!refaire.length) return;
  var a = refaire.pop();
  appliquerAction(a, true);
  historique.push(a);
  majPanneau();
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
  });
}
// Convertit une position de joystick (0..1, deja en valeur absolue) en
// opacite, avec une progression VOLONTAIREMENT NON LINEAIRE : fine et lente
// pres du centre (opaque -> transparent), puis descend jusqu'a un niveau
// "fantome" (quasi invisible mais jamais totalement invisible) en fin de
// course - plus precis a piloter qu'une simple rampe lineaire, qui filait
// trop vite vers la transparence.
function opaciteDepuisJoystick(t) {
  var a = Math.min(1, Math.abs(t));
  var facteur = Math.pow(a, 1.6);
  return Math.max(0.04, 1 - facteur * 0.97);
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
  selection = [];
  surlignerSelection();
  relacherSelection();
  dragEtat = null;
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
      var apres = capturerMatricesMonde(objetsCiblesActuels());
      enregistrerTransformSiChange(objetsCiblesActuels(), grabAvant, apres);
    }
  }
  grabIdx = -1;
  grabAvant = null;
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
    objets: objetsCiblesActuels(), avant: capturerMatricesMonde(objetsCiblesActuels())
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
    objets: objetsCiblesActuels(), avant: capturerMatricesMonde(objetsCiblesActuels())
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
  var mat;
  if (Array.isArray(o.material)) {
    var idx = (inter.face && inter.face.materialIndex) || 0;
    if (!o.material[idx]) return;
    mat = o.material[idx];
  } else {
    mat = o.material;
  }
  var avant = mat.color.getHex();
  var apres = couleurCourante();
  if (avant === apres) return;
  mat.color.setHex(apres);
  enregistrer({ type: 'couleur', mat: mat, avant: avant, apres: apres });
}

function colorierAutomatiquement() {
  var total = 0;
  pieces.forEach(function (o) { total += Array.isArray(o.material) ? o.material.length : 1; });
  var i = 0, entrees = [];
  pieces.forEach(function (o) {
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m) {
      var avant = m.color.getHex();
      var apres = new THREE.Color().setHSL(i / Math.max(total, 1), 0.65, 0.55).getHex();
      m.color.setHex(apres);
      entrees.push({ mat: m, avant: avant, apres: apres });
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
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m, i) {
      var avant = m.color.getHex();
      var apres = orig[i];
      if (avant === apres) return;
      m.color.setHex(apres);
      entrees.push({ mat: m, avant: avant, apres: apres });
    });
  });
  if (entrees.length) enregistrer({ type: 'couleur-lot', entrees: entrees });
}

// ============================================================================
//  MODE (comment on manipule la cible courante)
// ============================================================================
var MODE = { LIBRE: 'libre', GIZMO_T: 'gizmo-t', GIZMO_R: 'gizmo-r', COULEUR: 'couleur', MESURE: 'mesure' };
var mode = MODE.LIBRE;

function definirMode(m) {
  mode = m;
  dragEtat = null;
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
var cadrePhoto = new THREE.LineLoop(
  new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.06, -0.045, 0), new THREE.Vector3(0.06, -0.045, 0),
    new THREE.Vector3(0.06, 0.045, 0),   new THREE.Vector3(-0.06, 0.045, 0)
  ]),
  new THREE.LineBasicMaterial({ color: 0xffee00, depthTest: false })
);
cadrePhoto.renderOrder = 1300;
cadrePhoto.visible = false;

var camPhoto = new THREE.PerspectiveCamera(60, 4 / 3, 0.01, 20);
var previewPhoto = null;

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

function entrerModePhoto() { modePhoto = true; cadrePhoto.visible = true; }
function sortirModePhoto() { modePhoto = false; cadrePhoto.visible = false; }

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
  var visCadre = cadrePhoto.visible, visMarq = marqueursValeur.map(function (m) { return m.sprite.visible; });
  roue.visible = false; gizmoTranslate.visible = false; gizmoRotate.visible = false; cadrePhoto.visible = false;

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

  roue.visible = visRoue; gizmoTranslate.visible = visGT; gizmoRotate.visible = visGR; cadrePhoto.visible = visCadre;

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
var MENU_RACINE = [
  { label: 'Couleurs', sub: [
      { label: 'Automatique', action: colorierAutomatiquement },
      { label: 'Manuel', action: function () { definirMode(MODE.COULEUR); }, couleurs: true },
      { label: 'RAZ', action: reinitialiserCouleurs }
  ] },
  { label: 'Deplacements', sub: [
      { label: 'Libre', action: revenirLibre },
      { label: 'Precis', sub: [
          { label: 'Translation', action: function () { definirMode(MODE.GIZMO_T); } },
          { label: 'Rotation',    action: function () { definirMode(MODE.GIZMO_R); } }
      ] },
      { label: 'RAZ generale', texte: 'RAZ tout', action: razGenerale }
  ] },
  { label: 'Mesures', texte: 'Mesures', action: function () { definirMode(MODE.MESURE); }, mesures: true },
  { label: 'Annuler / Refaire / Quitter / Remettre', texte: 'Actions', sub: [
      { label: 'Annuler', action: annuler },
      { label: 'Refaire', action: retablir },
      { label: 'Quitter', action: quitterAR },
      { label: 'Remettre sur la table', texte: 'Remettre', action: replacer }
  ] },
  { label: "Capture d'affichage", texte: 'Capture', sub: [
      { label: 'Cadre', action: entrerModePhoto },
      { label: 'Fond', sub: [
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
    rctx.fillStyle = actif ? '#2c5aa0' : '#242c37';
    cerclePlein(p.x, p.y, RNODE / 2); rctx.fill();
    rctx.strokeStyle = actif ? '#ffee00' : '#3a4553';
    rctx.lineWidth = actif ? 5 : 2;
    cerclePlein(p.x, p.y, RNODE / 2); rctx.stroke();
    // Surbrillance de VISEE (distincte du "actif" ci-dessus) : un anneau
    // blanc supplementaire, plus grand, pour qu'on voie TOUJOURS lequel le
    // rayon vise en ce moment - avant meme d'appuyer sur la gachette.
    if (survole) { rctx.strokeStyle = '#ffffff'; rctx.lineWidth = 6; cerclePlein(p.x, p.y, RNODE / 2 + 8); rctx.stroke(); }
    rctx.fillStyle = '#fff'; rctx.textAlign = 'center';
    var texteNoeud = p.node.texte || p.node.label;
    var mots = texteNoeud.split(' ');
    if (mots.length === 1) {
      rctx.font = texteNoeud.length > 9 ? 'bold 15px sans-serif' : 'bold 18px sans-serif';
      rctx.fillText(texteNoeud, p.x, p.y + 6);
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
      rctx.font = 'bold 15px sans-serif';
      rctx.fillText(mots.slice(0, meilleureCoupe).join(' '), p.x, p.y - 10);
      rctx.fillText(mots.slice(meilleureCoupe).join(' '), p.x, p.y + 10);
    }
  });

  var survoleHub = idHoverRoue === 'back';
  cerclePlein(c, c, RHUB);
  rctx.fillStyle = survoleHub ? 'rgba(50,70,95,0.98)' : 'rgba(28,34,44,0.96)'; rctx.fill();
  rctx.strokeStyle = survoleHub ? '#ffffff' : '#2f8fd6';
  rctx.lineWidth = survoleHub ? 5 : 2;
  cerclePlein(c, c, RHUB); rctx.stroke();
  rctx.fillStyle = '#fff'; rctx.font = 'bold 16px sans-serif'; rctx.textAlign = 'center';
  rctx.fillText(roueStack.length ? '< RETOUR' : 'MENU', c, c + 6);

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
  if (zone === 'back') { roueStack.pop(); majPanneau(); return; }
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
  // MODE.LIBRE : rien au clic gachette, la saisie se fait au grip
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

// Annuler/Refaire au joystick gauche/droite (axes[2] = axe X du pouce, sur
// les 2 manettes) - un seul declenchement par poussee (rearme quand le
// joystick revient pres du centre), pour ne pas annuler 60 fois par seconde
// tant qu'on le maintient. Reste egalement disponible dans le menu Actions.
var UNDO_REDO_SEUIL = 0.6;
var undoRedoArme = [true, true];
function pollUndoRedoJoystick() {
  controllers.forEach(function (ctrl, i) {
    var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
    var x = (gp && gp.axes && gp.axes.length > 2) ? (gp.axes[2] || 0) : 0;
    if (Math.abs(x) < UNDO_REDO_SEUIL * 0.5) { undoRedoArme[i] = true; return; }
    if (!undoRedoArme[i]) return;
    undoRedoArme[i] = false;
    if (x <= -UNDO_REDO_SEUIL) annuler();
    else if (x >= UNDO_REDO_SEUIL) retablir();
  });
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
    return;
  }
  var ray = rayonDe(ctrl);

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
    new THREE.SphereGeometry(0.008, 12, 12),
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
  if (idx === 1) { ctrl.add(cadrePhoto); cadrePhoto.position.set(0, 0, -0.16); }

  ctrl.addEventListener('connected', function (e) {
    ctrl.userData.src = e.data;
    if (e.data.handedness === 'left' && menuCtrlIdx !== idx) {
      menuCtrlIdx = idx;
      ctrl.add(roue);
      roue.position.set(0, 0.06, -0.04);
      roue.rotation.x = -0.5;
    } else if (e.data.handedness === 'right' && cadrePhoto.parent !== ctrl) {
      ctrl.add(cadrePhoto);
      cadrePhoto.position.set(0, 0, -0.16);
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
      grabAvant = capturerMatricesMonde(objetsCiblesActuels());
      ctrl.attach(c);
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
    if (dragEtat && dragEtat.idx === idx) {
      var apres = capturerMatricesMonde(dragEtat.objets);
      enregistrerTransformSiChange(dragEtat.objets, dragEtat.avant, apres);
      dragEtat = null;
    }
  });
});

// ============================================================================
//  BOUCLE DE RENDU
// ============================================================================
renderer.setAnimationLoop(function (time, frame) {
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
    if (!surTable) controllers[0].getWorldPosition(cible);

    preview.position.copy(cible);
    preview.visible = true;
    anchor.position.copy(cible);
    if (surTable) anchor.quaternion.setFromRotationMatrix(reticle.matrix);
    anchor.visible = true;
  }

  if (anchorPlaced) {
    preview.visible = false;
    roue.visible = carPret && !modeBureau;
  }

  if (modeBureau) majCameraBureau();

  if (modeZoom) majZoom();
  if (dragEtat) { if (dragEtat.mode === 'translate') majDragTranslate(); else majDragRotate(); }
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
  if (!modeBureau) {
    pollAppelRoue();
    pollUndoRedoJoystick();
    pollSurvolRoue();
    controllers.forEach(function (ctrl, ci) {
      majLaser(ci);
      var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
      if (boutonAppuye(ctrl, 4) && selection.length) {
        if (gp && gp.axes && gp.axes.length > 3) {
          var t = gp.axes[3] || 0;
          appliquerTransparenceSelection(opaciteDepuisJoystick(t));
        }
      } else if (selectTenu[ci] && ctrl.userData.pieceLaser) {
        var tLaser = (gp && gp.axes && gp.axes.length > 3) ? (gp.axes[3] || 0) : 0;
        if (Math.abs(tLaser) > 0.08) {
          appliquerTransparencePiece(ctrl.userData.pieceLaser, opaciteDepuisJoystick(tLaser));
        }
      }
    });
  }

  if (panneauSale) dessinerRoue();
  if (modeBureau) majBarreBureau();

  renderer.render(scene, camera);
});

// --- Bouton "Entrer en realite mixte" ---
document.getElementById('btnCommencer').addEventListener('click', function () {
  var fichier = selectModele.value;
  if (!fichier) { status.textContent = 'Choisissez un modele'; return; }
  nomModeleCourant = selectModele.options[selectModele.selectedIndex].textContent;
  historique = []; refaire = [];

  // Certains casques/navigateurs rejettent la session en bloc si UNE SEULE
  // fonctionnalite optionnelle listee n'est pas accordable (alors que la
  // norme dit qu'elle devrait juste etre ignoree) : on retente donc avec une
  // configuration de plus en plus reduite plutot que d'abandonner d'un coup.
  // Seul 'local' est reellement utilise par le code (renderer.xr.setReferenceSpaceType) ;
  // 'hit-test' et 'local-floor' sont un bonus, jamais indispensables.
  var CONFIGS_AR = [
    { optionalFeatures: ['hit-test', 'local-floor', 'local'] },
    { optionalFeatures: ['local'] },
    {}
  ];

  function tenterSessionAR(i) {
    return navigator.xr.requestSession('immersive-ar', CONFIGS_AR[i]).catch(function (e) {
      if (i + 1 < CONFIGS_AR.length) {
        status.textContent = 'Config AR ' + (i + 1) + ' refusee, nouvel essai...';
        return tenterSessionAR(i + 1);
      }
      throw e;
    });
  }

  tenterSessionAR(0).then(function (session) {
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
}

// ============================================================================
//  MODE BUREAU : meme visionneuse, a la souris, sans casque (navigateur
//  classique). Reutilise TOUT le moteur (pivot, gizmo, coloration, Annuler/
//  Refaire) - seules la camera (orbite souris au lieu de la tete) et les
//  gestes d'entree (souris/clavier au lieu des manettes) sont propres au
//  mode bureau. Le panneau 3D est remplace par la barre HTML #barreBureau.
// ============================================================================
var modeBureau = false;
var dragBureau = null;
var orbite = { cible: new THREE.Vector3(0, 0.15, 0), distance: 0.6, yaw: 0.6, tangage: 0.45 };
var etatSourisOrbite = null;

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
    objets: objetsCiblesActuels(), avant: capturerMatricesMonde(objetsCiblesActuels())
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
    objets: objetsCiblesActuels(), avant: capturerMatricesMonde(objetsCiblesActuels())
  };
}
function demarrerDragLibreSouris(pointClic) {
  var c = cibleCourante(); if (!c) return;
  var normale = new THREE.Vector3(); camera.getWorldDirection(normale);
  dragBureau = {
    type: 'libre', plan: { point: pointClic.clone(), normale: normale },
    posDepartPivot: c.getWorldPosition(new THREE.Vector3()),
    objets: objetsCiblesActuels(), avant: capturerMatricesMonde(objetsCiblesActuels())
  };
}
function majDragBureau(rayOrig, rayDir) {
  var c = cibleCourante(); if (!c || !dragBureau) return;
  if (dragBureau.type === 'translate') {
    var pt1 = pointProcheAxe(rayOrig, rayDir, dragBureau.posDepartPivot, dragBureau.axeMonde);
    var delta1 = pt1.clone().sub(dragBureau.pointDepart);
    c.position.copy(c.parent.worldToLocal(dragBureau.posDepartPivot.clone().add(delta1)));
  } else if (dragBureau.type === 'rotate') {
    var pt2 = pointSurPlan(rayOrig, rayDir, dragBureau.pivotPos, dragBureau.axeMonde);
    if (!pt2) return;
    var vActuel = projeteSurPlan(pt2.clone().sub(dragBureau.pivotPos), dragBureau.axeMonde).normalize();
    var angle = angleSigneAutourAxe(dragBureau.vDepart, vActuel, dragBureau.axeMonde);
    var qDelta = new THREE.Quaternion().setFromAxisAngle(dragBureau.axeMonde, angle);
    var qCible = qDelta.multiply(dragBureau.quatDepartPivot);
    var qParentInv = new THREE.Quaternion(); c.parent.getWorldQuaternion(qParentInv).invert();
    c.quaternion.copy(qParentInv.multiply(qCible));
  } else {
    var pt3 = pointSurPlan(rayOrig, rayDir, dragBureau.plan.point, dragBureau.plan.normale);
    if (!pt3) return;
    var delta3 = pt3.clone().sub(dragBureau.plan.point);
    c.position.copy(c.parent.worldToLocal(dragBureau.posDepartPivot.clone().add(delta3)));
  }
}
function terminerDragBureau() {
  if (!dragBureau) return;
  var apres = capturerMatricesMonde(dragBureau.objets);
  enregistrerTransformSiChange(dragBureau.objets, dragBureau.avant, apres);
  dragBureau = null;
}

canvas.addEventListener('mousedown', function (evt) {
  if (!modeBureau || !anchorPlaced) return;
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
window.addEventListener('mousemove', function (evt) {
  if (!modeBureau) return;
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
}

// --- Bouton "Voir sur cet ecran (souris)" ---
document.getElementById('btnBureau').addEventListener('click', function () {
  var fichier = selectModele.value;
  if (!fichier) { status.textContent = 'Choisissez un modele'; return; }
  nomModeleCourant = selectModele.options[selectModele.selectedIndex].textContent;
  historique = []; refaire = [];

  modeBureau = true;
  overlay.style.display = 'none';
  barreBureau.classList.add('visible');
  redimensionnerBureau();

  anchor.position.set(0, 0, 0);
  anchor.quaternion.identity();
  anchor.visible = true;
  anchorPlaced = true;
  reticle.visible = false;
  preview.visible = false;

  chargerModele(fichier);
  majBarreBureau();
});

}); // fin window.addEventListener('load', ...)
