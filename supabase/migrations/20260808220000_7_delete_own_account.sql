-- ================================================================
-- FEAT-1 + FEAT-2 — Suppression de compte (soft-delete réversible)
-- ================================================================
-- Date originale : 2026-08-08 (V1 — anonymisation immédiate, annulée)
-- Date révision  : 2026-08-09 (V2 — stratégie C hybride)
-- Réécriture en place car V1 n'a jamais été commitée ni pushée
-- (vérifié 2026-08-09 : git status → untracked, aucun historique).
--
-- Stratégie finale (CHANTIER 3 — décision actée 2026-08-09) :
--   Clic (FEAT-1 ou FEAT-2) → soft_delete_profile()
--     - Pose profiles.deleted_at = now()
--     - Pose profiles.scheduled_purge_at = now() + 30j
--     - Pose auth.users.banned_until = profiles.scheduled_purge_at
--     - PII INTACTES (nom/prenom/email/display_name/telephone/sexe/age)
--       → permet annulation admin propre pendant la fenêtre 30j
--   Pendant 30j :
--     - Sign-in bloqué côté Supabase Auth (banned_until)
--     - Annulation : restore_deleted_profile() (admin-only via /platform)
--   À T+30j :
--     - Cron quotidien pg_cron → purge_expired_profiles()
--     - Anonymise PII (nom/prenom/email/display_name/telephone/sexe/age)
--     - Hard-delete auth.users (le profil profiles reste, mais vide)
--
-- Pourquoi banned_until scopée sur 30j (et pas '100 years') :
--   - Permet la restauration admin propre (UPDATE banned_until = NULL)
--   - Cohérent avec la fenêtre d'annulation prévue par RGPD
--   - Pas de "banni à vie" accidentel qui nécessiterait Dashboard manuel
--
-- Anti-footgun : count_platform_admins() AVANT soft_delete,
-- blocage 409 si dernier platform_admin s'auto-supprime.
--
-- Cette migration est volontairement UNE SEULE migration (règle 4 du CHANTIER 1).
-- Pas de ALTER TYPE donc pas de DO block EXCEPTION nécessaire.
-- ================================================================


-- ================================================================
-- PARTIE 1 : Colonnes soft-delete sur profiles
-- ================================================================
-- deleted_at            : timestamptz NULL. Posé quand l'user déclenche la suppression.
-- scheduled_purge_at    : timestamptz NULL. now() + 30j. Pilote le cron de purge.
--                         Tant que NULL, le compte est "vivant".
--
-- anonymized_at : timestamptz NULL. Distinction temporelle entre "demande de
-- suppression reçue" (deleted_at posé au clic) et "PII effacées" (anonymized_at
-- posé par le cron à T+30j). Pendant la fenêtre d'annulation, deleted_at est
-- non-NULL et anonymized_at reste NULL — le user est "demandé supprimé" mais
-- ses PII sont encore lisibles. Utile aussi pour l'UI : afficher un état
-- distinct "suppression en attente" vs "compte anonymisé".
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS anonymized_at timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_purge_at timestamptz;

COMMENT ON COLUMN public.profiles.deleted_at IS
  'FEAT-1 : posé au moment de la demande de suppression. NULL = compte actif. Ne PAS supprimer cette colonne en rollback — utiliser DROP COLUMN IF EXISTS.';
COMMENT ON COLUMN public.profiles.anonymized_at IS
  'FEAT-1 : posé au moment du cron purge_expired_profiles() (= T+30j). NULL = PII intactes. Distinct de deleted_at pour permettre une future séparation temporelle.';
COMMENT ON COLUMN public.profiles.scheduled_purge_at IS
  'FEAT-1 : fin de la fenêtre d''annulation (30j). Au-delà, cron purge_expired_profiles() anonymise + hard-delete auth.users.';

-- Index partiel : permet au cron pg_cron de scanner efficacement les comptes à purger.
-- WHERE scheduled_purge_at IS NOT NULL → réduit la taille de l'index.
CREATE INDEX IF NOT EXISTS idx_profiles_scheduled_purge
  ON public.profiles (scheduled_purge_at)
  WHERE scheduled_purge_at IS NOT NULL;


