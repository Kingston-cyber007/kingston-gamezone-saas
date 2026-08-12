-- Migration : réparation des fixtures RTE legacy — création des profils manquants
--              et attribution du rôle 'client' pour les comptes sans rattachement.
-- Date : 2026-08-10
-- Contexte : pour faire passer TEST 1/3 (FEAT-1 auto-suppression /client) du
--   CHANTIER 3, on a besoin d'un user authentifié avec role='client' dans
--   user_tenant_roles. Or le seed RTE a créé 3 auth.users sur le projet
--   actuel (ybqsfyufnpmhlhdtwkon) :
--     - enfantsmpansou@gmail.com : profile OK, role=lounge_admin (pas client)
--     - client@kingstongamezone.com : AUCUN profile, 0 rôle  ← FIX ICI
--     - staff@kingstongamezone.com : AUCUN profile, 0 rôle    (pas requis pour TEST 1)
--   La FK user_tenant_roles_user_id_profile_fkey (posée par la migration
--   20260810000001) refuse l'INSERT dans user_tenant_roles tant que le profil
--   n'existe pas. Création du profile obligatoire.
--   Hypothèse confirmée (cf. dette #30) : ces fixtures viennent de l'ancien
--   projet Supabase (Lovable) avant la bascule vers le projet actuel ; le
--   trigger handle_new_user() n'a pas tourné au seed sur le nouveau projet.
--
-- Stratégie : 2 phases idempotentes, ON CONFLICT DO NOTHING partout pour
--   permettre au seed d'être ré-exécuté sans erreur.
--   Phase A : INSERT profiles pour client@ et staff@ (PII minimales —
--     nom/prenom à NULL, display_name = local-part de l'email, created_at
--     = auth.users.created_at pour cohérence historique).
--   Phase B : INSERT user_tenant_roles(user_id, tenant_id, role='client')
--     pour client@ sur le tenant "Kingston GameZone". Pour staff@ on
--     n'attribue PAS de rôle : reste admin platform-only via la table
--     platform_admins (à confirmer hors-périmètre de cette migration).
--
-- Note dette #30 (réouverte) : la FK user_tenant_roles.user_id → profiles.id
--   a précisément rempli son rôle ici — sans elle, on aurait pu créer
--   des affiliations orphelines. C'est un signal que la dette est résolue
--   côté structure, et que la dette est devenue "dette historique de seed"
--   à fermer par cette migration.
--
-- Rollback (manuel) :
--   DELETE FROM public.user_tenant_roles WHERE user_id IN (SELECT id FROM auth.users WHERE email IN ('client@kingstongamezone.com','staff@kingstongamezone.com')) AND role='client';
--   DELETE FROM public.profiles WHERE email IN ('client@kingstongamezone.com','staff@kingstongamezone.com');

-- Phase A : créer les profils manquants (id = auth.users.id, valeurs par défaut cohérentes)
INSERT INTO public.profiles (id, email, display_name, created_at, updated_at)
SELECT
  u.id,
  u.email,
  split_part(u.email, '@', 1) AS display_name,
  u.created_at,
  now() AS updated_at
FROM auth.users u
WHERE u.email IN ('client@kingstongamezone.com', 'staff@kingstongamezone.com')
  AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Phase B : attribuer role='client' à client@ sur le tenant "Kingston GameZone"
INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
SELECT
  u.id,
  t.id,
  'client' AS role
FROM auth.users u
CROSS JOIN public.tenants t
WHERE u.email = 'client@kingstongamezone.com'
  AND t.name = 'Kingston GameZone'
ON CONFLICT DO NOTHING;
