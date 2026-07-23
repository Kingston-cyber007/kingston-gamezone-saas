import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "platform_admin" | "lounge_admin" | "staff" | "client";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  billing_status: string;
}

export interface UserRoleRow {
  tenant_id: string | null;
  role: AppRole;
}

/** Auth session hook — safe for SSR-off routes. */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, user: session?.user ?? null, loading };
}

/** Load current user roles + tenants they can access. */
export function useUserAccess(user: User | null) {
  const [roles, setRoles] = useState<UserRoleRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setRoles([]);
      setTenants([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [rolesRes, tenantsRes] = await Promise.all([
        supabase.from("user_tenant_roles").select("tenant_id, role").eq("user_id", user.id),
        supabase.from("tenants").select("id, name, slug, status, billing_status"),
      ]);
      if (cancelled) return;
      setRoles((rolesRes.data ?? []) as UserRoleRow[]);
      setTenants((tenantsRes.data ?? []) as TenantRow[]);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const isPlatformAdmin = roles.some((r) => r.role === "platform_admin");
  const isLoungeAdmin = (tenantId: string) =>
    isPlatformAdmin || roles.some((r) => r.role === "lounge_admin" && r.tenant_id === tenantId);
  const isStaff = (tenantId: string) =>
    isLoungeAdmin(tenantId) || roles.some((r) => r.role === "staff" && r.tenant_id === tenantId);
  const isClient = roles.some((r) => r.role === "client");

  const staffTenants = tenants.filter(
    (t) => isPlatformAdmin || roles.some((r) => r.tenant_id === t.id && (r.role === "staff" || r.role === "lounge_admin")),
  );

  return { roles, tenants, staffTenants, isPlatformAdmin, isLoungeAdmin, isStaff, isClient, loading };
}

const TENANT_KEY = "kg_active_tenant_id";
export function getActiveTenantId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TENANT_KEY);
}
export function setActiveTenantId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(TENANT_KEY, id);
  else localStorage.removeItem(TENANT_KEY);
}
