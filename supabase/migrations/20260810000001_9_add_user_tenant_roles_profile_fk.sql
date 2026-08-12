-- Migration : ajout FK explicite user_tenant_roles.user_id → public.profiles(id)
-- Date : 2026-08-10
-- Contexte : dette #27 + CHANTIER 3 C.3. La requête PostgREST
--   supabase.from('profiles').select('..., user_tenant_roles:user_tenant_roles!fk(role)')
--   est typée correctement par supabase-js UNIQUEMENT si une Relationships[]
--   existe dans le type auto-généré. Or la FK existante pointe vers
--   auth.users(id), que le client TS ignore (schema auth hors scan).
--   Ajout d'une seconde FK vers public.profiles(id), qui elle apparaît
--   dans Relationships[] et rend la jointure typable sans `as any`.
--
-- ON DELETE RESTRICT (pas CASCADE) — alignement avec staff_applications :
--   Si auth.admin.deleteUser() (dette #29) supprime un user, son profil est
--   supprimé via handle_new_user ON DELETE CASCADE. RESTRICT empêche alors
--   le hard-delete tant qu'une affiliation rôle/salle existe — force dette #29
--   à traiter explicitement la traçabilité (qui était staff de quelle salle)
--   avant suppression. user_tenant_roles porte "qui avait quel rôle, sur quel
--   tenant" — donnée de traçabilité au même titre que staff_applications
--   (reviewer_id/rejection_reason/reviewed_at), même exigence de conservation.
--   Coût nul aujourd'hui (dette #29 non construite), sécurité future max.
--
-- Stratégie : NOT VALID + cleanup orphelins + VALIDATE.
--   - Phase A : ajouter la contrainte NOT VALID (skip le check existant,
--     permet de pousser la migration même si des orphelins historiques
--     pointent vers des profiles inexistants — risque réel car la FK
--     user_tenant_roles.user_id → auth.users.id existe depuis longtemps
--     et certains user_id pourraient ne pas avoir de profile créé si
--     handle_new_user() a échoué pour eux ou s'ils ont été créés avant
--     l'installation du trigger).
--   - Phase B : DELETE orphelins (user_id sans profile correspondant).
--     C'est une opération destructive mais les orphelins sont des lignes
--     mortes (un user sans profile ne peut pas se connecter, sa
--     candidature/affiliation n'a aucun effet opérationnel).
--   - Phase C : VALIDATE CONSTRAINT pour activer le check d'intégrité
--     sur les futures INSERT/UPDATE.
--
-- Note dette #30 : si des orphelins sont supprimés ici, c'est un signal
-- qu'on a un défaut de cohérence (user_tenant_roles.user_id doit toujours
-- correspondre à un profile existant). À creuser si volume > 0.
DO $$
DECLARE
  v_orphan_count integer;
BEGIN
  -- Phase A : ajouter la FK NOT VALID
  ALTER TABLE public.user_tenant_roles
    ADD CONSTRAINT user_tenant_roles_user_id_profile_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id)
    ON DELETE RESTRICT
    NOT VALID;

  -- Phase B : cleanup orphelins (profiles manquants)
  DELETE FROM public.user_tenant_roles utr
  WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = utr.user_id);
  GET DIAGNOSTICS v_orphan_count = ROW_COUNT;
  IF v_orphan_count > 0 THEN
    RAISE NOTICE '[KG migration] Supprimé % ligne(s) user_tenant_roles orpheline(s) (user_id sans profile correspondant)', v_orphan_count;
  END IF;

  -- Phase C : valider la contrainte
  ALTER TABLE public.user_tenant_roles
    VALIDATE CONSTRAINT user_tenant_roles_user_id_profile_fkey;
END $$;