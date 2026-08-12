-- Migration : restriction des colonnes exposées à `anon` sur `tenants`.
-- Date : 2026-08-11
-- Contexte : le dropdown "sélection salle" du mode `/auth?mode=signup-staff`
--   (CH.CHANTIER 1 B.5) fait `supabase.from('tenants').select('id, name, status')`
--   avant sign-in. Sans JWT, l'`anon` est mappé à 401 par les policies existantes
--   (qui exigent toutes `auth.uid()` non null). Bug latent depuis la mise en
--   prod (migration init 20260723171443).
--
-- Cette migration :
--   1. RÉVOQUE les GRANTs larges hérités de la migration init sur `anon`
--      (GRANT ALL TO PUBLIC → SELECT sur toutes les colonnes y compris
--      billing_status, ce qui leakait le statut billing des salles actives
--      vers n'importe quel appel REST non authentifié).
--   2. RÉ-ÉMET des GRANTs colonnes-spécifiques sur `anon` (id, name, status
--      uniquement). Suppression totale des INSERT/UPDATE/DELETE/TRUNCATE/
--      REFERENCES/TRIGGER sur `anon` (l'inscription ne crée pas de salle).
--   3. GARDE les GRANTs complets sur `authenticated` (lecture/écriture
--      intacte pour /platform, qui fait `.select('*')` ligne 307, et INSERT/
--      UPDATE ligne 438/458/480 via la policy "Platform admins can manage
--      tenants"). Aucun changement UI attendu côté /platform.
--   4. AJOUTE une policy "Public can list active tenants" qui filtre les
--      lignes visibles par `anon` à `status='active'` (pas de leak des salles
--      suspended/archived).
--
-- Effet sur l'UI :
--   - /auth (signup-staff) : dropdown peuplé avec les 2 salles actives
--     (id + name + status). Avant : dropdown vide (401).
--   - /platform : aucun changement. Toutes les colonnes restent lisibles
--     par les platform_admins (et le staff voit sa propre salle via RLS).
--
-- Note dette #32 (NE PAS OUBLIER) : cette migration résout le risque
--   `anon → billing_status` mais PAS le risque symétrique
--   `authenticated (staff) → billing_status de sa propre salle`.
--   Cf. dette #32 dans dette-technique.md + /platform/index.tsx:307 qui
--   fait `.select('*')`. RLS filtre les LIGNES, pas les COLONNES — un
--   staff authentifié qui a `has_tenant_access(auth.uid(), id)` voit
--   `billing_status` de SA salle. À durcir avant passage multi-tenant
--   (CHANTIER 4+). Backlog.

-- Étape 1 : révoque les GRANTs larges hérités sur `anon`.
REVOKE ALL ON public.tenants FROM anon;

-- Étape 2 : GRANTs colonnes-spécifiques sur `anon` (lecture seule, 3 colonnes).
GRANT SELECT (id, name, status) ON public.tenants TO anon;

-- Étape 3 : `authenticated` garde ses GRANTs complets intacts.
-- Aucune action ici — les GRANTs hérités restent valides.
-- (Vérification post-migration : 9 colonnes SELECT, dont billing_status.)

-- Étape 4 : policy publique filtrant sur status='active'.
CREATE POLICY "Public can list active tenants"
  ON public.tenants
  FOR SELECT
  TO anon
  USING (status = 'active');

-- Rollback manuel (à exécuter côté Dashboard SQL Editor si besoin) :
-- DROP POLICY IF EXISTS "Public can list active tenants" ON public.tenants;
-- REVOKE SELECT (id, name, status) ON public.tenants FROM anon;
-- GRANT ALL ON public.tenants TO anon;