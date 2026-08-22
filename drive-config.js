// ============================================================================
//  CONFIGURATION GOOGLE DRIVE - a remplir en suivant le guide pas-a-pas du
//  LISEZ-MOI.md (section "Modeles et photos via Google Drive").
//  Tant que ces valeurs commencent par "COLLE_", les fonctionnalites Drive
//  sont IGNOREES silencieusement (l'appli continue de marcher normalement
//  avec modeles.json et sans envoi de photo).
// ============================================================================
window.DRIVE_CONFIG = {
  // Cle API Google Drive (Google Cloud Console > APIs & Services >
  // Identifiants > Creer des identifiants > Cle API), restreinte a l'API
  // Google Drive + au site gmpbordeaux.fr. Sert a LIRE la liste des modeles.
  apiKey: 'COLLE_TA_CLE_API_ICI',

  // ID du dossier Google Drive contenant les modeles .glb (partage "Toute
  // personne disposant du lien" = Lecteur). C'est la partie apres
  // /folders/ dans le lien de partage du dossier.
  folderId: 'COLLE_ID_DOSSIER_MODELES_ICI',

  // URL de l'application web Google Apps Script (se termine par /exec),
  // qui recoit les photos prises dans l'appli et les enregistre dans un
  // dossier Drive dedie. Voir apps-script-photo.gs pour le code a deployer.
  photoUploadUrl: 'COLLE_URL_APPS_SCRIPT_ICI',

  // Mot de passe simple partage entre cette page et l'Apps Script, pour
  // eviter qu'un inconnu qui devinerait l'URL ne remplisse le dossier de
  // photos au hasard. Doit etre IDENTIQUE a la valeur SECRET du script
  // apps-script-photo.gs.
  photoSecret: 'CHANGE-MOI-1234'
};
