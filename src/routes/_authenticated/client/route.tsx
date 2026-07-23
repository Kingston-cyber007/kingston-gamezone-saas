import { createFileRoute, Outlet, Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/session";
import logoAsset from "@/assets/kingston-logo.png.asset.json";

export const Route = createFileRoute("/_authenticated/client")({
  component: ClientShell,
});

function ClientShell() {
  const { user } = useSession();
  const navigate = useNavigate();
  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }
  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#0a1e2e,#050b14)] text-white">
      <header className="max-w-5xl mx-auto flex items-center justify-between p-6">
        <Link to="/" className="flex items-center gap-3">
          <img src={logoAsset.url} alt="Kingston GameZone" className="h-10" />
          <span className="font-bold text-cyan-300">Espace client</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-gray-400">{user?.email}</span>
          <button onClick={signOut} className="px-3 py-1.5 rounded-lg border border-cyan-500/40 hover:bg-cyan-500/10">Déconnexion</button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto p-6"><Outlet /></main>
    </div>
  );
}
