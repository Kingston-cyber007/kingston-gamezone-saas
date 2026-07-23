import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useUserAccess } from "@/lib/session";
import logoAsset from "@/assets/kingston-logo.png.asset.json";

export const Route = createFileRoute("/_authenticated/platform")({
  component: PlatformShell,
});

function PlatformShell() {
  const { user } = useSession();
  const { isPlatformAdmin, loading } = useUserAccess(user);
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !isPlatformAdmin) navigate({ to: "/" });
  }, [loading, isPlatformAdmin, navigate]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#2e1a0f,#140a06)] text-white">
      <header className="max-w-6xl mx-auto flex items-center justify-between p-6">
        <Link to="/" className="flex items-center gap-3">
          <img src={logoAsset.url} alt="Kingston GameZone" className="h-10" />
          <span className="font-bold text-amber-300">Admin plateforme</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400">{user?.email}</span>
          <button onClick={signOut} className="px-3 py-1.5 rounded-lg border border-amber-500/40 hover:bg-amber-500/10">Déconnexion</button>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6"><Outlet /></main>
    </div>
  );
}
