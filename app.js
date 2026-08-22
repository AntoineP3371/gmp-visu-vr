window.addEventListener('load', function () {

// ============================================================================
//  VISIONNEUSE CAO EN REALITE MIXTE
//  Charge un modele GLB (issu d'un export STEP 3DEXPERIENCE converti sur PC),
//  le pose sur une vraie surface, permet de le manipuler (main libre ou
//  gizmo precis avec pivot reglable) et de colorer ses pieces.
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
//    pivot : LE point de manipulation reglable (translate/rotate agissent ici)
//      racineModele : le GLB centre/mis a l'echelle
// ============================================================================
var anchor = new THREE.Group();
anchor.visible = false;
scene.add(anchor);
var anchorPlaced = false;

var pivot = new THREE.Group();
anchor.add(pivot);

var racineModele  = null;
var pieces        = [];     // tous les meshes coloriables (traverse complet)
var carPret        = false;
var nomModeleCourant = '';

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
  definirMode(MODE.LIBRE);
}
function quitterAR() {
  try {
    var s = renderer.xr.getSession();
    if (s) s.end();
  } catch (e) {}
}

// ============================================================================
//  CHARGEMENT DU MODELE
// ============================================================================
function ajusterTaille(objet, tailleCible) {
  var box = new THREE.Box3().setFromObject(objet);
  var taille = new THREE.Vector3();
  box.getSize(taille);
  var maxDim = Math.max(taille.x, taille.y, taille.z);
  if (maxDim > 0) objet.scale.setScalar(tailleCible / maxDim);
}

var loader = new THREE.GLTFLoader();

function chargerModele(fichier) {
  loader.load(fichier, function (gltf) {
    var root = gltf.scene;

    // ATTENTION : tout le recentrage se fait TANT QUE root n'a PAS de parent.
    // Box3.setFromObject renvoie des coordonnees MONDE : si root etait deja
    // rattache au pivot (deja positionne sur la table), on soustrairait un
    // decalage monde a une position locale et le modele partirait hors de vue.
    ajusterTaille(root, 0.30);
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

    pivot.updateMatrixWorld(true);
    carPret = true;
    majPanneau();
  }, undefined, function (e) {
    errbox.textContent = 'Erreur GLB: ' + e;
  });
}

// ============================================================================
//  ETAT / MODES DE MANIPULATION
// ============================================================================
var MODE = { LIBRE: 'libre', GIZMO_T: 'gizmo-t', GIZMO_R: 'gizmo-r', COULEUR: 'couleur' };
var mode = MODE.LIBRE;
var dragEtat = null;

function definirMode(m) {
  mode = m;
  gizmoTranslate.visible = (m === MODE.GIZMO_T);
  gizmoRotate.visible    = (m === MODE.GIZMO_R);
  dragEtat = null;
  majPanneau();
}

// ============================================================================
//  A. MAIN LIBRE : saisie 6DOF de l'ensemble anchor.attach(pivot)/ctrl.attach(pivot)
// ============================================================================
var SEUIL_MARGE = 0.15;   // marge de tolerance autour de la sphere englobante
var grabIdx = -1;

function pointDeGrabProche(posControleur) {
  if (!racineModele) return false;
  var box = new THREE.Box3().setFromObject(racineModele);
  var sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  return posControleur.distanceTo(sphere.center) < (sphere.radius + SEUIL_MARGE);
}

// ============================================================================
//  B. GIZMO DE MANIPULATION PRECISE (translation + rotation, pivot reglable)
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

var gizmoTranslate = new THREE.Group();
var gizmoRotate    = new THREE.Group();
pivot.add(gizmoTranslate, gizmoRotate);
gizmoTranslate.visible = false;
gizmoRotate.visible    = false;

var poignees = [];   // { mesh (halo, sert au raycast), axe, type: 'translate'|'rotate' }

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
});

// Contre-rotation : les axes du gizmo restent alignes sur la TABLE (anchor),
// pas sur le modele - sinon "l'axe rouge" change de sens physique a chaque
// rotation, ce qui perd vite un debutant.
function orienterGizmo() {
  // gizmoTranslate/gizmoRotate sont enfants de pivot : leur quaternion LOCAL
  // doit annuler celui de pivot (pas son quaternion MONDE, qui inclurait
  // aussi la rotation de l'ancre) pour que le gizmo reste aligne sur la
  // table quelle que soit la rotation deja appliquee au modele.
  var q = pivot.quaternion.clone().invert();
  gizmoTranslate.quaternion.copy(q);
  gizmoRotate.quaternion.copy(q);
}

