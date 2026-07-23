import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useSession, useUserAccess } from "@/lib/session";
import { useNavigate } from "@tanstack/react-router";
import logoAsset from "@/assets/kingston-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kingston GameZone — Plateforme SaaS gaming" },
      { name: "description", content: "Gérez votre salle de gaming en ligne : caisse, tickets, sessions, statistiques et fidélité. Multi-salles, RBAC, offline-first." },
      { property: "og:title", content: "Kingston GameZone — SaaS gaming" },
      { property: "og:description", content: "La caisse et le CRM des salles de gaming d'Afrique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useSession();
  const { staffTenants, isPlatformAdmin, isClient, loading: accessLoading } = useUserAccess(user);
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || accessLoading || !user) return;
    // Auto-route signed-in users to their primary surface
    if (isPlatformAdmin) navigate({ to: "/platform" });
    else if (staffTenants.length > 0) navigate({ to: "/app/salle" });
    else if (isClient) navigate({ to: "/client" });
    // else: no roles yet — stay on landing
  }, [loading, accessLoading, user, isPlatformAdmin, isClient, staffTenants.length, navigate]);

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,#1a0f2e,#0a0614)] text-white">
      <header className="max-w-6xl mx-auto flex items-center justify-between p-6">
        <img src={logoAsset.url} alt="Kingston GameZone" className="h-14" />
        <nav className="flex gap-3">
          {user ? (
            <>
              {staffTenants.length > 0 && <Link to="/app/salle" className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500">Caisse</Link>}
              {isClient && <Link to="/client" className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500">Mon espace</Link>}
              {isPlatformAdmin && <Link to="/platform" className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500">Plateforme</Link>}
            </>
          ) : (
            <Link to="/auth" className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90">Connexion</Link>
          )}
        </nav>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <section className="text-center max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-black leading-tight bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            La caisse gaming pour l'Afrique
          </h1>
          <p className="mt-6 text-lg text-gray-300">
            Gérez vos postes, tickets, sessions et paiements Mobile Money — même hors connexion.
            Multi-salles, rôles fins, statistiques temps réel.
          </p>
          <div className="mt-8 flex gap-3 justify-center flex-wrap">
            <Link to="/auth" className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 font-semibold hover:opacity-90">
              Commencer
            </Link>
            {user && staffTenants.length > 0 && (
              <Link to="/app/salle" className="px-6 py-3 rounded-xl border border-purple-500/40 hover:bg-purple-500/10">
                Ouvrir la caisse
              </Link>
            )}
          </div>
        </section>

        <section className="grid md:grid-cols-3 gap-6 mt-20">
          {[
            { icon: "🎮", title: "Sessions & postes", body: "Suivi temps réel, alertes sonores et vocales, pause/reprise." },
            { icon: "🎫", title: "Tickets & fidélité", body: "QR codes, scanner caméra, temps sauvegardé, points de fidélité." },
            { icon: "💳", title: "Mobile Money", body: "Airtel Money, MTN, cash — reconciliations et stats par mode." },
            { icon: "📊", title: "Statistiques", body: "Revenu jour / semaine / mois, top postes, top clients, exports." },
            { icon: "🌐", title: "Offline-first", body: "L'app tourne sans internet ; sync automatique dès la reconnexion." },
            { icon: "🏢", title: "Multi-salles", body: "Consolidez plusieurs points de vente sous un même compte." },
          ].map((c) => (
            <div key={c.title} className="rounded-2xl bg-black/40 border border-purple-500/20 p-6 hover:border-purple-400/40 transition">
              <div className="text-3xl">{c.icon}</div>
              <h3 className="mt-3 font-bold text-lg">{c.title}</h3>
              <p className="mt-2 text-sm text-gray-400">{c.body}</p>
            </div>
          ))}
        </section>

        {user && staffTenants.length === 0 && !isPlatformAdmin && !isClient && (
          <section className="mt-16 max-w-xl mx-auto rounded-2xl bg-amber-500/10 border border-amber-500/30 p-6 text-center">
            <p className="text-amber-200">
              Votre compte n'a pas encore de rôle. Contactez votre administrateur pour être ajouté à une salle.
            </p>
          </section>
        )}
      </main>

      <footer className="border-t border-purple-500/10 mt-16 py-8 text-center text-sm text-gray-500">
        Kingston GameZone — Pointe-Noire · Congo
      </footer>
    </div>
  );
}
