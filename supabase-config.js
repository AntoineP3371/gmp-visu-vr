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
  url: 'https://ggmlfbxppgeivfvlxxrj.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdnbWxmYnhwcGdlaXZmdmx4eHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzNDY5NTIsImV4cCI6MjA5NzkyMjk1Mn0.HvPE2ewB8gFgVzj-xAb1YBxFfn8hTEwOwQLDfF1vgT0',
  canal: 'visu-cao-live'
};
