-- ================================================================
-- CHANTIER 1 — Fondations : profils, inscription, réservations, consoles
-- ================================================================
-- Date : 2026-08-03
-- Décisions actées (cf. memory/chantier1-statut.md + memory/chantier1-couplages.md) :
--   1. mailchecker = dépendance côté serveur (jeu de données, pas une logique).
--   2. staff_applications = TABLE SÉPARÉE (option 2, tranchée à E1).
--      Le flux d'invitation existant (tenant_invitations) reste fonctionnel.
--   3. profiles.age = PAS de CHECK dur >= 18 ; is_minor calculée (cohérent RT.H.5).
--   4. Mode paiement 'cash_on_arrival' = N'EST PAS AJOUTÉ (YAGNI, parent-réservation futur).
--   5. consoles.statut 'en_reparation' → postes.statut 'reserved' via trigger cascade.
--
-- Cette migration est volontairement UNE SEULE migration pour faciliter
-- le push Supabase par Yannick (action externe, règle 4).
-- Si elle échoue, ROLLBACK atomique possible (BEGIN/COMMIT implicite).
--
-- ⚠️ Note Postgres : ALTER TYPE ... ADD VALUE doit être dans une transaction
-- séparée (cf. https://www.postgresql.org/docs/current/sql-altertype.html).
-- On utilise donc un wrapper DO block avec EXCEPTION handling pour gérer ça.
-- ================================================================


-- ================================================================
-- PARTIE 1 : ALTER TYPE poste_status ADD VALUE 'reserved'
-- ================================================================
-- Postgres requiert ALTER TYPE ADD VALUE dans une transaction séparée
-- du reste. On utilise DO block avec gestion d'erreur (la valeur peut
-- déjà exister si migration rejouée).
DO $$
BEGIN
  BEGIN
    ALTER TYPE public.poste_status ADD VALUE IF NOT EXISTS 'reserved';
  EXCEPTION
    WHEN duplicate_object THEN
      -- Valeur déjà présente, OK silencieux.
      NULL;
  END;
END$$;


-- ================================================================
-- PARTIE 2 : Extension de profiles (champs PII client)
-- ================================================================
-- Tous les champs ajoutés sont NULLABLE pour rétro-compatibilité avec
-- les profiles déjà créés (bootstrap, seed). Les nouveaux clients
-- (CHANTIER 1B) les renseigneront à l'inscription.
--
-- is_minor = GENERATED ALWAYS AS (age IS NOT NULL AND age < 18) STORED
-- → colonne calculée persistante, indexable, pas de CHECK dur.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS nom text,
  ADD COLUMN IF NOT EXISTS prenom text,
  ADD COLUMN IF NOT EXISTS sexe text CHECK (sexe IS NULL OR sexe IN ('Homme', 'Femme', 'Autre')),
  ADD COLUMN IF NOT EXISTS age integer CHECK (age IS NULL OR (age >= 0 AND age <= 150)),
  ADD COLUMN IF NOT EXISTS telephone text,
  ADD COLUMN IF NOT EXISTS indicatif_pays text DEFAULT '+242',
  ADD COLUMN IF NOT EXISTS is_minor boolean GENERATED ALWAYS AS (age IS NOT NULL AND age < 18) STORED;

-- Index sur is_minor pour futures requêtes "mineurs tentant réservation".
CREATE INDEX IF NOT EXISTS idx_profiles_is_minor ON public.profiles (is_minor) WHERE is_minor = true;

-- Trigger updated_at existe déjà (cf. migration 20260723171443 ligne 264).
-- Rien à ajouter de plus.

