-- CHANTIER 2 — Index GiST overlap (réactivation, diagnostic 2026-08-16)
-- Diagnostic + correctif : cf. memory/chantier2-reservation-paiement.md
-- ancienne expression (duree_min || ' minutes')::interval n'était pas IMMUTABLE
-- make_interval(mins => duree_min) est IMMUTABLE, btree_gist inutile.

CREATE INDEX IF NOT EXISTS idx_reservations_poste_range
  ON public.reservations
  USING GIST (tstzrange(date_heure, date_heure + make_interval(mins => duree_min), '[)'))
  WHERE statut IN ('en_attente', 'confirmee');
