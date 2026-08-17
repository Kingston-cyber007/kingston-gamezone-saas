CREATE TABLE IF NOT EXISTS _debug_gist (
  id serial PRIMARY KEY,
  error_state text,
  error_msg text,
  created_at timestamptz DEFAULT now()
);

TRUNCATE _debug_gist;

DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS idx_reservations_poste_range
    ON public.reservations
    USING GIST (tstzrange(date_heure, date_heure + duree_min * interval '1 minute', '[)'))
    WHERE statut IN ('en_attente', 'confirmee');
  INSERT INTO _debug_gist (error_state, error_msg) VALUES ('OK', 'index created');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _debug_gist (error_state, error_msg) VALUES (SQLSTATE, SQLERRM);
END $$;
