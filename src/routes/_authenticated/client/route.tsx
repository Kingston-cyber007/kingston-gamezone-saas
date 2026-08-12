import { createFileRoute, Outlet, Link, useNavigate, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import "@/views/theme.css";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/client")({
  // ND3 — Fix #3 (audit 2026-08-03) : ajout d'un beforeLoad RBAC filtrant
  // le rôle 'client'. Avant ce fix, n'importe quel utilisateur authentifié
  // (staff, lounge_admin, platform_admin) pouvait visiter /client et voir
  // un écran vide — incohérent avec /app/* et /platform/* qui filtrent
  // par rôle. Pattern copié de _authenticated/app/route.tsx:32-58 (RT.P.0-ppfix).
  //
  // Fail-closed : si erreur SQL → redirect, jamais accès.
  beforeLoad: async ({ context }) => {
    const user = context.user as { id: string } | undefined;
    if (!user) throw redirect({ to: "/auth" });

    const { data: roles, error } = await supabase
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", user.id);

    if (error) throw redirect({ to: "/" });

    const list = roles ?? [];
    const isClient = list.some((r) => r.role === "client");

    // Pas de rôle 'client' → pas d'accès à /client/*
    if (!isClient) throw redirect({ to: "/" });

    return { isClient };
  },
  component: ClientShell,
});

/**
 * Coquille client — Kingston GameZone (RT.B.12).
 * Topbar violet/cyan + bouton déconnexion cyan. Garde le visuel cohérent
 * avec la palette KG (même background que landing et auth).
 */
function ClientShell() {
  const { user } = useSession();
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }
  return (
    <div className="kg-client-shell">
      <header className="kg-client-header" role="banner">
        <Link to="/" className="kg-client-brand" aria-label="Kingston GameZone — Accueil">
          <img src={logo} alt="" aria-hidden="true" className="kg-client-brand-logo" />
          <span className="kg-client-brand-text">Espace client</span>
        </Link>
        <div className="kg-client-user">
          {user?.email && <span className="kg-client-email">{user.email}</span>}
          <button
            type="button"
            onClick={signOut}
            className="kg-client-signout"
            aria-label="Se déconnecter"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <main className="kg-client-main">
        <Outlet />
      </main>
    </div>
  );
}