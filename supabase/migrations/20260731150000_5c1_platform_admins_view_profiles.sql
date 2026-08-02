-- ================================================================
-- RT.P.0-profiles — Policy platform_admins can view profiles
-- ================================================================
-- Contexte : dette #11 documentée dans MEMOIRE_CAISSE.md et dans le
-- commentaire de `src/views/components/TenantUsersModal.tsx` ligne 15-19 :
--   "La RLS `profiles` SELECT est `auth.uid() = id` → le platform_admin ne
--    peut pas lire les profils des autres users. Conséquence : `email` est
--    souvent `null` côté UI, on affiche honnêtement '— (lecture restreint)'."
--
-- Cette migration ajoute une policy SELECT qui autorise les platform_admins
-- à lire TOUS les profils. Conséquences :
--  + `TenantUsersModal` affichera les vrais emails (plus de "— (lecture
--    restreinte)").
--  + Le tracking via `audit_log` mentionné dans la dette #11 reste à
--    implémenter (chantier dédié dette #25). Cette migration n'ajoute PAS
--    de log d'accès — c'est une dette acceptée, pas une régression.
--  - Surface d'attaque élargie : un platform_admin compromis peut lire
--    tous les emails/display_name. C'est la même surface que pour les
--    sessions_caisse/tickets (cf. dette #5 — is_platform_admin OR-é partout).
--    À arbitrer en phase C.
--
-- Dépendances : utilise `public.is_platform_admin(auth.uid())` créée par
-- la migration 20260725113348.
--
-- Exécution : `supabase db push` côté Yannick (cf. RT.H.7).
-- ================================================================

-- Policy : platform_admins peuvent SELECT tous les profils.
-- Note : ne supprime PAS la policy "Users can view their own profile"
-- (ligne 25 de 20260723171443) — les deux policies sont OR-é par défaut
-- dans Postgres, donc chaque user garde son propre SELECT + les platform_admins
-- voient tout.
CREATE POLICY "Platform admins can view all profiles" ON public.profiles
  FOR SELECT
  USING (public.is_platform_admin(auth.uid()));

-- Pas de modification de UPDATE/INSERT : un platform_admin ne doit PAS
-- pouvoir modifier les profils des autres users (sécurité). Cette policy
-- reste cantonnée au SELECT.