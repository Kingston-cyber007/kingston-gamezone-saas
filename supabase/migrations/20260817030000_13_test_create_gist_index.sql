DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_reservations_poste_range
    ON public.reservations
    USING GIST (tstzrange(date_heure, date_heure + make_interval(mins => duree_min), '[)'))
    WHERE statut IN ('en_attente', 'confirmee');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'INDEX ERROR: SQLSTATE=% SQLERRM=%', SQLSTATE, SQLERRM;
END $$;
