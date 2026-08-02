import { createFileRoute, Outlet, Link, redirect, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import "@/views/theme.css";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/platform")({
  // RT.H.8 — la garde anti-boucle de redirection est ici.
  // Avant ce hook, useEffect montait après render ET relisait roles via
  // useUserAccess, ce qui createsait une fenêtre transitoire avec
  // isPlatformAdmin=false → redirect vers / → loop. En beforeLoad, la
  // décision est prise avant tout render ; un seul aller-retour.
  beforeLoad: async ({ context }) => {
    // Le parent _authenticated.beforeLoad garantit user !== null
    // (déjà vérifié via supabase.auth.getUser()).
    const user = context.user as { id: string };
    if (!user) throw redirect({ to: "/auth" });

    const { data: roles, error } = await supabase
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", user.id);

    // Fail-closed : on n'affiche pas la plateforme si on ne peut pas vérifier.
    if (error) throw redirect({ to: "/" });

    const isPlatformAdmin = (roles ?? []).some((r) => r.role === "platform_admin");
    if (!isPlatformAdmin) throw redirect({ to: "/" });

    // Retour optionnel pour réutilisation par les enfants via context.
    return { platformRoles: roles ?? [] };
  },
  component: PlatformShell,
});

/**
 * Coquille platform — Kingston GameZone (RT.B.13 + RT.H.8).
 * Garde d'accès déplacée en beforeLoad (avant render). Affiche la palette KG
 * (accent violet) pour distinguer de l'espace client. La page
 * `platform/index.tsx` (RT.B.14) accueille la carte « Administrateurs
 * plateforme » (étape 5B.3).
 */
function PlatformShell() {
  const { user } = useSession();
  const navigate = useNavigate();

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <div className="kg-platform-shell">
      <header className="kg-platform-header" role="banner">
        <Link to="/" className="kg-platform-brand" aria-label="Kingston GameZone — Accueil">
          <img src={logo} alt="" aria-hidden="true" className="kg-platform-brand-logo" />
          <span className="kg-platform-brand-text">Admin plateforme</span>
        </Link>
        <div className="kg-platform-user">
          {user?.email && <span className="kg-platform-email">{user.email}</span>}
          <button
            type="button"
            onClick={signOut}
            className="kg-platform-signout"
            aria-label="Se déconnecter"
          >
            Déconnexion
          </button>
        </div>
      </header>
      <main className="kg-platform-main">
        <Outlet />
      </main>
      {/* RT.B V1 — ToastContainer local retiré (RT.T.0) : maintenant monté
          globalement dans `__root.tsx` via le store Zustand, ce qui élimine
          la dette de double-mount et couvre aussi `/client`. */}
    </div>
  );
}
