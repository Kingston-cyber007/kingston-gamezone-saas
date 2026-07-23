
-- ================================================================
-- KINGSTON GAMEZONE — Phase 1/2 : Multi-tenant + RBAC foundation
-- ================================================================

-- 1) Enums
CREATE TYPE public.app_role AS ENUM ('platform_admin', 'lounge_admin', 'staff', 'client');
CREATE TYPE public.tenant_status AS ENUM ('active', 'suspended');
CREATE TYPE public.payment_method AS ENUM ('cash', 'airtel_money', 'mtn_money');
CREATE TYPE public.ticket_status AS ENUM ('valid', 'exhausted', 'expired');
CREATE TYPE public.poste_status AS ENUM ('idle', 'busy');

-- 2) profiles (linked to auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  display_name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert their own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- 3) tenants
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status public.tenant_status NOT NULL DEFAULT 'active',
  billing_status text NOT NULL DEFAULT 'trial',
  logo_url text,
  city text,
  country text DEFAULT 'CG',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- 4) user_tenant_roles — the KEY table (RBAC per tenant)
CREATE TABLE public.user_tenant_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE, -- NULL = platform-wide role
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id, role)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_tenant_roles TO authenticated;
GRANT ALL ON public.user_tenant_roles TO service_role;
ALTER TABLE public.user_tenant_roles ENABLE ROW LEVEL SECURITY;

-- 5) Security definer functions (prevent RLS recursion)

-- has_role(user, role, tenant): true if user has role on tenant OR platform-wide
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role, _tenant_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_tenant_roles
    WHERE user_id = _user_id
      AND role = _role
      AND (tenant_id = _tenant_id OR tenant_id IS NULL)
  );
$$;

-- is_platform_admin(user)
CREATE OR REPLACE FUNCTION public.is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_tenant_roles WHERE user_id = _user_id AND role = 'platform_admin');
$$;

-- get_user_tenants(user): tenants a user has any role on
CREATE OR REPLACE FUNCTION public.get_user_tenants(_user_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT tenant_id FROM public.user_tenant_roles
  WHERE user_id = _user_id AND tenant_id IS NOT NULL;
$$;

-- has_tenant_access(user, tenant)
CREATE OR REPLACE FUNCTION public.has_tenant_access(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_platform_admin(_user_id)
      OR EXISTS (SELECT 1 FROM public.user_tenant_roles WHERE user_id = _user_id AND tenant_id = _tenant_id);
$$;

-- RLS policies on tenants & user_tenant_roles (after functions exist)
CREATE POLICY "Users can view their tenants" ON public.tenants FOR SELECT
  USING (public.has_tenant_access(auth.uid(), id));
CREATE POLICY "Platform admins can manage tenants" ON public.tenants FOR ALL
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

CREATE POLICY "Users can view their own role assignments" ON public.user_tenant_roles FOR SELECT
  USING (auth.uid() = user_id OR public.is_platform_admin(auth.uid()));
CREATE POLICY "Lounge admins manage staff on their tenant" ON public.user_tenant_roles FOR ALL
  USING (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND public.has_role(auth.uid(), 'lounge_admin', tenant_id))
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR (tenant_id IS NOT NULL AND public.has_role(auth.uid(), 'lounge_admin', tenant_id))
  );

-- 6) Kingston domain tables (tenant-scoped)
CREATE TABLE public.postes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  position int NOT NULL,
  name text NOT NULL,
  emoji text,
  status public.poste_status NOT NULL DEFAULT 'idle',
  duration_min int,
  started_at timestamptz,
  ends_at timestamptz,
  paused boolean NOT NULL DEFAULT false,
  remaining_ms bigint,
  drink_count int NOT NULL DEFAULT 0,
  ticket_id uuid,
  ticket_code text,
  client_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, position)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.postes TO authenticated;
GRANT ALL ON public.postes TO service_role;
ALTER TABLE public.postes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read postes" ON public.postes FOR SELECT USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY "Staff manage postes" ON public.postes FOR ALL
  USING (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  nom text NOT NULL,
  prenom text NOT NULL,
  age int,
  client_user_id uuid REFERENCES auth.users(id),
  date_creation timestamptz NOT NULL DEFAULT now(),
  date_expiration timestamptz NOT NULL,
  saved_remaining_ms bigint,
  used_saved_time boolean NOT NULL DEFAULT false,
  total_minutes_played int NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickets TO authenticated;
GRANT ALL ON public.tickets TO service_role;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read tickets" ON public.tickets FOR SELECT
  USING (public.has_tenant_access(auth.uid(), tenant_id) OR client_user_id = auth.uid());
CREATE POLICY "Staff manage tickets" ON public.tickets FOR ALL
  USING (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));
CREATE POLICY "Clients create own tickets" ON public.tickets FOR INSERT
  WITH CHECK (client_user_id = auth.uid());

CREATE TABLE public.sessions_caisse (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  poste_id uuid REFERENCES public.postes(id) ON DELETE SET NULL,
  poste_name text NOT NULL,
  ticket_id uuid REFERENCES public.tickets(id) ON DELETE SET NULL,
  ticket_code text,
  client_name text,
  ts timestamptz NOT NULL DEFAULT now(),
  day date NOT NULL DEFAULT CURRENT_DATE,
  duration_min int NOT NULL,
  drink_count int NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  payment_method public.payment_method NOT NULL DEFAULT 'cash',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions_caisse TO authenticated;
GRANT ALL ON public.sessions_caisse TO service_role;
ALTER TABLE public.sessions_caisse ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read sessions" ON public.sessions_caisse FOR SELECT USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY "Staff manage sessions" ON public.sessions_caisse FOR ALL
  USING (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));

CREATE TABLE public.tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  poste_count int NOT NULL DEFAULT 5,
  warn_minutes int NOT NULL DEFAULT 5,
  prices jsonb NOT NULL DEFAULT '{"30":500,"60":900,"90":1300,"120":1600}'::jsonb,
  custom_price_per_minute int NOT NULL DEFAULT 15,
  price_drink int NOT NULL DEFAULT 200,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;
GRANT ALL ON public.tenant_settings TO service_role;
ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members read settings" ON public.tenant_settings FOR SELECT USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY "Lounge admins update settings" ON public.tenant_settings FOR ALL
  USING (public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));

-- 7) Loyalty (Phase 3 stub)
CREATE TABLE public.loyalty_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  client_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.loyalty_points TO authenticated;
GRANT ALL ON public.loyalty_points TO service_role;
ALTER TABLE public.loyalty_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clients read own loyalty" ON public.loyalty_points FOR SELECT USING (client_user_id = auth.uid() OR public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY "Staff manage loyalty" ON public.loyalty_points FOR ALL
  USING (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(), 'staff', tenant_id) OR public.has_role(auth.uid(), 'lounge_admin', tenant_id) OR public.is_platform_admin(auth.uid()));

-- 8) Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 9) Auto-update updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_tenants_updated BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_postes_updated BEFORE UPDATE ON public.postes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_tenant_settings_updated BEFORE UPDATE ON public.tenant_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 10) Seed the Kingston Gaming tenant
INSERT INTO public.tenants (name, slug, status, billing_status, city, country)
VALUES ('Kingston GameZone', 'kingston', 'active', 'active', 'Pointe-Noire', 'CG')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.tenant_settings (tenant_id)
SELECT id FROM public.tenants WHERE slug = 'kingston'
ON CONFLICT (tenant_id) DO NOTHING;
