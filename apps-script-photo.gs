// ============================================================================
//  A COLLER DANS script.google.com (Nouveau projet), puis deployer en
//  "Application Web" (Exécuter en tant que : Moi / Qui a accès : Tout le
//  monde). Voir le guide pas-a-pas dans LISEZ-MOI.md.
//  Recoit une photo (base64) envoyee par la Visionneuse CAO et l'enregistre
//  dans un dossier Google Drive dedie.
// ============================================================================

// A REMPLIR avant de deployer :
var FOLDER_ID = 'COLLE_ID_DOSSIER_PHOTOS_ICI';   // dossier Drive ou ranger les photos
var SECRET    = 'CHANGE-MOI-1234';               // DOIT etre identique a drive-config.js

function doPost(e) {
  try {
    var corps = JSON.parse(e.postData.contents);

    if (corps.secret !== SECRET) {
      return reponseJson({ ok: false, erreur: 'secret invalide' });
    }
    if (!corps.image) {
      return reponseJson({ ok: false, erreur: 'aucune image recue' });
    }

    var dossier = DriveApp.getFolderById(FOLDER_ID);
    var octets = Utilities.base64Decode(corps.image);
    var nom = corps.nom || ('photo-' + new Date().getTime() + '.png');
    var blob = Utilities.newBlob(octets, 'image/png', nom);
    dossier.createFile(blob);

    return reponseJson({ ok: true });
  } catch (erreur) {
    return reponseJson({ ok: false, erreur: String(erreur) });
  }
}

function reponseJson(objet) {
  return ContentService
    .createTextOutput(JSON.stringify(objet))
    .setMimeType(ContentService.MimeType.JSON);
}
