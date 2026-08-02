-- ================================================================
-- Étape 5A.1 — Externaliser le platform_admin en dehors du code
-- ================================================================
-- Remplace le test en dur 'ykingston007@gmail.com' dans handle_new_user
-- par une consultation de la table public.platform_admins.
-- Avantage : ajouter/retirer un admin = INSERT/DELETE, pas de migration.
--
-- Limitation actuelle (documentée dans MEMOIRE_CAISSE.md) :
-- la seule façon de gérer platform_admins reste une requête SQL
-- manuelle (via le dashboard Supabase) jusqu'à l'étape 5B.3
-- (bouton UI côté /platform). Ce n'est pas un vrai problème de
-- sécurité, juste une dépendance ouverte.

-- 1) Table de référence
CREATE TABLE public.platform_admins (
  email text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

-- 2) Seed initial (l'admin historique)
INSERT INTO public.platform_admins (email, notes)
VALUES ('ykingston007@gmail.com', 'Admin fondateur — bootstrap initial')
ON CONFLICT (email) DO NOTHING;

-- 3) Security : seul un platform_admin peut voir/gérer la table
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Platform admins can view admins" ON public.platform_admins
  FOR SELECT
  USING (public.is_platform_admin(auth.uid()));
CREATE POLICY "Platform admins can manage admins" ON public.platform_admins
  FOR ALL
  USING (public.is_platform_admin(auth.uid()))
  WITH CHECK (public.is_platform_admin(auth.uid()));

-- 4) Helper : est-ce que cet email est platform_admin ?
CREATE OR REPLACE FUNCTION public.is_platform_admin_email(_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE lower(email) = lower(_email));
$$;
GRANT EXECUTE ON FUNCTION public.is_platform_admin_email(text) TO authenticated;

-- 5) Refactor handle_new_user : utilise la table au lieu du littéral
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

  RETURN NEW;
END;
$$;

-- 6) Rétroactivité : si un user existant email-matche platform_admins
--    mais n'a pas encore le rôle, on l'ajoute.
--    (le trigger ne re-fire pas pour les users déjà créés)
DO $$
DECLARE
  pa RECORD;
BEGIN
  FOR pa IN SELECT * FROM public.platform_admins LOOP
    INSERT INTO public.user_tenant_roles (user_id, tenant_id, role)
    SELECT id, NULL, 'platform_admin' FROM auth.users
    WHERE lower(email) = lower(pa.email)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