-- ================================================================
-- PARTIE 2 : Helper SQL — soft_delete_profile (idempotent)
-- ================================================================
-- Appelé par la Edge Function delete-own-account au moment du clic.
-- Effet :
--   1. Pose profiles.deleted_at + profiles.scheduled_purge_at = now() + 30j
-- La pose de auth.users.banned_until = scheduled_purge_at est faite
-- séparément par la Edge Function (service_role) pour respecter la
-- séparation des rôles : ce helper ne touche QUE profiles.
-- Idempotent : si déjà soft-deleted, retourne les valeurs existantes sans rien faire.
--
-- PII INTACTES (cf. décision stratégie C). is_minor reste calculable.
--
-- Pourquoi SECURITY DEFINER : permet à la fonction d'écrire dans profiles même
-- si le caller n'a pas les droits UPDATE sur la ligne. Le caller doit avoir
-- EXECUTE sur la fonction (GRANT ci-dessous).
CREATE OR REPLACE FUNCTION public.soft_delete_profile(_user_id uuid)
RETURNS TABLE (
  deleted_at timestamptz,
  scheduled_purge_at timestamptz,
  already_deleted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_at timestamptz;
  v_scheduled_purge timestamptz;
  v_already boolean := false;
BEGIN
  -- Si déjà soft-deleted, retourne les valeurs existantes (idempotent).
  SELECT p.deleted_at, p.scheduled_purge_at
    INTO v_deleted_at, v_scheduled_purge
  FROM public.profiles p
  WHERE p.id = _user_id;

  IF v_deleted_at IS NOT NULL THEN
    v_already := true;
    RETURN QUERY SELECT v_deleted_at, v_scheduled_purge, v_already;
    RETURN;
  END IF;

  v_deleted_at := now();
  v_scheduled_purge := v_deleted_at + INTERVAL '30 days';

  UPDATE public.profiles
  SET deleted_at = v_deleted_at,
      scheduled_purge_at = v_scheduled_purge
  WHERE id = _user_id;

  -- anonymized_at reste NULL ici (sera posé par purge_expired_profiles() à T+30j).
  RETURN QUERY SELECT v_deleted_at, v_scheduled_purge, v_already;
END;
$$;

COMMENT ON FUNCTION public.soft_delete_profile(uuid) IS
  'FEAT-1 : pose deleted_at + scheduled_purge_at = now()+30j. PII intactes. Idempotent. Ne touche PAS auth.users.banned_until (à faire par la Edge Function avec service_role).';

GRANT EXECUTE ON FUNCTION public.soft_delete_profile(uuid) TO service_role;


-- ================================================================
-- PARTIE 3 : Helper SQL — purge_expired_profiles (cron pg_cron)
-- ================================================================
-- Appelé quotidiennement par pg_cron. Pour chaque profile où
-- scheduled_purge_at < now() ET deleted_at IS NOT NULL ET anonymized_at IS NULL :
--   1. Anonymise les colonnes PII
--   2. Pose anonymized_at = now()
-- Le hard-delete de auth.users est fait par la Edge Function
-- hard-delete-anonymized-users (dette future) ou via SQL dans cette même
-- fonction si on GRANT UPDATE sur auth.users à service_role.
--
-- Stratégie incrémentale : on traite par batch de 100 pour éviter de locker
-- la table si beaucoup de comptes expirent en même temps.
--
-- is_minor est GENERATED ALWAYS — passage age à NULL recalcule is_minor=false
-- automatiquement (cf. migration 20260803113500 ligne 48).
CREATE OR REPLACE FUNCTION public.purge_expired_profiles(batch_size integer DEFAULT 100)
RETURNS TABLE (
  purged_user_id uuid,
  anonymized_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purged RECORD;
BEGIN
  FOR v_purged IN
    SELECT p.id
      FROM public.profiles p
      WHERE p.deleted_at IS NOT NULL
        AND p.anonymized_at IS NULL
        AND p.scheduled_purge_at < now()
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.profiles
    SET nom = 'Utilisateur supprimé',
        prenom = NULL,
        display_name = 'Utilisateur supprimé',
        email = NULL,
        telephone = NULL,
        sexe = NULL,
        age = NULL,
        anonymized_at = now()
    WHERE id = v_purged.id;

    RETURN QUERY SELECT v_purged.id, now();
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.purge_expired_profiles(integer) IS
  'FEAT-1 : cron pg_cron quotidien. Anonymise les PII des profiles où scheduled_purge_at < now(). Batch de 100 par défaut pour éviter lock table. is_minor passe automatiquement à false (colonne générée).';

GRANT EXECUTE ON FUNCTION public.purge_expired_profiles(integer) TO service_role;


-- ================================================================
-- PARTIE 4 : Helper SQL — restore_deleted_profile (admin-only)
-- ================================================================
-- Appelé par la Edge Function restore-account-admin (verify_jwt=true, caller
-- doit être platform_admin).
-- Effet atomique :
--   1. UPDATE profiles.deleted_at = NULL
--   2. UPDATE profiles.scheduled_purge_at = NULL
--   3. UPDATE profiles.anonymized_at = NULL (au cas où le cron a déjà tourné
--      dans une fenêtre race condition — reset complet de l'état soft-delete)
--   4. UPDATE auth.users.banned_until = NULL (via SECURITY DEFINER)
--
-- Note : si anonymized_at était déjà posé (= profil déjà anonymisé), cette
-- fonction lève une exception via la vérification IF NOT EXISTS ligne 221.
-- Le code retour was_anonymized est informatif uniquement — la fonction refuse
-- de restaurer un compte déjà passé par la phase de purge (volontaire :
-- un compte anonymisé ne ressuscite pas).
--
-- Pourquoi SECURITY DEFINER : permet à la fonction d'écrire dans auth.users.
-- Le GRANT EXECUTE est limité à service_role pour garantir que SEULE la
-- Edge Function (qui utilise SUPABASE_SERVICE_ROLE_KEY) peut l'appeler.
-- Un user authentifié standard NE PEUT PAS appeler directement cette fonction.
CREATE OR REPLACE FUNCTION public.restore_deleted_profile(_user_id uuid)
RETURNS TABLE (
  restored_at timestamptz,
  was_anonymized boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_anonymized boolean := false;
  v_restored_at timestamptz := now();
BEGIN
  -- Vérifier l'état actuel : doit être soft-deleted ET pas encore anonymisé.
  -- Si anonymized_at IS NOT NULL, le compte est passé par la purge → irréversible.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = _user_id
      AND p.deleted_at IS NOT NULL
      AND p.anonymized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Profile % n''est pas restaurable (déjà anonymisé ou jamais supprimé)', _user_id
      USING ERRCODE = 'P0001';
  END IF;

  -- Mémoriser si déjà anonymisé (pour information du caller)
  SELECT (p.anonymized_at IS NOT NULL)
    INTO v_was_anonymized
  FROM public.profiles p
  WHERE p.id = _user_id;

  -- Reset complet des colonnes soft-delete
  UPDATE public.profiles
  SET deleted_at = NULL,
      scheduled_purge_at = NULL,
      anonymized_at = NULL
  WHERE id = _user_id;

  -- Lever banned_until côté auth.users
  -- SECURITY DEFINER permet cet UPDATE même si le caller n'a pas le droit
  -- direct sur auth.users.
  UPDATE auth.users
  SET banned_until = NULL
  WHERE id = _user_id;

  RETURN QUERY SELECT v_restored_at, v_was_anonymized;
END;
$$;

COMMENT ON FUNCTION public.restore_deleted_profile(uuid) IS
  'FEAT-2 (admin-only) : remet deleted_at/scheduled_purge_at/anonymized_at à NULL + auth.users.banned_until à NULL. GRANT EXECUTE limité à service_role. Utilisé par la Edge Function restore-account-admin après vérification rôle platform_admin.';

GRANT EXECUTE ON FUNCTION public.restore_deleted_profile(uuid) TO service_role;


-- ================================================================
-- PARTIE 5 : Helper SQL — Vérification du rôle platform_admin
-- ================================================================
-- Suit le pattern des helpers SECURITY DEFINER existants (cf. migration 20260723171443).
-- Cette version prend un UUID et check aussi app_metadata (cas où l'Edge
-- Function utilise le JWT user plutôt que de query la table). Plus complet
-- si le user n'a pas encore de user_tenant_roles (compte orphelin juste créé).
CREATE OR REPLACE FUNCTION public.check_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_platform_admin(_user_id)
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = _user_id
        AND (
          raw_app_meta_data->>'is_platform_admin' = 'true'
          OR raw_app_meta_data->>'role' = 'platform_admin'
        )
    );
$$;

COMMENT ON FUNCTION public.check_platform_admin(uuid) IS
  'FEAT-2 : vérifie le rôle platform_admin via user_tenant_roles OU auth.users.app_metadata. Utilisé par les Edge Functions delete-own-account et restore-account-admin pour autoriser la suppression/restauration d''un compte tiers.';


-- ================================================================
-- PARTIE 6 : Helper SQL — Anti-footgun dernier platform_admin
-- ================================================================
-- Évite qu'un platform_admin clique par erreur sur son propre nom dans
-- /platform et lock-out toute l'équipe. Vérifie qu'il reste au moins
-- UN autre platform_admin avant d'autoriser.
--
-- Note : la requête compte les platform_admin dont le profile est ACTIF
-- (deleted_at IS NULL). Un platform_admin soft-deleted ne peut plus agir, donc
-- on ne doit PAS le compter comme "admin opérationnel" pour l'anti-footgun.
-- Sinon le count peut être artificiellement gonflé et laisser passer la
-- suppression du seul admin réellement opérationnel (lock-out de la plateforme).
CREATE OR REPLACE FUNCTION public.count_platform_admins()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.user_tenant_roles r
  INNER JOIN public.profiles p ON p.id = r.user_id
  WHERE r.role = 'platform_admin'
    AND p.deleted_at IS NULL;
$$;

COMMENT ON FUNCTION public.count_platform_admins() IS
  'FEAT-2 : compte les platform_admin ACTIFS (deleted_at IS NULL). Utilisé par la Edge Function delete-own-account pour anti-footgun.';

GRANT EXECUTE ON FUNCTION public.count_platform_admins() TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_platform_admins() TO service_role;


-- ================================================================
-- PARTIE 7 : pg_cron — job quotidien purge-expired-profiles
-- ================================================================
-- Exécuté tous les jours à 03:00 UTC (= 04:00 heure locale Kinshasa/WAT en
-- hiver, 05:00 en été — décalage UTC+1).
-- Appelle purge_expired_profiles(100) pour traiter jusqu'à 100 comptes par jour.
-- Si plus de 100 comptes expirent le même jour (improbable), ils seront
-- traités le lendemain. La fenêtre 30j laisse large le temps.
--
-- Pré-requis : extension pg_cron activée côté Dashboard Supabase
-- (Database → Extensions → pg_cron → Enable). Si l'extension n'est pas
-- activée, cette partie de la migration échouera au push — c'est attendu
-- et signalé dans le récap final.
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Suppression d'un éventuel job existant avec le même nom (idempotent re-push)
SELECT cron.unschedule('purge-expired-profiles-daily')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'purge-expired-profiles-daily'
  );

-- Schedule le job quotidien à 03:00 UTC
SELECT cron.schedule(
  'purge-expired-profiles-daily',
  '0 3 * * *',
  $$SELECT public.purge_expired_profiles(100);$$
);

COMMENT ON EXTENSION pg_cron IS
  'FEAT-1 : utilisé par le job quotidien purge-expired-profiles-daily (cf. migration 20260808220000).';


-- ================================================================
-- PARTIE 8 : Trigger de fermeture définitive — banned_until = infinity
-- ================================================================
-- Quand purge_expired_profiles() pose anonymized_at (passage NULL → NOT NULL),
-- on veut bloquer le sign-in DÉFINITIVEMENT (au-delà de la fenêtre 30j).
-- Sans ça, auth.users reste vivant avec banned_until posé au clic sur
-- scheduled_purge_at. Après cette date, banned_until expire → le user peut
-- re-se connecter. Risque : un user "anonymisé" qui revient par hasard
-- (ou via reset password email) retrouve un profil vide mais utilisable.
--
-- Trigger AFTER UPDATE sur profiles : si anonymized_at vient d'être posé
-- (OLD NULL, NEW NOT NULL) → UPDATE auth.users SET banned_until = 'infinity'
-- pour ce user. Bloque le sign-in pour toujours. Restauration impossible
-- (par conception — un compte anonymisé ne doit pas pouvoir ressusciter).
--
-- Pourquoi 'infinity' plutôt que 'now() + 100 years' :
--   - Cohérent avec la sémantique "banni définitivement"
--   - Pas de risque de fenêtre d'expiration accidentelle
--   - L'admin ne peut PAS restaurer un compte anonymisé (volontaire)
--   - Si on doit réactiver un compte pour cas légal (e-discovery, etc.),
--     c'est via UPDATE auth.users.banned_until = NULL directement en SQL
--     service_role — opération consciente, pas accidentelle.
--
-- Pourquoi SECURITY DEFINER sur la fonction trigger :
--   Le trigger s'exécute dans le contexte de l'UPDATE profiles (par
--   service_role du cron pg_cron). service_role a déjà UPDATE sur auth.users
--   par défaut côté Supabase. Mais SECURITY DEFINER protège contre les
--   évolutions futures du modèle de permissions (si quelqu'un retire le GRANT).
--   Belt-and-suspenders.
CREATE OR REPLACE FUNCTION public.close_anonymized_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Ne se déclenche que si anonymized_at vient d'être posé (NULL → NOT NULL).
  IF OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL THEN
    UPDATE auth.users
    SET banned_until = 'infinity'::timestamptz
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.close_anonymized_account() IS
  'FEAT-1 : trigger AFTER UPDATE sur profiles. Quand anonymized_at passe de NULL à NOT NULL (purge_expired_profiles), pose auth.users.banned_until = infinity pour bloquer le sign-in définitivement.';

CREATE TRIGGER trg_close_anonymized_account
  AFTER UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.close_anonymized_account();


-- ================================================================
-- PARTIE 9 : RLS — Notes pour la suite
-- ================================================================
-- La RLS existante "Users can view their own profile" (auth.uid() = id) reste
-- effective même après soft-delete. Le user peut toujours voir son profil
-- (avec deleted_at non-NULL) s'il se reconnecte — mais banned_until l'en empêche.
--
-- Pour les RLS qui dépendent de profiles (ex: prevent_underage_reservation),
-- le trigger continue de lire profiles.is_minor. is_minor est GENERATED ALWAYS
-- AS (age IS NOT NULL AND age < 18). Pendant les 30j, age est intact → is_minor
-- inchangé. Après purge (age=NULL), is_minor=false automatiquement. Aucun
-- mineur ne peut plus passer par ce chemin.
--
-- Pour staff_applications : pas d'impact, la candidature est déjà figée
-- (status != 'pending' une fois approved/rejected).
--
-- Aucune modification RLS nécessaire dans cette migration.


-- ================================================================
-- FIN DE LA MIGRATION
-- ================================================================
-- Résumé des objets créés / modifiés :
--   • profiles : +deleted_at, +anonymized_at, +scheduled_purge_at
--   • Index idx_profiles_scheduled_purge (partiel)
--   • Fonction soft_delete_profile(user) — pose deleted_at + scheduled_purge_at (PII intactes)
--   • Fonction purge_expired_profiles(batch) — cron quotidien, anonymise PII
--   • Fonction restore_deleted_profile(user) — admin-only, reset complet + banned_until=NULL
--   • Fonction check_platform_admin(user) — vérif rôle via user_tenant_roles + app_metadata
--   • Fonction count_platform_admins() — anti-footgun, ne compte que les profiles actifs
--   • Trigger close_anonymized_account() — pose banned_until = infinity à la purge
--   • Extension pg_cron + job quotidien purge-expired-profiles-daily
--
-- À faire côté Edge Function (FEAT B.1, B.2) :
--   1. delete-own-account (verify_jwt = true) :
--      a. Lit JWT → caller.id
--      b. Si body.target_user_id présent : check_platform_admin(caller.id)
--         + anti-footgun si target == caller (count_platform_admins > 1)
--      c. Appelle soft_delete_profile(target_user_id) → récupère scheduled_purge_at
--      d. UPDATE auth.users SET banned_until = (scheduled_purge_at)
--         pour le target via service_role
--      e. Renvoie { deleted_at, scheduled_purge_at, banned_until }
--   2. restore-account-admin (verify_jwt = true) :
--      a. Lit JWT → caller.id
--      b. Vérifie check_platform_admin(caller.id) → 403 sinon
--      c. Si target déà anonymisé (anonymized_at IS NOT NULL) → 410 Gone (irréversible)
--      d. Sinon appelle restore_deleted_profile(body.target_user_id)
--      e. Renvoie { restored_at, was_anonymized }
--
-- Dette future (à documenter dans dette-technique.md) :
--   - Hard-delete complet auth.users post-purge via pg_net + Edge Function
--     scheduled (auth.admin.deleteUser). Pas justifié en V1 par le volume.
--     Réévaluer si > 100 comptes anonymisés stagnants.
--   - Magic link self-service pour annulation (dette déjà notée chantier3).
--
-- Push Supabase : action externe Yannick (supabase db push).
-- Rollback si besoin :
--   - DROP TRIGGER IF EXISTS trg_close_anonymized_account ON public.profiles;
--   - DROP FUNCTION IF EXISTS public.close_anonymized_account();
--   - DROP COLUMN IF EXISTS sur deleted_at/anonymized_at/scheduled_purge_at
--   - SELECT cron.unschedule('purge-expired-profiles-daily');
--   - DROP EXTENSION IF EXISTS pg_cron; (uniquement si pas utilisé ailleurs)
--   - Les autres objets sont CREATE OR REPLACE, donc neutres.
-- ================================================================