// Deplace le pivot (et le gizmo, qui le suit puisqu'il est son enfant a
// l'origine locale) SANS deplacer visuellement le modele : on re-attache le
// modele apres coup, ce qui recalcule sa position locale pour compenser.
function reposerPivot(pointMonde) {
  var local = anchor.worldToLocal(pointMonde.clone());
  pivot.position.copy(local);
  pivot.updateMatrixWorld(true);
  pivot.attach(racineModele);
}

function projeteSurPlan(v, axe) {
  return v.clone().sub(axe.clone().multiplyScalar(v.dot(axe)));
}
function angleSigneAutourAxe(a, b, axe) {
  var croix = new THREE.Vector3().crossVectors(a, b);
  return Math.atan2(croix.dot(axe), a.dot(b));
}

function demarrerDragTranslate(idx, poignee) {
  var p = new THREE.Vector3();
  controllers[idx].getWorldPosition(p);
  var posPivot = new THREE.Vector3();
  pivot.getWorldPosition(posPivot);
  dragEtat = {
    idx: idx, poignee: poignee, mode: 'translate',
    posDepartControleur: p,
    posDepartPivot: posPivot
  };
}

// Deplacement brut de la manette projete sur l'axe (figé au debut du drag,
// exprime dans le repere de l'ancre) : la manette donnant deja une position
// 3D a chaque frame, inutile de chercher le point le plus proche sur une
// droite (technique reservee a une souris 2D sans profondeur).
function majDragTranslate() {
  var pActuel = new THREE.Vector3();
  controllers[dragEtat.idx].getWorldPosition(pActuel);
  var delta = pActuel.clone().sub(dragEtat.posDepartControleur);
  var qAncre = new THREE.Quaternion();
  anchor.getWorldQuaternion(qAncre);
  var axeMonde = dragEtat.poignee.axe.clone().applyQuaternion(qAncre);
  var deplacement = axeMonde.multiplyScalar(delta.dot(axeMonde));
  var nouveauMonde = dragEtat.posDepartPivot.clone().add(deplacement);
  pivot.position.copy(anchor.worldToLocal(nouveauMonde));
}

function demarrerDragRotate(idx, poignee) {
  var pivotPos = new THREE.Vector3();
  pivot.getWorldPosition(pivotPos);
  var pC = new THREE.Vector3();
  controllers[idx].getWorldPosition(pC);
  var qAncre = new THREE.Quaternion();
  anchor.getWorldQuaternion(qAncre);
  var axeMonde = poignee.axe.clone().applyQuaternion(qAncre);
  var qPivot = new THREE.Quaternion();
  pivot.getWorldQuaternion(qPivot);
  dragEtat = {
    idx: idx, poignee: poignee, mode: 'rotate',
    axeMonde: axeMonde, pivotPos: pivotPos,
    vDepart: projeteSurPlan(pC.clone().sub(pivotPos), axeMonde).normalize(),
    quatDepartPivot: qPivot
  };
}

// Angle signe autour de l'axe, entre le vecteur de depart et le vecteur
// courant (manette - pivot, projetes sur le plan perpendiculaire a l'axe).
function majDragRotate() {
  var pC = new THREE.Vector3();
  controllers[dragEtat.idx].getWorldPosition(pC);
  var vActuel = projeteSurPlan(pC.clone().sub(dragEtat.pivotPos), dragEtat.axeMonde).normalize();
  var angle = angleSigneAutourAxe(dragEtat.vDepart, vActuel, dragEtat.axeMonde);
  var qDelta = new THREE.Quaternion().setFromAxisAngle(dragEtat.axeMonde, angle);
  var qCible = qDelta.multiply(dragEtat.quatDepartPivot);
  var qAncreInv = new THREE.Quaternion();
  anchor.getWorldQuaternion(qAncreInv).invert();
  pivot.quaternion.copy(qAncreInv.multiply(qCible));
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
  if (Array.isArray(o.material)) {
    var idx = (inter.face && inter.face.materialIndex) || 0;
    if (!o.material[idx]) return;
    o.material[idx].color.setHex(couleurCourante());
  } else {
    o.material.color.setHex(couleurCourante());
  }
}

