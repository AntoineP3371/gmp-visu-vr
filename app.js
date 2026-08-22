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

// --- Liste des modeles (modeles.json) ---
fetch('modeles.json').then(function (r) { return r.json(); }).then(function (liste) {
  liste.forEach(function (m) {
    var opt = document.createElement('option');
    opt.value = m.fichier;
    opt.textContent = m.nom;
    selectModele.appendChild(opt);
  });
  if (!liste.length) {
    var opt2 = document.createElement('option');
    opt2.textContent = 'Aucun modele - voir LISEZ-MOI.md';
    selectModele.appendChild(opt2);
    document.getElementById('btnCommencer').disabled = true;
  }
}).catch(function () {
  status.textContent = 'Erreur: modeles.json introuvable';
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
var aPrecedent         = [false, false];

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
function appliquerTransparenceSelection(opacite) {
  selection.forEach(function (piece) {
    piece.traverse(function (o) {
      if (!o.isMesh) return;
      var mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(function (m) { m.transparent = true; m.opacity = opacite; });
    });
  });
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

// Appele quand on relache le bouton A : on abandonne toute la selection.
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
function creerMarqueurAxe() {
  var c = document.createElement('canvas');
  c.width = MV_W; c.height = MV_H;
  var cx = c.getContext('2d');
  var tex = new THREE.CanvasTexture(c);
  var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(0.07, 0.07 * MV_H / MV_W, 1);
  s.renderOrder = 999;
  s.userData.canvas = c; s.userData.ctx = cx; s.userData.tex = tex;
  dessinerMarqueurAxe(s, '0', false);
  return s;
}
function dessinerMarqueurAxe(s, texte, actif) {
  var c = s.userData.canvas, cx = s.userData.ctx;
  cx.clearRect(0, 0, MV_W, MV_H);
  rr(cx, 3, 3, MV_W - 6, MV_H - 6, 14);
  cx.fillStyle = actif ? 'rgba(70,55,10,0.94)' : 'rgba(20,20,20,0.88)'; cx.fill();
  cx.strokeStyle = actif ? '#ffee00' : '#fff'; cx.lineWidth = actif ? 4 : 2; cx.stroke();
  cx.fillStyle = actif ? '#ffee00' : '#fff';
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
  s.scale.set(0.03, 0.03, 0.03);
  s.renderOrder = 999;
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
  var halo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, LONGUEUR_FLECHE, 8),
    new THREE.MeshBasicMaterial({ color: a.couleur, transparent: true, opacity: 0.18, depthTest: false })
  );
  halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir);
  halo.position.copy(a.dir).multiplyScalar(LONGUEUR_FLECHE / 2);
  gizmoTranslate.add(fleche, halo);
  poignees.push({ mesh: halo, axe: a.dir.clone(), type: 'translate', axeLettre: a.nom });

  // La valeur reste affichee en permanence (pas seulement pendant le
  // glissement) ; le bouton RAZ, lui, est une poignee cliquable a part.
  var valeurT = creerMarqueurAxe();
  valeurT.position.copy(a.dir).multiplyScalar(-0.045);
  gizmoTranslate.add(valeurT);
  marqueursValeur.push({ sprite: valeurT, type: 'translate', axeLettre: a.nom });

  var razT = creerBoutonRAZ();
  razT.position.copy(a.dir).multiplyScalar(-0.045).add(perp.clone().multiplyScalar(0.032));
  gizmoTranslate.add(razT);
  poignees.push({ mesh: razT, axe: a.dir.clone(), type: 'raz-t', axeLettre: a.nom });

  var anneau = new THREE.Mesh(
    new THREE.TorusGeometry(RAYON_ANNEAU, 0.006, 8, 32),
    new THREE.MeshBasicMaterial({ color: a.couleur, depthTest: false })
  );
  var haloAnneau = new THREE.Mesh(
    new THREE.TorusGeometry(RAYON_ANNEAU, 0.026, 8, 32),
    new THREE.MeshBasicMaterial({ color: a.couleur, transparent: true, opacity: 0.15, depthTest: false })
  );
  var qAnneau = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), a.dir);
  anneau.quaternion.copy(qAnneau);
  haloAnneau.quaternion.copy(qAnneau);
  gizmoRotate.add(anneau, haloAnneau);
  poignees.push({ mesh: haloAnneau, axe: a.dir.clone(), type: 'rotate', axeLettre: a.nom });

  var valeurR = creerMarqueurAxe();
  valeurR.position.copy(perp).multiplyScalar(RAYON_ANNEAU);
  gizmoRotate.add(valeurR);
  marqueursValeur.push({ sprite: valeurR, type: 'rotate', axeLettre: a.nom });

  var perp2 = new THREE.Vector3().crossVectors(a.dir, perp).normalize();
  var razR = creerBoutonRAZ();
  razR.position.copy(perp2).multiplyScalar(RAYON_ANNEAU);
  gizmoRotate.add(razR);
  poignees.push({ mesh: razR, axe: a.dir.clone(), type: 'raz-r', axeLettre: a.nom });
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
// ============================================================================
var mesurePoints = [];
var mesurePointMarkers = [];
var mesureLigne = null;
var mesureLabel = null;