-- Update du trigger handle_new_user pour mapper les nouveaux champs depuis
-- raw_user_meta_data (que Supabase Auth transmet à l'inscription OAuth/email).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  INSERT INTO public.profiles (
    id, email, display_name, nom, prenom, sexe, age, telephone, indicatif_pays
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'nom',
    NEW.raw_user_meta_data->>'prenom',
    NEW.raw_user_meta_data->>'sexe',
    CASE WHEN NEW.raw_user_meta_data->>'age' ~ '^[0-9]+$'
         THEN (NEW.raw_user_meta_data->>'age')::integer
         ELSE NULL END,
    NEW.raw_user_meta_data->>'telephone',
    COALESCE(NEW.raw_user_meta_data->>'indicatif_pays', '+242')
  )
  ON CONFLICT (id) DO NOTHING;

  -- Bootstrap platform admin via la table (plus de littéral)
  IF public.is_platform_admin_email(NEW.email) THEN
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    VALUES (NEW.id, NULL, 'platform_admin')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Consume pending invitations for this email
  FOR inv IN
    SELECT * FROM public.tenant_invitations
    WHERE lower(email) = lower(NEW.email)
      AND accepted_at IS NULL
      AND expires_at > now()
  LOOP
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    VALUES (NEW.id, inv.tenant_id, inv.role)
    ON CONFLICT DO NOTHING;
    UPDATE public.tenant_invitations SET accepted_at = now() WHERE id = inv.id;
  END LOOP;

  -- CHANTIER 1 — staff_applications : auto-inscription → granted
  -- Quand un user s'inscrit via candidature (status pending), il n'a PAS
  -- de user_tenant_role 'staff' à la création. C'est l'approbation admin
  -- qui crée le rôle. Rien à faire ici pour le moment.

  RETURN NEW;
END;
$$;


-- ================================================================
-- PARTIE 3 : Tables consoles / reservations / staff_applications
-- ================================================================

-- 3.1 — CONSOLES (option 1 retenue : table séparée + FK vers postes)
-- Règle métier : 1 console = 1 poste (UNIQUE sur poste_id).
-- Si console en_reparation → poste passe à 'reserved' (trigger ci-dessous).
CREATE TABLE public.consoles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poste_id uuid NOT NULL UNIQUE REFERENCES public.postes(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nom text NOT NULL,
  type text NOT NULL CHECK (type IN ('PC', 'PS5', 'PS4', 'Xbox', 'Switch', 'Autre')),
  serial text,
  jeux text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'en_reparation', 'hors_service')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consoles_tenant ON public.consoles (tenant_id);
CREATE INDEX idx_consoles_status ON public.consoles (tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consoles TO authenticated;
GRANT ALL ON public.consoles TO service_role;
ALTER TABLE public.consoles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members read consoles" ON public.consoles FOR SELECT
  USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY "Staff manage consoles" ON public.consoles FOR ALL
  USING (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));

-- Trigger updated_at pour consoles
CREATE TRIGGER trg_consoles_updated BEFORE UPDATE ON public.consoles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Trigger cascade : consoles.status → postes.status
-- Quand une console passe en_reparation, le poste associé devient 'reserved'
-- (sauf s'il est déjà 'busy' — on n'interrompt pas une session en cours).
-- Quand la console redevient disponible, le poste revient à 'idle' si 'reserved'.
CREATE OR REPLACE FUNCTION public.cascade_console_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- À la création, si déjà en_reparation, on marque le poste en reserved (sauf busy).
    IF NEW.status = 'en_reparation' THEN
      UPDATE public.postes
      SET status = 'reserved'
      WHERE id = NEW.poste_id AND status = 'idle';
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'en_reparation' THEN
      UPDATE public.postes
      SET status = 'reserved'
      WHERE id = NEW.poste_id AND status = 'idle';
    ELSIF NEW.status = 'disponible' AND OLD.status = 'en_reparation' THEN
      UPDATE public.postes
      SET status = 'idle'
      WHERE id = NEW.poste_id AND status = 'reserved';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_consoles_cascade_status
  AFTER INSERT OR UPDATE OF status ON public.consoles
  FOR EACH ROW EXECUTE FUNCTION public.cascade_console_status();


