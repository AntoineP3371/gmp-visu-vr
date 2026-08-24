// ============================================================================
//  CONFIGURATION DIFFUSION TEMPS REEL (ECRAN SPECTATEUR) - a remplir en
//  suivant le guide pas-a-pas du LISEZ-MOI.md (section "Ecran spectateur").
//  Tant que ces valeurs commencent par "COLLE_", la diffusion est IGNOREE
//  silencieusement (l'appli continue de marcher normalement, juste sans
//  ecran spectateur).
//
//  Reutilise le MEME projet Supabase que l'appli VR CEC (assemblage/deco) -
//  copie simplement l'URL et la cle anon deja utilisees la-bas, il n'y a
//  rien de nouveau a creer. Seul "canal" est propre a cette appli.
// ============================================================================
window.SUPABASE_CONFIG = {
  url: 'COLLE_URL_SUPABASE',
  anonKey: 'COLLE_CLE_ANON',
  canal: 'visu-cao-live'
};
