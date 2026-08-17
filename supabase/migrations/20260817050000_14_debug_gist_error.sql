CREATE INDEX IF NOT EXISTS idx_test_gist_simple
  ON public.reservations
  USING GIST (tstzrange(date_heure, date_heure, '[)'));
