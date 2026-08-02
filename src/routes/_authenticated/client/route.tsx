import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import "@/views/theme.css";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/client")({
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