
-- 1. Fix touch_updated_at search_path
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

-- 2. Replace permissive invitation SELECT policy with token-lookup RPC
DROP POLICY IF EXISTS "Anyone can read invitation by token" ON public.tenant_invitations;

CREATE OR REPLACE FUNCTION public.get_invitation_by_token(_token text)
RETURNS TABLE (email text, role app_role, tenant_id uuid, expires_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email, role, tenant_id, expires_at
  FROM public.tenant_invitations
  WHERE token = _token
    AND accepted_at IS NULL
    AND expires_at > now()
  LIMIT 1;
$$;

-- 3. Lock down EXECUTE privileges on SECURITY DEFINER functions
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_tenant_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_platform_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_user_tenants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_tenant_access(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tenants(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_invitation_by_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_invitation_by_token(text) TO anon, authenticated;