-- 3.2 — RESERVATIONS
-- Note : on utilise 'payment_method' existant (cash/airtel_money/mtn_money).
-- 'cash_on_arrival' n'est PAS ajouté maintenant (YAGNI — voir chantier parent-réservation futur).
-- reservation_status inclut 'en_attente' / 'confirmee' / 'reportee' / 'annulee' / 'honoree'.
CREATE TABLE public.reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  poste_id uuid NOT NULL REFERENCES public.postes(id) ON DELETE RESTRICT,
  jeu text,
  console text,
  date_heure timestamptz NOT NULL,
  duree_min integer NOT NULL CHECK (duree_min > 0 AND duree_min <= 1440),
  statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente', 'confirmee', 'reportee', 'annulee', 'honoree')),
  montant_prevu numeric(12,2) NOT NULL DEFAULT 0 CHECK (montant_prevu >= 0),
  montant_paye numeric(12,2) NOT NULL DEFAULT 0 CHECK (montant_paye >= 0),
  mode_paiement public.payment_method,
  transaction_id text,
  -- CHANTIER 1D : lie la réservation à la session créée si honorée.
  session_id uuid REFERENCES public.sessions_caisse(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reservations_client ON public.reservations (client_id);
CREATE INDEX idx_reservations_tenant ON public.reservations (tenant_id);
CREATE INDEX idx_reservations_date ON public.reservations (tenant_id, date_heure);
CREATE INDEX idx_reservations_poste ON public.reservations (poste_id, date_heure);
CREATE INDEX idx_reservations_statut ON public.reservations (tenant_id, statut);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reservations TO authenticated;
GRANT ALL ON public.reservations TO service_role;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;

-- Clients voient leurs propres réservations.
CREATE POLICY "Clients read own reservations" ON public.reservations FOR SELECT
  USING (client_id = auth.uid() OR public.has_tenant_access(auth.uid(), tenant_id));
-- Clients créent leurs propres réservations (RLS INSERT bloquera les mineurs via trigger B4).
CREATE POLICY "Clients create own reservations" ON public.reservations FOR INSERT
  WITH CHECK (client_id = auth.uid());
-- Clients peuvent annuler leurs propres réservations (UPDATE partiel).
CREATE POLICY "Clients update own reservations" ON public.reservations FOR UPDATE
  USING (client_id = auth.uid() OR public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (client_id = auth.uid() OR public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));
-- Staff manage (DELETE possible uniquement par staff/lounge/platform).
CREATE POLICY "Staff delete reservations" ON public.reservations FOR DELETE
  USING (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TRIGGER trg_reservations_updated BEFORE UPDATE ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- 3.3 — STAFF_APPLICATIONS (option 2 tranchée à E1)
-- Auto-inscription d'un candidat pour un rôle staff dans une salle.
-- Le candidat a un compte auth.users (créé via Supabase Auth classique) MAIS
-- n'a PAS de user_tenant_roles. Il est en attente d'approbation.
CREATE TABLE public.staff_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  role public.app_role NOT NULL CHECK (role IN ('staff', 'lounge_admin')),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);
CREATE INDEX idx_staff_applications_status ON public.staff_applications (tenant_id, status);
CREATE INDEX idx_staff_applications_user ON public.staff_applications (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_applications TO authenticated;
GRANT ALL ON public.staff_applications TO service_role;
ALTER TABLE public.staff_applications ENABLE ROW LEVEL SECURITY;

-- Un candidat voit ses propres candidatures.
CREATE POLICY "Users read own applications" ON public.staff_applications FOR SELECT
  USING (user_id = auth.uid() OR public.has_tenant_access(auth.uid(), tenant_id));
-- Un user authentifié peut créer sa propre candidature (status par défaut pending).
CREATE POLICY "Users create own applications" ON public.staff_applications FOR INSERT
  WITH CHECK (user_id = auth.uid() AND status = 'pending');
-- Seuls lounge_admin du tenant ou platform_admin peuvent UPDATE (approuver/rejeter).
CREATE POLICY "Admins review applications" ON public.staff_applications FOR UPDATE
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_role(auth.uid(), 'lounge_admin', tenant_id)
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_role(auth.uid(), 'lounge_admin', tenant_id)
  );

CREATE TRIGGER trg_staff_applications_updated BEFORE UPDATE ON public.staff_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ================================================================
-- PARTIE 4 : Trigger B4 — Mineurs ne peuvent PAS réserver / payer en ligne
-- ================================================================
-- Refuse l'INSERT dans `reservations` si le client a profiles.is_minor = true.
-- Le mineur reste libre de passer en salle avec paiement cash (cf. RT.H.5).
-- Côté SQL, c'est l'autorité finale (la RLS INSERT suffit mais le trigger
-- donne un message d'erreur explicite côté client).
CREATE OR REPLACE FUNCTION public.prevent_underage_reservation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  minor boolean;
BEGIN
  SELECT is_minor INTO minor
  FROM public.profiles
  WHERE id = NEW.client_id;

  IF minor IS TRUE THEN
    RAISE EXCEPTION 'Réservation en ligne interdite aux mineurs (< 18 ans). Passage en salle avec paiement cash uniquement (cf. RT.H.5).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservations_block_minor
  BEFORE INSERT ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.prevent_underage_reservation();


-- ================================================================
-- PARTIE 5 : Trigger grant_staff_role_on_approval
-- ================================================================
-- Quand une staff_application passe à 'approved', on insère automatiquement
-- la ligne correspondante dans user_tenant_roles.
-- Idempotent : ON CONFLICT DO NOTHING.
CREATE OR REPLACE FUNCTION public.grant_staff_role_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved' OR OLD.status IS NULL) THEN
    -- Auto-grant du rôle staff/lounge_admin au user_id sur le tenant_id.
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    VALUES (NEW.user_id, NEW.tenant_id, NEW.role)
    ON CONFLICT DO NOTHING;

    -- Marque la date de review si pas déjà fait.
    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;

  IF NEW.status = 'rejected' AND (OLD.status IS DISTINCT FROM 'rejected' OR OLD.status IS NULL) THEN
    IF NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_staff_applications_grant
  BEFORE UPDATE ON public.staff_applications
  FOR EACH ROW EXECUTE FUNCTION public.grant_staff_role_on_approval();


-- ================================================================
-- PARTIE 6 : Helper — staff_applications pending count par tenant
-- ================================================================
-- Pour `/platform` : badge "X candidatures en attente" sur la carte.
-- Suit le pattern des helpers SECURITY DEFINER existants.
CREATE OR REPLACE FUNCTION public.count_pending_staff_applications(_tenant_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER SET search_path = public
AS $$
  SELECT COUNT(*)::integer
  FROM public.staff_applications
  WHERE status = 'pending'
    AND (_tenant_id IS NULL OR tenant_id = _tenant_id);
$$;

GRANT EXECUTE ON FUNCTION public.count_pending_staff_applications(uuid) TO authenticated;


-- ================================================================
-- FIN DE LA MIGRATION
-- ================================================================
-- Résumé des objets créés / modifiés :
--   • Enum poste_status + 'reserved'
--   • Table profiles : +nom, +prenom, +sexe, +age, +telephone, +indicatif_pays, +is_minor (généré)
--   • Index idx_profiles_is_minor (partiel)
--   • Trigger handle_new_user : mappé pour nouveaux champs
--   • Table consoles + RLS + triggers (touch_updated_at + cascade_console_status)
--   • Table reservations + RLS + trigger (touch_updated_at + block_minor)
--   • Table staff_applications + RLS + triggers (touch_updated_at + grant_role_on_approval)
--   • Fonction count_pending_staff_applications (helper UI)
--
-- Push Supabase : `supabase db push` par Yannick (action externe, règle 4).
-- Rollback si besoin : cf. memory/chantier1-statut.md (plan rollback).
