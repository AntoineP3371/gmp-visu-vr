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
  panneau.visible = false;
  definirCibleType(CIBLE.MODELE);
  definirMode(MODE.LIBRE);
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

function capturerMatricesMonde(objets) {
  return objets.map(function (o) { o.updateMatrixWorld(true); return o.matrixWorld.clone(); });
}
function definirMatriceMonde(objet, matriceMonde) {
  if (!objet.parent) return;
  objet.parent.updateMatrixWorld(true);
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
    carPret = true;
    majPanneau();
  }, undefined, function (e) {
    errbox.textContent = 'Erreur GLB: ' + e;
  });
}

// ============================================================================
//  CIBLE DE MANIPULATION : modele entier / une piece / un groupe de pieces
// ============================================================================
var CIBLE = { MODELE: 'modele', PIECE: 'piece', GROUPE: 'groupe' };
var cibleType     = CIBLE.MODELE;
var selection      = [];      // pieces actuellement dans la cible piece/groupe
var enChoixCible    = false;   // vrai pendant qu'on clique les pieces a (de)selectionner
var piecesSurlignees = [];     // meshes actuellement teintes (pour les nettoyer)

function cibleCourante() {
  return cibleType === CIBLE.MODELE ? pivot : pivotSelection;
}
function parentLogiqueCible() {
  return cibleType === CIBLE.MODELE ? anchor : pivot;
}
function objetsCiblesActuels() {
  if (cibleType === CIBLE.MODELE) return racineModele ? [racineModele] : [];
  return selection.slice();
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

function definirCibleType(t) {
  if (t === cibleType) {
    if (t !== CIBLE.MODELE) enChoixCible = !enChoixCible;
  } else {
    cibleType = t;
    selection = [];
    relacherSelection();
    surlignerSelection();
    enChoixCible = (t !== CIBLE.MODELE);
    dragEtat = null;
  }
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
function gererClicSelection(ray) {
  var hits = ray.intersectObjects(pieces, false);
  if (!hits.length) return;
  var piece = trouverPieceRacine(hits[0].object);
  if (!piece) return;
  if (cibleType === CIBLE.PIECE) {
    selection = [piece];
  } else {
    var i = selection.indexOf(piece);
    if (i >= 0) selection.splice(i, 1); else selection.push(piece);
  }
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
function majZoom() {
  var p0 = new THREE.Vector3(); controllers[0].getWorldPosition(p0);
  var p1 = new THREE.Vector3(); controllers[1].getWorldPosition(p1);
  if (zoomDistDepart >= 1e-4) {
    var facteur = p0.distanceTo(p1) / zoomDistDepart;
    var nouvelle = Math.max(ECHELLE_MIN, Math.min(ECHELLE_MAX, zoomEchelleDepart * facteur));
    pivot.scale.setScalar(nouvelle);
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

// Petit marqueur "0" (sprite = toujours face a la camera), texture partagee
var zc = document.createElement('canvas');
zc.width = 64; zc.height = 64;
var zctx = zc.getContext('2d');
zctx.fillStyle = 'rgba(30,30,30,0.9)';
zctx.beginPath(); zctx.arc(32, 32, 29, 0, Math.PI * 2); zctx.fill();
zctx.strokeStyle = '#fff'; zctx.lineWidth = 3; zctx.stroke();
zctx.fillStyle = '#fff'; zctx.font = 'bold 30px sans-serif';
zctx.textAlign = 'center'; zctx.textBaseline = 'middle';
zctx.fillText('0', 32, 34);
var texZero = new THREE.CanvasTexture(zc);
var matZero = new THREE.SpriteMaterial({ map: texZero, depthTest: false, transparent: true });
function creerMarqueurZero() {
  var s = new THREE.Sprite(matZero);
  s.scale.set(0.035, 0.035, 0.035);
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

var poignees = [];   // { mesh (sert au raycast), axe, type, axeLettre? }

AXES.forEach(function (a) {
  var fleche = creerFleche(a.couleur, 0.006);
  majFleche(fleche, new THREE.Vector3(), a.dir.clone().multiplyScalar(LONGUEUR_FLECHE));
  var halo = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, LONGUEUR_FLECHE, 8),
    new THREE.MeshBasicMaterial({ color: a.couleur, transparent: true, opacity: 0.18, depthTest: false })
  );
  halo.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), a.dir);
  halo.position.copy(a.dir).multiplyScalar(LONGUEUR_FLECHE / 2);
  gizmoTranslate.add(fleche, halo);
  poignees.push({ mesh: halo, axe: a.dir.clone(), type: 'translate' });

  var zeroT = creerMarqueurZero();
  zeroT.position.copy(a.dir).multiplyScalar(-0.045);
  gizmoTranslate.add(zeroT);
  poignees.push({ mesh: zeroT, axe: a.dir.clone(), type: 'zero-t', axeLettre: a.nom });

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
  poignees.push({ mesh: haloAnneau, axe: a.dir.clone(), type: 'rotate' });

  var zeroR = creerMarqueurZero();
  zeroR.position.copy(perpendiculaire(a.dir)).multiplyScalar(RAYON_ANNEAU);
  gizmoRotate.add(zeroR);
  poignees.push({ mesh: zeroR, axe: a.dir.clone(), type: 'zero-r', axeLettre: a.nom });
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
    idx: idx, poignee: poignee, mode: 'translate',
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
    idx: idx, poignee: poignee, mode: 'rotate',
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
//  PANNEAU DE COMMANDE (canvas 2D -> texture)
//  Les zones sont declarees UNE SEULE FOIS et servent a la fois au dessin et
//  a la detection du clic : impossible qu'elles se desynchronisent.
// ============================================================================
var PW = 512, PH = 410;
var PLANE_W = 0.46, PLANE_H = PLANE_W * PH / PW;

// Note : le ciblage d'UNE piece se fait desormais par B+grip (voir plus bas),
// plus par bouton de panneau - seuls MODELE ENTIER et GROUPE restent ici.
var ZA = {
  modele:  { x: 8,   y: 8,  w: 246, h: 32 },
  groupe:  { x: 262, y: 8,  w: 242, h: 32 },
  choisir: { x: 8,   y: 44, w: 496, h: 26 }
};
var ZT = {
  tabLibre:     { x: 8,   y: 78, w: 160, h: 30 },
  tabPrecision: { x: 176, y: 78, w: 160, h: 30 },
  tabCouleur:   { x: 344, y: 78, w: 160, h: 30 }
};
var ZP = {
  translater: { x: 8,   y: 116, w: 246, h: 42 },
  tourner:    { x: 262, y: 116, w: 242, h: 42 },
  reset0Pos:  { x: 8,   y: 162, w: 246, h: 34 },
  reset0Rot:  { x: 262, y: 162, w: 242, h: 34 },
  resetTout:  { x: 8,   y: 200, w: 496, h: 32 }
};
var ZC = {
  auto:  { x: 8,   y: 202, w: 246, h: 38 },
  reset: { x: 262, y: 202, w: 242, h: 38 }
};
var ZU = {
  annuler: { x: 8,   y: 284, w: 246, h: 40 },
  refaire: { x: 262, y: 284, w: 242, h: 40 }
};
var ZB = {
  replacer: { x: 8,   y: 330, w: 246, h: 44 },
  quitter:  { x: 262, y: 330, w: 242, h: 44 }
};
function zoneCouleur(i) {
  return { x: 8 + (i % 6) * 84, y: 116 + (i < 6 ? 0 : 42), w: 76, h: 38 };
}

var pc  = document.createElement('canvas');
pc.width = PW; pc.height = PH;
var ctx = pc.getContext('2d');
var tex = new THREE.CanvasTexture(pc);

function bouton(z, fond, texte, actif, couleurTexte) {
  ctx.fillStyle = fond;
  rr(ctx, z.x, z.y, z.w, z.h, 10); ctx.fill();
  if (actif) {
    ctx.strokeStyle = '#ffee00'; ctx.lineWidth = 4;
    rr(ctx, z.x + 2, z.y + 2, z.w - 4, z.h - 4, 9); ctx.stroke();
  }
  ctx.fillStyle = couleurTexte || '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(texte, z.x + z.w / 2, z.y + z.h / 2 + 6);
}

var panneauSale = true;
function majPanneau() { panneauSale = true; }

function dessinerPanneau() {
  panneauSale = false;
  ctx.clearRect(0, 0, PW, PH);
  ctx.fillStyle = 'rgba(20,20,20,0.94)'; rr(ctx, 0, 0, PW, PH, 18); ctx.fill();

  // --- Cible ---
  ctx.font = 'bold 14px sans-serif';
  bouton(ZA.modele, cibleType !== CIBLE.GROUPE ? '#2c5aa0' : '#242430', 'MODELE / PIECE', cibleType !== CIBLE.GROUPE);
  bouton(ZA.groupe, cibleType === CIBLE.GROUPE ? '#2c5aa0' : '#242430', 'GROUPE',         cibleType === CIBLE.GROUPE);

  ctx.textAlign = 'center';
  if (cibleType === CIBLE.GROUPE) {
    ctx.font = 'bold 14px sans-serif';
    bouton(ZA.choisir, enChoixCible ? '#8e2b2b' : '#2c5aa0', enChoixCible ? 'TERMINER LA SELECTION' : 'CHOISIR...', enChoixCible);
  } else {
    ctx.fillStyle = '#666'; ctx.font = '12px sans-serif';
    var txtCible = cibleType === CIBLE.PIECE ? 'Piece selectionnee (B+grip pour en choisir une autre)' : 'A+grip = modele entier   -   B+grip = une piece';
    ctx.fillText(txtCible, PW / 2, 62);
  }

  // --- Onglets de manipulation ---
  var enPrecision = (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R);
  ctx.font = 'bold 14px sans-serif';
  bouton(ZT.tabLibre,     mode === MODE.LIBRE ? '#2c5aa0' : '#242430', 'MAIN LIBRE', mode === MODE.LIBRE);
  bouton(ZT.tabPrecision, enPrecision           ? '#2c5aa0' : '#242430', 'PRECISION',  enPrecision);
  bouton(ZT.tabCouleur,   mode === MODE.COULEUR ? '#2c5aa0' : '#242430', 'COULEUR',    mode === MODE.COULEUR);

  if (mode === MODE.LIBRE) {
    ctx.fillStyle = '#aaa'; ctx.font = '13px sans-serif';
    ctx.fillText('Grip pour attraper la cible actuelle', PW / 2, 150);
    ctx.fillText('2 grips en meme temps = zoom', PW / 2, 172);
  } else if (enPrecision) {
    ctx.font = 'bold 15px sans-serif';
    bouton(ZP.translater, mode === MODE.GIZMO_T ? '#2c5aa0' : '#333', 'TRANSLATER', mode === MODE.GIZMO_T);
    bouton(ZP.tourner,    mode === MODE.GIZMO_R ? '#2c5aa0' : '#333', 'TOURNER',    mode === MODE.GIZMO_R);
    ctx.font = 'bold 13px sans-serif';
    bouton(ZP.reset0Pos, '#444', '0 POSITION', false);
    bouton(ZP.reset0Rot, '#444', '0 ROTATION', false);
    bouton(ZP.resetTout, '#8e5a2b', 'TOUT REMETTRE A ZERO', false);
    ctx.fillStyle = '#8fd6ff'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText('Echelle : ' + Math.round(pourcentageEchelle()) + ' % du reel', PW / 2, 250);
  } else if (mode === MODE.COULEUR) {
    for (var i = 0; i < PALETTE.length; i++) {
      var z = zoneCouleur(i);
      ctx.fillStyle = hex(PALETTE[i]); rr(ctx, z.x, z.y, z.w, z.h, 8); ctx.fill();
      ctx.strokeStyle = (i === couleurIdx) ? '#ffee00' : '#666';
      ctx.lineWidth = (i === couleurIdx) ? 5 : 1;
      rr(ctx, z.x, z.y, z.w, z.h, 8); ctx.stroke();
    }
    ctx.font = 'bold 13px sans-serif';
    bouton(ZC.auto,  '#444', 'COLORIER AUTO', false);
    bouton(ZC.reset, '#444', 'REINITIALISER', false);
  }

  // --- Annuler / Refaire ---
  ctx.font = 'bold 15px sans-serif';
  bouton(ZU.annuler, historique.length ? '#444' : '#262626', 'ANNULER', false, historique.length ? '#fff' : '#666');
  bouton(ZU.refaire, refaire.length    ? '#444' : '#262626', 'REFAIRE', false, refaire.length    ? '#fff' : '#666');

  // --- Toujours visibles ---
  ctx.font = 'bold 16px sans-serif';
  bouton(ZB.replacer, '#2c5aa0', 'REPLACER SUR LA TABLE', false);
  bouton(ZB.quitter,  '#8e2b2b', 'QUITTER', false);

  ctx.fillStyle = '#666'; ctx.font = '11px sans-serif';
  var infoCible = cibleType === CIBLE.MODELE ? '' : (' - ' + selection.length + ' piece(s) selectionnee(s)');
  ctx.fillText(nomModeleCourant + infoCible, PW / 2, PH - 10);

  tex.needsUpdate = true;
}

function zoneTouchee(uv) {
  var cx = uv.x * PW;
  var cy = (1 - uv.y) * PH;
  function dans(z) { return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h; }

  if (dans(ZA.modele)) return 'cible-modele';
  if (dans(ZA.groupe)) return 'cible-groupe';
  if (cibleType === CIBLE.GROUPE && dans(ZA.choisir)) return 'choisir';

  if (dans(ZT.tabLibre))     return 'tabLibre';
  if (dans(ZT.tabPrecision)) return 'tabPrecision';
  if (dans(ZT.tabCouleur))   return 'tabCouleur';

  if (dans(ZU.annuler))  return 'annuler';
  if (dans(ZU.refaire))  return 'refaire';
  if (dans(ZB.replacer)) return 'replacer';
  if (dans(ZB.quitter))  return 'quitter';

  if (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R) {
    if (dans(ZP.translater)) return 'translater';
    if (dans(ZP.tourner))    return 'tourner';
    if (dans(ZP.reset0Pos))  return 'reset0Pos';
    if (dans(ZP.reset0Rot))  return 'reset0Rot';
    if (dans(ZP.resetTout))  return 'resetTout';
  } else if (mode === MODE.COULEUR) {
    if (dans(ZC.auto))  return 'auto';
    if (dans(ZC.reset)) return 'reset';
    for (var i = 0; i < PALETTE.length; i++) { if (dans(zoneCouleur(i))) return 'couleur' + i; }
  }
  return null;
}

function traiterClicPanneau(zone) {
  if (!zone) return;
  if (zone === 'cible-modele') { definirCibleType(CIBLE.MODELE); return; }
  if (zone === 'cible-groupe') { definirCibleType(CIBLE.GROUPE); return; }
  if (zone === 'choisir')      { enChoixCible = !enChoixCible; majPanneau(); return; }
  if (zone === 'tabLibre')     { definirMode(MODE.LIBRE); return; }
  if (zone === 'tabPrecision') { definirMode(MODE.GIZMO_T); return; }
  if (zone === 'tabCouleur')   { definirMode(MODE.COULEUR); return; }
  if (zone === 'translater')   { definirMode(MODE.GIZMO_T); return; }
  if (zone === 'tourner')      { definirMode(MODE.GIZMO_R); return; }
  if (zone === 'reset0Pos')    { resetPosition(); return; }
  if (zone === 'reset0Rot')    { resetRotation(); return; }
  if (zone === 'resetTout')    { resetTout(); return; }
  if (zone === 'auto')         { colorierAutomatiquement(); return; }
  if (zone === 'reset')        { reinitialiserCouleurs(); return; }
  if (zone === 'annuler')      { annuler(); return; }
  if (zone === 'refaire')      { retablir(); return; }
  if (zone === 'replacer')     { replacer(); return; }
  if (zone === 'quitter')      { quitterAR(); return; }
  if (zone.indexOf('couleur') === 0) {
    couleurIdx = parseInt(zone.slice(7), 10);
    majPanneau();
  }
}

var panneau = new THREE.Mesh(
  new THREE.PlaneGeometry(PLANE_W, PLANE_H),
  new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
);
panneau.position.set(0, 0.5, 0);
panneau.visible = false;
anchor.add(panneau);

// ============================================================================
//  MODE (comment on manipule la cible courante)
// ============================================================================
var MODE = { LIBRE: 'libre', GIZMO_T: 'gizmo-t', GIZMO_R: 'gizmo-r', COULEUR: 'couleur' };
var mode = MODE.LIBRE;

function definirMode(m) {
  mode = m;
  dragEtat = null;
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

  var hitsPanneau = ray.intersectObject(panneau, false);
  if (hitsPanneau.length && hitsPanneau[0].uv) {
    traiterClicPanneau(zoneTouchee(hitsPanneau[0].uv));
    return;
  }

  if (enChoixCible) { gererClicSelection(ray); return; }

  if (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R) {
    var typeActif = (mode === MODE.GIZMO_T) ? 'translate' : 'rotate';
    var typeZero  = (mode === MODE.GIZMO_T) ? 'zero-t' : 'zero-r';
    var poigneesActives = poignees.filter(function (pg) { return pg.type === typeActif || pg.type === typeZero; });
    var hitsPoignee = ray.intersectObjects(poigneesActives.map(function (pg) { return pg.mesh; }), false);
    if (hitsPoignee.length) {
      var poignee = poigneesActives.filter(function (pg) { return pg.mesh === hitsPoignee[0].object; })[0];
      if (poignee.type === 'zero-t') { resetAxeTranslation(poignee.axeLettre); return; }
      if (poignee.type === 'zero-r') { resetAxeRotation(poignee.axeLettre); return; }
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
  // MODE.LIBRE : rien au clic gachette, la saisie se fait au grip
}

// Recherche la piece de piecesMobiles la plus proche de posControleur (par
// distance a sa sphere englobante), utilisee par B+grip. rayonMax = tolerance
// de capture (pas de rayon laser ici, uniquement de la proximite, comme la
// saisie main libre normale).
function piecePlusProche(posControleur, rayonMax) {
  var meilleure = null, meilleureDist = rayonMax;
  piecesMobiles.forEach(function (p) {
    var box = new THREE.Box3().setFromObject(p);
    var sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    var d = Math.max(posControleur.distanceTo(sphere.center) - sphere.radius, 0);
    if (d < meilleureDist) { meilleureDist = d; meilleure = p; }
  });
  return meilleure;
}
// Lit l'etat d'un bouton de la manette (A/X = 4, B/Y = 5 sur le mapping
// standard WebXR "xr-standard" des manettes Quest) - WebXR n'a pas
// d'evenement natif pour ces boutons, il faut lire le Gamepad a la demande.
function boutonAppuye(ctrl, index) {
  try {
    var gp = ctrl.userData.src && ctrl.userData.src.gamepad;
    return !!(gp && gp.buttons && gp.buttons[index] && gp.buttons[index].pressed);
  } catch (e) { return false; }
}

controllers.forEach(function (ctrl, idx) {
  scene.add(ctrl);
  var geoL = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  var ligne = new THREE.Line(geoL, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  ligne.scale.z = 1.5;
  ctrl.add(ligne);
  ctrl.addEventListener('connected',    function (e) { ctrl.userData.src = e.data; });
  ctrl.addEventListener('disconnected', function ()  { ctrl.userData.src = null; });

  ctrl.addEventListener('squeezestart', function () {
    if (!anchorPlaced) return;
    gripEtat[idx] = true;
    if (gripEtat[0] && gripEtat[1]) {
      if (grabIdx !== -1) terminerGrab();
      demarrerZoom();
      return;
    }
    if (mode !== MODE.LIBRE || grabIdx !== -1 || modeZoom) return;

    var p = new THREE.Vector3();
    ctrl.getWorldPosition(p);

    // A/X (bouton 4) = cible le modele entier. B/Y (bouton 5) = cible
    // uniquement la piece la plus proche de la manette. Grip seul (sans
    // bouton) = reprend la cible actuelle (modele, piece ou groupe deja
    // choisi via le panneau), pour pouvoir la re-saisir sans rappuyer.
    if (boutonAppuye(ctrl, 4)) {
      enChoixCible = false;
      definirCibleType(CIBLE.MODELE);
    } else if (boutonAppuye(ctrl, 5)) {
      var piece = piecePlusProche(p, 0.2);
      if (piece) {
        enChoixCible = false;
        cibleType = CIBLE.PIECE;
        selection = [piece];
        surlignerSelection();
        reconstruireCible();
        majPanneau();
      }
    }

    var c = cibleCourante();
    if (!c) return;
    if (pointDeGrabProche(p)) {
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

  ctrl.addEventListener('selectstart', function () { gererSelectStart(idx, ctrl); });
  ctrl.addEventListener('selectend', function () {
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
    panneau.visible = carPret;
  }

  if (anchor.visible && panneau.parent) {
    var camPos = new THREE.Vector3();
    camera.getWorldPosition(camPos);
    panneau.lookAt(camPos);
  }

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
  }

  if (panneauSale) dessinerPanneau();

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

        anchorPlaced    = false;
        anchor.visible  = false;
        reticle.visible = false;
        preview.visible = false;
        panneau.visible = false;
        relacherSelection();
        selection = [];
        piecesSurlignees = [];
        cibleType = CIBLE.MODELE;
        enChoixCible = false;
        definirMode(MODE.LIBRE);
        grabIdx = -1; grabAvant = null;
        modeZoom = false; gripEtat = [false, false];

        if (racineModele) { pivot.remove(racineModele); racineModele = null; }
        pieces = [];
        piecesMobiles = [];
        carPret = false;
      });
    }).catch(function (e2) {
      status.textContent = 'Erreur setSession: ' + e2.message;
    });
  }).catch(function (e) {
    status.textContent = 'Erreur AR: ' + e.message;
  });
});

}); // fin window.addEventListener('load', ...)
