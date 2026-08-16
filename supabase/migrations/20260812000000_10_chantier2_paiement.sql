-- ================================================================
-- CHANTIER 2 — Réservation en ligne + paiement CinetPay
-- Migration unique A.1 → A.5
-- ================================================================
-- Date : 2026-08-12
--
-- PRÉLUDE : extension enum public.payment_method avec 'carte'
-- (cf. décision tranchée 2026-08-12 : CinetPay carte bancaire).
-- Pattern : transaction séparée via DO $$ + EXCEPTION handling
-- (cf. migration 20260803113500 PARTIE 1 pour 'reserved').
-- DOIT ÊTRE EN DEBUT de migration, avant toute référence à l'enum.
-- ================================================================
DO $$
BEGIN
  BEGIN
    ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'carte';
  EXCEPTION
    WHEN duplicate_object THEN
      -- Valeur déjà présente, OK silencieux.
      NULL;
  END;
END$$;


-- Décisions actées (cf. memory/chantier2-reservation-paiement.md) :
--   1. CinetPay retenu (Airtel Money + MTN Money + carte).
--   2. Montant JAMAIS lu depuis le client : recalculé serveur (RPC
--      compute_reservation_price) depuis tenant_settings.prices.
--   3. ReservationPicker composant dédié (pas réutilisation SessionModal).
--   4. Durée min 30 min — CHECK constraint DB (pas seulement UI).
--   5. Vérification conflit dispo temps réel AVANT paiement.
--   6. Console en_reparation → poste indisponible (trigger déjà en place).
--   7. Politique report/annulation symétrique stricte >1h / <1h.
--   8. Idempotency key sur appel paiement (anti double-clic).
--   9. Refund intégral CinetPay si annulation >1h, 0 si <1h.
--  10. Fees CinetPay absorbés par salle (pas de ligne "frais" côté UI).
--  11. Granularité : tenant_settings.prices JSON {30,60,90,120,...} déjà en place
--      (cf. migration 20260723171443 ligne 205). Fallback sur
--      custom_price_per_minute * duree_min si durée hors grille.
--  12. Tables reservations + consoles + triggers déjà en place depuis
--      migration 20260803113500 (CHANTIER 1). On ÉTEND, on ne recrée pas.
--
-- Best practices appliquées (cf. skill supabase-postgres-best-practices) :
--   - (select auth.uid()) dans les RLS (cached, pas per-row).
--   - CHECK / FK / indexes idempotents via DO $$ + pg_constraint.
--   - SECURITY DEFINER functions : search_path = '' explicite, revoke
--     EXECUTE des rôles non-autorisés, check auth.uid() interne.
--   - Index sur FK + colonnes RLS (idx_payments_tenant, idx_idemp_user).
--   - Index composite (tenant_id, status) sur payments pour le dashboard.
-- ================================================================