function effacerMesure() {
  mesurePointMarkers.forEach(function (m) { scene.remove(m); });
  mesurePointMarkers = [];
  if (mesureLigne) { scene.remove(mesureLigne); mesureLigne.geometry.dispose(); mesureLigne = null; }
  if (mesureLabel) { scene.remove(mesureLabel); mesureLabel = null; }
  mesurePoints = [];
}
function afficherMesure() {
  var p0 = mesurePoints[0], p1 = mesurePoints[1];
  var geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
  mesureLigne = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffee00, depthTest: false }));
  mesureLigne.renderOrder = 1400;
  scene.add(mesureLigne);

  // Distance REELLE (mm), independante du zoom d'affichage courant : cf
  // pourcentageEchelle(), meme logique de conversion.
  var distMonde   = p0.distanceTo(p1);
  var distReelleMm = (distMonde / (echelleInitiale * pivot.scale.x)) * 1000;

  var mc = document.createElement('canvas'); mc.width = 220; mc.height = 76;
  var mctx = mc.getContext('2d');
  rr(mctx, 2, 2, 216, 72, 14); mctx.fillStyle = 'rgba(20,20,20,0.92)'; mctx.fill();
  rr(mctx, 2, 2, 216, 72, 14); mctx.strokeStyle = '#ffee00'; mctx.lineWidth = 3; mctx.stroke();
  mctx.fillStyle = '#ffee00'; mctx.font = 'bold 30px sans-serif';
  mctx.textAlign = 'center'; mctx.textBaseline = 'middle';
  mctx.fillText(distReelleMm.toFixed(1) + ' mm', 110, 39);
  var texM = new THREE.CanvasTexture(mc);
  mesureLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: texM, depthTest: false, transparent: true }));
  mesureLabel.scale.set(0.1, 0.1 * 76 / 220, 1);
  mesureLabel.position.copy(p0).add(p1).multiplyScalar(0.5);
  mesureLabel.renderOrder = 1401;
  scene.add(mesureLabel);
}
function gererClicMesure(inter) {
  if (mesurePoints.length >= 2) effacerMesure();
  var pt = inter.point.clone();
  mesurePoints.push(pt);
  var marqueur = new THREE.Mesh(
    new THREE.SphereGeometry(0.006, 10, 10),
    new THREE.MeshBasicMaterial({ color: 0xffee00, depthTest: false })
  );
  marqueur.position.copy(pt);
  marqueur.renderOrder = 1399;
  scene.add(marqueur);
  mesurePointMarkers.push(marqueur);
  if (mesurePoints.length === 2) afficherMesure();
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

// Capture hors-ecran a la pose de tete courante (camera est deja synchronisee
// sur la tete par Three.js pendant une session XR active). Meme technique que
// VR CEC/peinture.js : rendu dans une cible hors ecran, renderer.xr.enabled
// mis a false le temps du rendu (sinon le moteur substitue la camera casque).
function capturerPhoto() {
  if (!carPret) { sortirModePhoto(); return; }
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
  sortirModePhoto();
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
      { label: 'Manuel', action: function () { definirMode(MODE.COULEUR); }, sub: [
          { label: 'Palette de couleurs', couleurs: true }
      ] },
      { label: 'RAZ', action: reinitialiserCouleurs }
  ] },
  { label: 'Deplacements', sub: [
      { label: 'Precis', sub: [
          { label: 'Translation', action: function () { definirMode(MODE.GIZMO_T); } },
          { label: 'Rotation',    action: function () { definirMode(MODE.GIZMO_R); } }
      ] },
      { label: 'RAZ generale', action: razGenerale }
  ] },
  { label: 'Mesures', action: function () { definirMode(MODE.MESURE); } },
  { label: 'Annuler / Refaire / Quitter / Remettre', sub: [
      { label: 'Annuler', action: annuler },
      { label: 'Refaire', action: retablir },
      { label: 'Quitter', action: quitterAR },
      { label: 'Remettre sur la table', action: replacer }
  ] },
  { label: "Capture d'affichage", sub: [
      { label: 'Cadre', action: entrerModePhoto },
      { label: 'Fond', sub: [
          { label: 'Realite virtuelle',  action: function () { fondCapture = 'vr'; } },
          { label: 'Realite augmentee',  action: function () { fondCapture = 'ar'; } }
      ] }
  ] }
];

var roueStack = [];    // navigation (drill-down) : pile des noeuds "sub" ouverts
var menuCtrlIdx = 0;   // manette qui porte le menu - main gauche par defaut
var summonPrev  = [false, false];

