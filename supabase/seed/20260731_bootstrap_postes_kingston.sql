-- ================================================================
-- RT.A.2 — Bootstrap one-shot : 5 postes pour Kingston GameZone
-- ================================================================
-- Contexte : la table `postes` existe dans le schéma Supabase (créée
-- par la migration 20260723171443) mais reste vide pour le tenant
-- "kingston" alors que settings.posteCount = 5. Le frontend actuel
-- n'utilise pas encore Supabase côté data (Zustand local) — donc on
-- se contente d'un seed SQL pour débloquer les tests.
--
-- Idempotent : ON CONFLICT (tenant_id, position) DO NOTHING.
-- Si tu changes settings.posteCount plus tard, ce script ne se
-- re-déclenche PAS automatiquement. Phase B (dashboard /platform
-- enrichi) gérera la synchro proprement.
--
-- Exécution : copier-coller dans Supabase Dashboard → SQL Editor
-- → New query → Run. Sortie attendue : INSERT 0 5 (ou 0 0 si déjà
-- initialisé).
-- ================================================================

DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Récupère l'UUID du tenant Kingston
  SELECT id INTO v_tenant_id
  FROM public.tenants
  WHERE slug = 'kingston'
  LIMIT 1;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant "kingston" introuvable. As-tu bien exécuté la migration 1 (20260723171443) ?';
  END IF;

  -- Insère 5 postes (positions 1 à 5) s'ils n'existent pas déjà
  INSERT INTO public.postes (tenant_id, position, name, emoji, status, paused, drink_count)
  VALUES
    (v_tenant_id, 1, 'Poste 1', '🎮', 'idle', false, 0),
    (v_tenant_id, 2, 'Poste 2', '🎮', 'idle', false, 0),
    (v_tenant_id, 3, 'Poste 3', '🎮', 'idle', false, 0),
    (v_tenant_id, 4, 'Poste 4', '🎮', 'idle', false, 0),
    (v_tenant_id, 5, 'Poste 5', '🎮', 'idle', false, 0)
  ON CONFLICT (tenant_id, position) DO NOTHING;

  RAISE NOTICE 'Bootstrap postes OK — tenant %, % lignes insérées',
    v_tenant_id,
    (SELECT COUNT(*) FROM public.postes WHERE tenant_id = v_tenant_id);
END $$;

-- Vérification immédiate
SELECT id, position, name, emoji, status
FROM public.postes
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug = 'kingston')
ORDER BY position;
