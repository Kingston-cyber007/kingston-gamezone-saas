
-- Realtime — RT.H.7 — désactivé en migration.
-- Supabase bloque les commandes touchant la réplication (`ALTER PUBLICATION supabase_realtime`
-- ET `ALTER TABLE ... REPLICA IDENTITY FULL`) via CLI/migration. À configurer manuellement via
-- Dashboard → Database → Publications → supabase_realtime → ajouter les 3 tables
-- (sessions_caisse, postes, tickets). Le mode `REPLICA IDENTITY DEFAULT` est géré automatiquement.
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.sessions_caisse;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.postes;
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
-- ALTER TABLE public.sessions_caisse REPLICA IDENTITY FULL;
-- ALTER TABLE public.postes REPLICA IDENTITY FULL;
-- ALTER TABLE public.tickets REPLICA IDENTITY FULL;

-- Invitations table
CREATE TABLE public.tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.app_role NOT NULL,
  token TEXT NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_invitations_email ON public.tenant_invitations (lower(email));
CREATE INDEX idx_tenant_invitations_tenant ON public.tenant_invitations (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_invitations TO authenticated;
GRANT SELECT ON public.tenant_invitations TO anon;
GRANT ALL ON public.tenant_invitations TO service_role;

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage invitations of their tenant"
  ON public.tenant_invitations FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin(auth.uid())
    OR public.has_role(auth.uid(), 'lounge_admin', tenant_id)
  )
  WITH CHECK (
    public.is_platform_admin(auth.uid())
    OR public.has_role(auth.uid(), 'lounge_admin', tenant_id)
  );

CREATE POLICY "Anyone can read invitation by token"
  ON public.tenant_invitations FOR SELECT
  TO anon, authenticated
  USING (accepted_at IS NULL AND expires_at > now());

-- Enhance handle_new_user to bootstrap platform admin + consume invitations
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inv RECORD;
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  -- Bootstrap platform admin
  IF lower(NEW.email) = 'ykingston007@gmail.com' THEN
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

  RETURN NEW;
END;
$$;

-- Make sure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Also grant admin retroactively if the user already exists
DO $$
DECLARE
  u_id UUID;
BEGIN
  SELECT id INTO u_id FROM auth.users WHERE lower(email) = 'ykingston007@gmail.com' LIMIT 1;
  IF u_id IS NOT NULL THEN
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    VALUES (u_id, NULL, 'platform_admin')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
