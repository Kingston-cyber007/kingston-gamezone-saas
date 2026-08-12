-- Migration : restreindre l'application des 2 policies additives legacy de
--              `tenants` au rôle `authenticated` via la clause TO, pour éviter
--              42501 "permission denied for function has_tenant_access /
--              is_platform_admin" côté anon.
-- Date : 2026-08-11
-- Contexte : la migration 20260811040039 (REVOKE ALL sur tenants FROM anon +
--   GRANT SELECT colonnes-spécifiques + policy `Public can list active tenants`)
--   est correcte mais insuffisante. Elle laisse actives les 2 policies additives
--   legacy de la migration init 20260723171443 :
--     - "Users can view their tenants" (FOR SELECT, USING has_tenant_access(auth.uid(), id))
--     - "Platform admins can manage tenants" (FOR ALL, USING is_platform_admin(auth.uid()))
--   Ces 2 policies sont TO PUBLIC (pas de `TO` explicite), donc s'appliquent
--   AUSSI à anon. Pour anon, auth.uid() retourne NULL, et les 2 fonctions
--   SECURITY DEFINER has_tenant_access + is_platform_admin n'ont EXECUTE que pour
--   authenticated + service_role (cf. migration 20260725113348 lignes 30-37).
--   PostgREST → 42501 → API renvoie 401 même si ma nouvelle policy `Public can
--   list active tenants` aurait laissé passer la requête.
--
--   Première tentative (migration 20260811041738) : ajouter `auth.uid() IS NOT NULL
--   AND` aux USING clauses. INSUFFISANT — Postgres vérifie les permissions sur
--   les fonctions appelées AVANT d'évaluer le court-circuit logique, donc le 42501
--   persiste. Le seul moyen de ne pas déclencher l'appel à la fonction pour anon
--   est que la policy ne s'applique PAS du tout à anon → clause `TO authenticated`.
--
-- Stratégie : recréer les 2 policies legacy avec `TO authenticated` explicite.
--   - anon : seule la policy `Public can list active tenants` (TO anon) s'applique.
--     Les 2 legacy sont inertes pour anon. Plus de 42501.
--   - authenticated : les 3 policies s'appliquent (dont 2 legacy avec USING
--     has_tenant_access / is_platform_admin). auth.uid() non NULL → GRANT EXECUTE
--     est valide → fonctions retournent leur valeur normale → aucun changement
--     de comportement.
--   - service_role : bypass RLS par défaut, USING non évalué.
--
-- Effet attendu :
--   - /rest/v1/tenants?select=id,name,status&status=eq.active en privé → 200 avec
--     les 2 salles actives. Avant : 401 systématique.
--   - /platform : aucun changement (toutes les colonnes restent lisibles par les
--     platform_admins via `authenticated`, et le staff voit sa propre salle via
--     RLS).
--
-- Note dette #32 (rappel) : cette migration ne ferme PAS le risque symétrique
--   `authenticated (staff) → billing_status de sa propre salle` documenté dans
--   dette #32 et dans le commentaire de la migration 20260811040039. C'est un
--   autre chantier (durcissement avant passage multi-tenant).
--
-- Rollback (manuel) :
--   DROP POLICY IF EXISTS "Users can view their tenants" ON public.tenants;
--   CREATE POLICY "Users can view their tenants" ON public.tenants FOR SELECT
--     USING (public.has_tenant_access(auth.uid(), id));
--   DROP POLICY IF EXISTS "Platform admins can manage tenants" ON public.tenants;
--   CREATE POLICY "Platform admins can manage tenants" ON public.tenants FOR ALL
--     USING (public.is_platform_admin(auth.uid()))
--     WITH CHECK (public.is_platform_admin(auth.uid()));

-- Étape 1 : corriger la migration 20260811041738 (annule son effet partiel)
--   La migration précédente a ajouté un court-circuit AND qui ne résout PAS le
--   problème (permissions de fonction évaluées avant court-circuit). On retire
--   ces versions court-circuitées pour repartir propre.
DROP POLICY IF EXISTS "Users can view their tenants" ON public.tenants;
DROP POLICY IF EXISTS "Platform admins can manage tenants" ON public.tenants;

-- Étape 2 : recréer les 2 policies legacy avec TO authenticated explicite.
--   Effet : pour anon, ces policies ne sont plus candidates à l'évaluation RLS,
--   donc has_tenant_access / is_platform_admin ne sont plus appelées → plus de 42501.
CREATE POLICY "Users can view their tenants"
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (public.has_tenant_access(auth.uid(), id));

CREATE POLICY "Platform admins can manage tenants"
  ON public.tenants
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));