function colorierAutomatiquement() {
  var total = 0;
  pieces.forEach(function (o) { total += Array.isArray(o.material) ? o.material.length : 1; });
  var i = 0;
  pieces.forEach(function (o) {
    var mats = Array.isArray(o.material) ? o.material : [o.material];
    mats.forEach(function (m) {
      m.color.copy(new THREE.Color().setHSL(i / Math.max(total, 1), 0.65, 0.55));
      i++;
    });
  });
}

function reinitialiserCouleurs() {
  pieces.forEach(function (o) {
    var orig = o.userData.couleursOrigine;
    if (!orig) return;
    if (Array.isArray(o.material)) {
      o.material.forEach(function (m, i) { m.color.setHex(orig[i]); });
    } else {
      o.material.color.setHex(orig[0]);
    }
  });
}

// ============================================================================
//  PANNEAU DE COMMANDE (canvas 2D -> texture)
//  Les zones sont declarees UNE SEULE FOIS et servent a la fois au dessin et
//  a la detection du clic : impossible qu'elles se desynchronisent.
// ============================================================================
var PW = 512, PH = 300;
var PLANE_W = 0.42, PLANE_H = PLANE_W * PH / PW;

var ZT = {
  tabLibre:     { x: 8,   y: 8, w: 160, h: 36 },
  tabPrecision: { x: 176, y: 8, w: 160, h: 36 },
  tabCouleur:   { x: 344, y: 8, w: 160, h: 36 }
};
var ZP = {
  translater: { x: 8,   y: 56, w: 246, h: 54 },
  tourner:    { x: 262, y: 56, w: 242, h: 54 }
};
var ZC = {
  auto:  { x: 8,   y: 160, w: 246, h: 46 },
  reset: { x: 262, y: 160, w: 242, h: 46 }
};
var ZB = {
  replacer: { x: 8,   y: 220, w: 246, h: 50 },
  quitter:  { x: 262, y: 220, w: 242, h: 50 }
};
function zoneCouleur(i) {
  return { x: 8 + (i % 6) * 84, y: 56 + (i < 6 ? 0 : 48), w: 76, h: 40 };
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

  ctx.font = 'bold 15px sans-serif';
  var enPrecision = (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R);
  bouton(ZT.tabLibre,     mode === MODE.LIBRE ? '#2c5aa0' : '#242430', 'MAIN LIBRE', mode === MODE.LIBRE);
  bouton(ZT.tabPrecision, enPrecision           ? '#2c5aa0' : '#242430', 'PRECISION',  enPrecision);
  bouton(ZT.tabCouleur,   mode === MODE.COULEUR ? '#2c5aa0' : '#242430', 'COULEUR',    mode === MODE.COULEUR);

  ctx.textAlign = 'center'; ctx.fillStyle = '#aaa'; ctx.font = '13px sans-serif';

  if (mode === MODE.LIBRE) {
    ctx.fillText('Grip (gachette laterale) pour attraper le modele', PW / 2, 100);
  } else if (enPrecision) {
    ctx.font = 'bold 16px sans-serif';
    bouton(ZP.translater, mode === MODE.GIZMO_T ? '#2c5aa0' : '#333', 'TRANSLATER', mode === MODE.GIZMO_T);
    bouton(ZP.tourner,    mode === MODE.GIZMO_R ? '#2c5aa0' : '#333', 'TOURNER',    mode === MODE.GIZMO_R);
    ctx.font = '13px sans-serif'; ctx.fillStyle = '#aaa';
    ctx.fillText('Clic sur le modele = deplacer le centre de rotation', PW / 2, 135);
  } else if (mode === MODE.COULEUR) {
    for (var i = 0; i < PALETTE.length; i++) {
      var z = zoneCouleur(i);
      ctx.fillStyle = hex(PALETTE[i]); rr(ctx, z.x, z.y, z.w, z.h, 8); ctx.fill();
      ctx.strokeStyle = (i === couleurIdx) ? '#ffee00' : '#666';
      ctx.lineWidth = (i === couleurIdx) ? 5 : 1;
      rr(ctx, z.x, z.y, z.w, z.h, 8); ctx.stroke();
    }
    ctx.font = 'bold 14px sans-serif';
    bouton(ZC.auto,  '#444', 'COLORIER AUTO', false);
    bouton(ZC.reset, '#444', 'REINITIALISER', false);
  }

  ctx.font = 'bold 16px sans-serif';
  bouton(ZB.replacer, '#2c5aa0', 'REPLACER SUR LA TABLE', false);
  bouton(ZB.quitter,  '#8e2b2b', 'QUITTER', false);

  ctx.fillStyle = '#666'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(nomModeleCourant, PW / 2, PH - 10);

  tex.needsUpdate = true;
}

