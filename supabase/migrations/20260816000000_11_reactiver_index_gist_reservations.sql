-- ================================================================
-- CHANTIER 2 — Réactivation de l'index GiST sur tstzrange (overlap)
-- Migration dédiée (diagnostic 2026-08-16)
-- ================================================================
-- Date : 2026-08-16
--
-- CONTEXTE :
--   L'index GiST prévu en A.5 (migration 20260812000000_10_chantier2_paiement)
--   a été désactivé le 2026-08-12 : le 2e push échouait au statement 28
--   (`CREATE EXTENSION IF NOT EXISTS btree_gist`). Le message exact n'a pas
--   été conservé, mais le diagnostic de l'expression d'index conclut à une
--   vraie erreur de contrainte Postgres, pas à un souci d'environnement :
--
--   L'ancienne expression :
--     tstzrange(date_heure, date_heure + (duree_min || ' minutes')::interval, '[)')
--   utilise `textcat` (opérateur ||) + le cast text -> interval : les deux
--   sont STABLE, pas IMMUTABLE. Postgres refuse donc l'index sur n'importe
--   quel serveur, avec l'erreur exacte :
--     ERROR: functions in index expression must be marked IMMUTABLE
--   Même si le CREATE EXTENSION était passé, ce CREATE INDEX aurait échoué.
--
-- CORRECTIF :
--   - `duree_min * interval '1 minute'` / make_interval : IMMUTABLE, donc
--     l'expression redevient indexable (tstzrange est IMMUTABLE).
--   - PAS de `CREATE EXTENSION btree_gist` : inutile, tstzrange dispose
--     d'une opclass GiST native.
--   - La table restait petite (peu de réservations actives par poste) ;
--     le trigger check_reservation_overlap fonctionnait en O(n) — acceptable,
--     mais l'index devient utile quand le volume grossit.
-- ================================================================

CREATE INDEX IF NOT EXISTS idx_reservations_poste_range
  ON public.reservations
  USING GIST (tstzrange(date_heure, date_heure + make_interval(mins => duree_min), '[)'))
  WHERE statut IN ('en_attente', 'confirmee');


-- ================================================================
-- Vérification post-push (à exécuter par Yannick)
-- ================================================================
--   -- 1. L'index existe (attendu : 1 ligne) :
--   SELECT indexname FROM pg_indexes
--   WHERE indexname = 'idx_reservations_poste_range';
--
--   -- 2. Le plan utilise bien l'index pour l'overlap :
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id FROM public.reservations r
--   WHERE r.tenant_id = '<uuid>'
--     AND r.poste_id = '<uuid>'
--     AND r.statut IN ('en_attente', 'confirmee')
--     AND tstzrange(r.date_heure,
--                   r.date_heure + make_interval(mins => r.duree_min), '[)')
--         && tstzrange('<debut>'::timestamptz, '<fin>'::timestamptz, '[)');
--   Attendu : `Index Scan using idx_reservations_poste_range`.
--   Tant que le tableau EXACT du trigger check_reservation_overlap diffère de
--   l'expression d'index (forme `[)` + mêmes bornes), l'index est utilisable.

-- ================================================================
-- Rollback si besoin :
--   DROP INDEX IF EXISTS idx_reservations_poste_range;
-- ================================================================