var RCV = 512, RHUB = 84, RRING = 156, RNODE = 68;
var rc = document.createElement('canvas'); rc.width = RCV; rc.height = RCV;
var rctx = rc.getContext('2d');
var rtex = new THREE.CanvasTexture(rc);
var roue = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
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
function estActifRoue(node) {
  switch (node.label) {
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
    if (p.node.couleur !== undefined) {
      rctx.fillStyle = hex(p.node.couleur);
      cerclePlein(p.x, p.y, RNODE / 2); rctx.fill();
      rctx.strokeStyle = (p.node.idx === couleurIdx) ? '#ffee00' : '#3a4553';
      rctx.lineWidth = (p.node.idx === couleurIdx) ? 5 : 2;
      cerclePlein(p.x, p.y, RNODE / 2); rctx.stroke();
      return;
    }
    var actif = estActifRoue(p.node);
    rctx.fillStyle = actif ? '#2c5aa0' : '#242c37';
    cerclePlein(p.x, p.y, RNODE / 2); rctx.fill();
    rctx.strokeStyle = actif ? '#ffee00' : '#3a4553';
    rctx.lineWidth = actif ? 5 : 2;
    cerclePlein(p.x, p.y, RNODE / 2); rctx.stroke();
    rctx.fillStyle = '#fff'; rctx.textAlign = 'center';
    var mots = p.node.label.split(' ');
    if (mots.length > 1 || p.node.label.length > 9) {
      rctx.font = 'bold 10px sans-serif';
      rctx.fillText(mots[0], p.x, p.y - 3);
      if (mots[1]) rctx.fillText(mots.slice(1).join(' ').slice(0, 12), p.x, p.y + 11);
    } else {
      rctx.font = 'bold 13px sans-serif';
      rctx.fillText(p.node.label, p.x, p.y + 4);
    }
  });

  cerclePlein(c, c, RHUB);
  rctx.fillStyle = 'rgba(28,34,44,0.96)'; rctx.fill();
  rctx.strokeStyle = '#2f8fd6'; rctx.lineWidth = 2; cerclePlein(c, c, RHUB); rctx.stroke();
  rctx.fillStyle = '#fff'; rctx.font = 'bold 13px sans-serif'; rctx.textAlign = 'center';
  rctx.fillText(roueStack.length ? '< RETOUR' : 'MENU', c, c + 5);

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

function traiterClicRoue(zone) {
  if (!zone) return;
  if (zone === 'back') { roueStack.pop(); majPanneau(); return; }
  if (zone.couleur !== undefined) { couleurIdx = zone.idx; majPanneau(); return; }
  if (zone.action) zone.action();
  if (zone.sub) {
    roueStack.push(zone);
  } else {
    roueStack = [];   // action terminale : revient a la racine du menu (reste visible)
  }
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

// Laser rouge de presentation : visible tant que la gachette est tenue,
// s'arrete pile sur la piece visee (point rouge). Independant de l'action
// que la gachette declenche par ailleurs (peindre, glisser le gizmo...).
var selectTenu = [false, false];
function majLaser(idx) {
  var ctrl = controllers[idx];
  var laser = ctrl.userData.laser, point = ctrl.userData.pointeurLaser;
  if (!selectTenu[idx] || !carPret) { laser.visible = false; point.visible = false; return; }
  var ray = rayonDe(ctrl);
  var hits = ray.intersectObjects(pieces, false);
  laser.visible = true;
  laser.scale.z = hits.length ? hits[0].distance : 3;
  point.visible = hits.length > 0;
  if (hits.length) point.position.copy(hits[0].point);
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

    // Valeur toujours affichee (pas seulement pendant le glissement),
    // surlignee en jaune quand on est en train de glisser CET axe precis.
    marqueursValeur.forEach(function (mv) {
      var dragActuel = dragEtat || dragBureau;    // manette (VR) ou souris (bureau)
      var modeGlisse = dragEtat ? dragEtat.mode : (dragBureau ? dragBureau.type : null);
      var actif = !!(dragActuel && dragActuel.axeLettre === mv.axeLettre && modeGlisse === mv.type);
      var texte = mv.type === 'translate' ? texteAxeTranslation(mv.axeLettre) : texteAxeRotation(mv.axeLettre);
      dessinerMarqueurAxe(mv.sprite, texte, actif);
    });
  }

  // A tenu + selection : le joystick regle la transparence des pieces
  // choisies (l'appui deux mains simultane est reserve au zoom).
  if (!modeBureau) {
    pollAppelRoue();
    controllers.forEach(function (ctrl, ci) {
      var aActuel = boutonAppuye(ctrl, 4);
      if (aPrecedent[ci] && !aActuel) desactiverSelectionAB();
      aPrecedent[ci] = aActuel;
      if (aActuel && selection.length) {
        var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
        if (gp && gp.axes && gp.axes.length > 3) {
          var t = gp.axes[3] || 0;
          appliquerTransparenceSelection(Math.max(0.12, 1 - Math.abs(t) * 0.85));
        }
      }
      majLaser(ci);
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
  aPrecedent = [false, false];
  dragBureau = null;
  effacerMesure();
  sortirModePhoto();
  fermerApercuPhoto();

  if (racineModele) { pivot.remove(racineModele); racineModele = null; }
  pieces = [];
  piecesMobiles = [];
  carPret = false;
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
