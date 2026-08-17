CREATE OR REPLACE FUNCTION public.make_reservation_range(p_ts timestamptz, p_dur integer)
RETURNS tstzrange
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN tstzrange(p_ts, p_ts + make_interval(mins => p_dur), '[)');
END;
$$;

CREATE INDEX IF NOT EXISTS idx_reservations_poste_range
  ON public.reservations
  USING GIST (make_reservation_range(date_heure, duree_min))
  WHERE statut IN ('en_attente', 'confirmee');
