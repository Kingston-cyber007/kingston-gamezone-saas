-- Rollback : supprime les fonctions de vérification CHANTIER 1 + CHANTIER 3.
-- Date : 2026-08-09
DROP FUNCTION IF EXISTS public.chantier1_status();
DROP FUNCTION IF EXISTS public.chantier1_triggers();