-- ================================================================
-- A.1 — RPC compute_reservation_price (SECURITY DEFINER)
-- ================================================================
-- SOURCE DE VÉRITÉ DU PRIX. Le client NE CALCULE JAMAIS le prix.
-- L'UI affiche un aperçu non-authoritatif (rounded à 0 décimale FCFA)
-- mais le chiffre exact vient de cet RPC appelé juste avant
-- l'appel CinetPay dans l'Edge Function create-payment-intent.
--
-- Logique :
--   1. Lit tenant_settings.prices (JSON {"30":500, "60":900, "90":1300, "120":1600, ...})
--   2. Si la durée EXACTE existe comme clé → retourne ce prix.
--   3. Sinon fallback = custom_price_per_minute * duree_min.
--   4. Le montant est NON-NÉGOCIABLE : si le tenant n'a pas de
--      tenant_settings, le RPC retourne 0 (l'Edge Function refusera
--      l'appel CinetPay). Pas de fallback arbitraire.
--   5. SECURITY DEFINER : bypass RLS sur tenant_settings pour permettre
--      au client authentifié de calculer son propre prix sans être
--      bloqué par RLS trop restrictives futures.
CREATE OR REPLACE FUNCTION public.compute_reservation_price(
  _tenant_id uuid,
  _duree_min integer
)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_prices jsonb;
  v_custom_per_min integer;
  v_price integer;
BEGIN
  -- Garde : durée doit être >= 30 (cohérent avec CHECK sur reservations).
  IF _duree_min < 30 THEN
    RAISE EXCEPTION 'Durée minimale de réservation : 30 minutes (reçu : %)', _duree_min
      USING ERRCODE = 'check_violation';
  END IF;
  IF _duree_min > 1440 THEN
    RAISE EXCEPTION 'Durée maximale de réservation : 1440 minutes / 24h (reçu : %)', _duree_min
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lecture tenant_settings (bypass RLS via SECURITY DEFINER).
  SELECT prices, custom_price_per_minute
    INTO v_prices, v_custom_per_min
  FROM public.tenant_settings
  WHERE tenant_id = _tenant_id;

  -- Si pas de settings pour ce tenant, fallback 0 (et log côté Edge Function).
  IF v_prices IS NULL THEN
    RETURN 0;
  END IF;

  -- Le prix exact prime (clé textuelle car JSON object key est toujours text).
  IF v_prices ? _duree_min::text THEN
    v_price := (v_prices ->> _duree_min::text)::integer;
    RETURN v_price;
  END IF;

  -- Sinon fallback au tarif minute.
  v_price := v_custom_per_min * _duree_min;
  RETURN v_price;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.compute_reservation_price(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_reservation_price(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_reservation_price(uuid, integer) IS
  'Calcule serveur-side le prix EXACT dune reservation (FCFA, entier). Source de verite = tenant_settings.prices (JSON). Fallback custom_price_per_minute * duree_min. Appele par Edge Function create-payment-intent. Le client NE DOIT PAS dupliquer cette logique.';


-- ================================================================
-- A.2 — Table idempotency_keys
-- ================================================================
-- Anti double-clic sur le formulaire de paiement CinetPay.
-- Le client génère un UUID v4 à la soumission du formulaire de
-- réservation, et l'envoie avec la requête de paiement. L'Edge Function
-- insère la clé ici. Si conflit UNIQUE → c'est un doublon, on retourne
-- le payment_url déjà calculé (idempotent).
--
-- expire_at = 1h après création (suffisant pour un flux paiement).
-- Au-delà, on autorise une nouvelle clé (le paiement précédent a expiré
-- ou a été annulé côté CinetPay).
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key text NOT NULL,
  endpoint text NOT NULL,  -- ex: 'create-payment-intent'
  payment_url text,         -- réponse CinetPay cachée pour replay
  reservation_id uuid REFERENCES public.reservations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  UNIQUE (user_id, key, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user
  ON public.idempotency_keys (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires
  ON public.idempotency_keys (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.idempotency_keys TO service_role;
-- PAS de GRANT authenticated : seule l'Edge Function (service_role) lit/écrit.
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;

-- Aucune policy = aucune lecture/écriture depuis les rôles standard.
-- Seul service_role (bypasse RLS par défaut) peut accéder.


-- ================================================================
-- A.3 — Table payments + index + RLS
-- ================================================================
-- Historique de TOUTES les transactions CinetPay, liées à une réservation.
-- Une réservation peut avoir PLUSIEURS payments (retry après échec).
-- Le "vrai" paiement = celui avec status = 'success'.
--
-- Champs :
--   - provider : 'cinetpay' (extensibilité future, ex: 'stripe' si autre pays).
--   - transaction_id : ID retourné par CinetPay (référence externe unique).
--   - status : 'pending' / 'success' / 'failed' / 'refunded' (refund partiel possible).
--   - amount : montant EFFECTIVEMENT payé (FCFA, integer, jamais lu du client).
--   - refund_amount : montant remboursé (par défaut 0).
--   - refund_reason : motif du refund (ex: 'client_cancelled_>1h').
--   - metadata : jsonb pour stocker la réponse brute CinetPay (debug).
CREATE TABLE IF NOT EXISTS public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  reservation_id uuid NOT NULL REFERENCES public.reservations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'cinetpay' CHECK (provider IN ('cinetpay')),
  transaction_id text UNIQUE,  -- retourné par CinetPay, NULL tant que non confirmé
  payment_url text,            -- URL de la page hébergée CinetPay
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
  amount integer NOT NULL CHECK (amount > 0),  -- FCFA, JAMAIS lu du client
  refund_amount integer NOT NULL DEFAULT 0 CHECK (refund_amount >= 0 AND refund_amount <= amount),
  refund_reason text,
  payment_method public.payment_method,  -- enum étendu A.0 : 'cash','airtel_money','mtn_money','carte'
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_status
  ON public.payments (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_reservation
  ON public.payments (reservation_id);
CREATE INDEX IF NOT EXISTS idx_payments_client
  ON public.payments (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_transaction
  ON public.payments (transaction_id) WHERE transaction_id IS NOT NULL;

GRANT SELECT ON public.payments TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Clients voient leurs propres payments.
CREATE POLICY "Clients read own payments" ON public.payments FOR SELECT
  USING (client_id = (select auth.uid()) OR (select public.has_tenant_access((select auth.uid()), tenant_id)));
-- Staff/Admin voient les payments de leur tenant (déjà couvert par has_tenant_access ci-dessus).
-- Seule service_role peut INSERT/UPDATE/DELETE (via Edge Function).
-- Pas de policy INSERT/UPDATE/DELETE = bloqué pour authenticated (sauf via Edge Function).

CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

COMMENT ON TABLE public.payments IS
  'Historique transactions CinetPay liees aux reservations. Montants serveur-only (jamais du client). Seul service_role (Edge Functions) peut INSERT/UPDATE.';


-- ================================================================
-- A.4 — Renforcer CHECK duree_min >= 30 sur reservations
-- ================================================================
-- Migration CHANTIER 1 (20260803113500 ligne 209) a créé :
--   CHECK (duree_min > 0 AND duree_min <= 1440)
-- On ÉTEND à (duree_min >= 30 AND duree_min <= 1440) pour respecter
-- la décision actée "durée min 30 min — CHECK constraint DB".
-- Pattern idempotent via DO $$ (cf. skill schema-constraints.md).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'reservations_duree_min_check'
      AND conrelid = 'public.reservations'::regclass
  ) THEN
    ALTER TABLE public.reservations DROP CONSTRAINT reservations_duree_min_check;
  END IF;
END$$;

ALTER TABLE public.reservations
  ADD CONSTRAINT reservations_duree_min_check
  CHECK (duree_min >= 30 AND duree_min <= 1440);


-- ================================================================
-- A.5 — Trigger conflict-check : refuse INSERT si overlap
-- ================================================================
-- Empêche deux réservations de se chevaucher sur le même poste_id
-- entre les mêmes bornes temporelles. Règle métier : 1 poste = 1
-- réservation active à un instant T (sauf si annulée).
--
-- Calcul overlap (standard tstzrange) :
--   NEW.date_heure           → début du créneau
--   NEW.date_heure + duree   → fin du créneau
--   Conflit si : existing.range && [start, end)
--
-- Statuts qui BLOQUENT : en_attente + confirmee (pas les annulees,
-- pas les honorees (déjà passées), pas les reportees (déjà déplacées)).
CREATE OR REPLACE FUNCTION public.check_reservation_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conflict_count integer;
BEGIN
  -- Calcul overlap via tstzrange. On ignore les réservations annulées ou honorées.
  -- Note : 'reportee' = la réservation a été déplacée (date_heure mise à jour),
  -- donc ne bloque pas la nouvelle fenêtre.
  SELECT COUNT(*) INTO v_conflict_count
  FROM public.reservations AS r
  WHERE r.poste_id = NEW.poste_id
    AND r.statut IN ('en_attente', 'confirmee')
    AND r.id IS DISTINCT FROM NEW.id  -- en cas d'UPDATE, ignorer soi-même
    AND tstzrange(r.date_heure, r.date_heure + (r.duree_min || ' minutes')::interval, '[)')
        && tstzrange(NEW.date_heure, NEW.date_heure + (NEW.duree_min || ' minutes')::interval, '[)');

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION 'Conflit : le poste % est déjà réservé sur ce créneau (%)', NEW.poste_id, NEW.date_heure
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger BEFORE INSERT OR UPDATE OF (poste_id, date_heure, duree_min, statut)
DROP TRIGGER IF EXISTS trg_reservations_check_overlap ON public.reservations;
CREATE TRIGGER trg_reservations_check_overlap
  BEFORE INSERT OR UPDATE OF poste_id, date_heure, duree_min, statut ON public.reservations
  FOR EACH ROW
  WHEN (NEW.statut IN ('en_attente', 'confirmee'))
  EXECUTE FUNCTION public.check_reservation_overlap();

-- Index GiST sur tstzrange pour accélérer la détection d'overlap.
-- DÉSACTIVÉ 2026-08-12 (2e push échouait au statement 28 =
-- `CREATE EXTENSION IF NOT EXISTS btree_gist`). Diagnostic 2026-08-16 :
-- vraie erreur de contrainte Postgres — l'expression
-- `(duree_min || ' minutes')::interval` n'est PAS IMMUTABLE (textcat +
-- cast text->interval = STABLE) → `ERROR: functions in index expression
-- must be marked IMMUTABLE`, sur n'importe quel serveur. Même sans
-- l'extension, ce CREATE INDEX aurait échoué.
-- RÉACTIVÉ avec correctif (make_interval, IMMUTABLE) dans la migration
-- dédiée `20260816000000_11_reactiver_index_gist_reservations.sql`.


-- ================================================================
-- BONUS — Grant service_role sur idempotency_keys (déjà fait en A.2)
-- ================================================================
-- Rien à ajouter. service_role a déjà tous les droits via GRANT ALL.


-- ================================================================
-- FIN DE LA MIGRATION
-- ================================================================
-- Résumé des objets créés / modifiés :
--   A.1 : Function compute_reservation_price(uuid, integer) — SECURITY DEFINER
--   A.2 : Table idempotency_keys (UNIQUE user_id+key+endpoint, idx expires)
--   A.3 : Table payments + 4 index + RLS (lecture seule pour authenticated)
--   A.4 : CHECK reservations_duree_min_check étendu à >= 30
--   A.5 : Function check_reservation_overlap() + trigger
--         (index GiST réactivé avec correctif IMMUTABLE — voir migration
--         20260816000000_11_reactiver_index_gist_reservations.sql)
--
-- Push Supabase : `supabase db push` par Yannick (action externe AE-2).
-- Rollback si besoin : DROP TABLE payments, idempotency_keys, DROP FUNCTION
--   compute_reservation_price, check_reservation_overlap, ALTER TABLE
--   reservations DROP CONSTRAINT reservations_duree_min_check + recréer
--   l'ancien CHECK, DROP INDEX idx_reservations_poste_range.
--
-- ⚠️ Post-push (à vérifier par Yannick après 2e tentative) :
--   - Confirmer que l'enum payment_method inclut bien 'carte'.
--     Requête : SELECT enumlabel FROM pg_enum
--               WHERE enumtypid = 'public.payment_method'::regtype;
--     Attendu : 'cash', 'airtel_money', 'mtn_money', 'carte'.
--     Depuis PG 12, ALTER TYPE ADD VALUE est transactionnel → devrait
--     être revenu à l'état pré-migration après le rollback du 1er push.
--     Si 'carte' est présent quand même (peu probable), c'est sans impact :
--     l'ALTER TYPE est idempotent.
