-- Migration : garde défensive sur les 2 policies additives legacy de `tenants`
--              pour éviter 42501 "permission denied for function has_tenant_access /
--              is_platform_admin" côté anon.
-- Date : 2026-08-11
-- Contexte : la migration 20260811040039 (REVOKE ALL sur tenants FROM anon +
--   GRANT SELECT colonnes-spécifiques + policy `Public can list active tenants`)
--   est correcte mais insuffisante. Elle laisse actives les 2 policies additives
--   legacy de la migration init 20260723171443 :
--     - "Users can view their tenants" (FOR SELECT, USING has_tenant_access(auth.uid(), id))
--     - "Platform admins can manage tenants" (FOR ALL, USING is_platform_admin(auth.uid()))
--   Ces 2 policies sont TO PUBLIC (pas de `TO` explicite), donc s'appliquent aussi
--   à anon. Pour anon, auth.uid() retourne NULL, et les 2 fonctions SECURITY DEFINER
--   has_tenant_access + is_platform_admin n'ont EXECUTE que pour authenticated +
--   service_role (cf. migration 20260725113348 lignes 30-37). PostgREST → 42501
--   → API renvoie 401 même si ma nouvelle policy `Public can list active tenants`
--   aurait laissé passer la requête.
--
--   Postgres évalue TOUTES les policies SELECT additives et les OR-ensemble ; une
--   policy qui plante fait échouer toute la requête.
--
-- Stratégie (option 2 retenue par Yannick 2026-08-11) : DÉFENSIFIER les policies
--   legacy avec un court-circuit `auth.uid() IS NOT NULL AND ...`. Pas de GRANT
--   EXECUTE supplémentaire à anon (cohérent avec le principe de minimisation de
--   la surface d'attaque : GRANT EXECUTE ouvrirait un accès RPC direct à ces
--   fonctions pour n'importe qui — sûr aujourd'hui car retournent false pour
--   NULL input, mais une porte inutile à ouvrir).
--
-- Effet :
--   - authenticated : auth.uid() NOT NULL → USING évalué normalement → aucun
--     changement de comportement (la garde est transparente).
--   - anon : auth.uid() IS NULL → USING évalué à false → la policy legacy devient
--     inactive pour anon, ne masque plus la nouvelle policy `Public can list
--     active tenants`.
--   - service_role : bypass RLS par défaut, les USING ne sont pas évalués.
--
-- Risque si on ne fait RIEN : à chaque fois qu'un anon tape sur /rest/v1/tenants,
--   401 systématique, même pour les 3 colonnes explicitement autorisées.
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

-- Policy 1/2 : "Users can view their tenants" — court-circuit sur auth.uid() IS NULL
DROP POLICY IF EXISTS "Users can view their tenants" ON public.tenants;
CREATE POLICY "Users can view their tenants"
  ON public.tenants
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND public.has_tenant_access(auth.uid(), id)
  );

-- Policy 2/2 : "Platform admins can manage tenants" — court-circuit sur USING + WITH CHECK
DROP POLICY IF EXISTS "Platform admins can manage tenants" ON public.tenants;
CREATE POLICY "Platform admins can manage tenants"
  ON public.tenants
  FOR ALL
  USING (
    auth.uid() IS NOT NULL
    AND public.is_platform_admin(auth.uid())
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND public.is_platform_admin(auth.uid())
  );