function zoneTouchee(uv) {
  var cx = uv.x * PW;
  var cy = (1 - uv.y) * PH;
  function dans(z) { return cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h; }

  if (dans(ZT.tabLibre))     return 'tabLibre';
  if (dans(ZT.tabPrecision)) return 'tabPrecision';
  if (dans(ZT.tabCouleur))   return 'tabCouleur';
  if (dans(ZB.replacer))     return 'replacer';
  if (dans(ZB.quitter))      return 'quitter';

  if (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R) {
    if (dans(ZP.translater)) return 'translater';
    if (dans(ZP.tourner))    return 'tourner';
  } else if (mode === MODE.COULEUR) {
    if (dans(ZC.auto))  return 'auto';
    if (dans(ZC.reset)) return 'reset';
    for (var i = 0; i < PALETTE.length; i++) { if (dans(zoneCouleur(i))) return 'couleur' + i; }
  }
  return null;
}

function traiterClicPanneau(zone) {
  if (!zone) return;
  if (zone === 'tabLibre')     { definirMode(MODE.LIBRE); return; }
  if (zone === 'tabPrecision') { definirMode(MODE.GIZMO_T); return; }
  if (zone === 'tabCouleur')   { definirMode(MODE.COULEUR); return; }
  if (zone === 'translater')   { definirMode(MODE.GIZMO_T); return; }
  if (zone === 'tourner')      { definirMode(MODE.GIZMO_R); return; }
  if (zone === 'auto')         { colorierAutomatiquement(); return; }
  if (zone === 'reset')        { reinitialiserCouleurs(); return; }
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
panneau.position.set(0, 0.42, 0);
panneau.visible = false;
anchor.add(panneau);

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

  if (mode === MODE.GIZMO_T || mode === MODE.GIZMO_R) {
    var typeActif = (mode === MODE.GIZMO_T) ? 'translate' : 'rotate';
    var poigneesActives = poignees.filter(function (pg) { return pg.type === typeActif; });
    var hitsPoignee = ray.intersectObjects(poigneesActives.map(function (pg) { return pg.mesh; }), false);
    if (hitsPoignee.length) {
      var poignee = poigneesActives.filter(function (pg) { return pg.mesh === hitsPoignee[0].object; })[0];
      if (mode === MODE.GIZMO_T) demarrerDragTranslate(idx, poignee);
      else demarrerDragRotate(idx, poignee);
      return;
    }
    if (pieces.length) {
      var hitsModele = ray.intersectObjects(pieces, false);
      if (hitsModele.length) reposerPivot(hitsModele[0].point);
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

controllers.forEach(function (ctrl, idx) {
  scene.add(ctrl);
  var geoL = new THREE.BufferGeometry().setFromPoints(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  var ligne = new THREE.Line(geoL, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
  ligne.scale.z = 1.5;
  ctrl.add(ligne);

  ctrl.addEventListener('squeezestart', function () {
    if (!anchorPlaced || mode !== MODE.LIBRE || grabIdx !== -1) return;
    var p = new THREE.Vector3();
    ctrl.getWorldPosition(p);
    if (pointDeGrabProche(p)) {
      grabIdx = idx;
      ctrl.attach(pivot);
    }
  });
  ctrl.addEventListener('squeezeend', function () {
    if (grabIdx !== idx) return;
    anchor.attach(pivot);
    grabIdx = -1;
  });

  ctrl.addEventListener('selectstart', function () { gererSelectStart(idx, ctrl); });
  ctrl.addEventListener('selectend', function () {
    if (dragEtat && dragEtat.idx === idx) dragEtat = null;
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

  if (dragEtat) { if (dragEtat.mode === 'translate') majDragTranslate(); else majDragRotate(); }
  if (gizmoTranslate.visible || gizmoRotate.visible) orienterGizmo();

  if (panneauSale) dessinerPanneau();

  renderer.render(scene, camera);
});

// --- Bouton "Entrer en realite mixte" ---
document.getElementById('btnCommencer').addEventListener('click', function () {
  var fichier = selectModele.value;
  if (!fichier) { status.textContent = 'Choisissez un modele'; return; }
  nomModeleCourant = selectModele.options[selectModele.selectedIndex].textContent;

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
        definirMode(MODE.LIBRE);

        if (racineModele) { pivot.remove(racineModele); racineModele = null; }
        pieces = [];
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
