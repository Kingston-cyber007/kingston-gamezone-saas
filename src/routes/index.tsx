import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useUserAccess } from "@/lib/session";
import "@/views/theme.css";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kingston GameZone — Outil de gestion interne" },
      { name: "description", content: "Outil de gestion interne pour salles gaming : caisse, tickets, sessions, statistiques et fidélité. Multi-salles, RBAC, offline-first." },
      { property: "og:title", content: "Kingston GameZone — Outil de gestion interne" },
      { property: "og:description", content: "La caisse et le CRM des salles de gaming d'Afrique." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // RT.H.8 — la garde anti-boucle de redirection est ici.
  // Avant ce hook, useEffect redirigeait après render ET relisait roles via
  // useUserAccess, ce qui createsait une fenêtre transitoire avec
  // isPlatformAdmin=false → redirect depuis /platform → loop. En beforeLoad,
  // la décision est prise avant tout render. Un seul aller-retour.
  beforeLoad: async () => {
    // Pas de context parent : `/` est à la racine.
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return {}; // Non logué → landing normale.

    const { data: roles, error: rolesError } = await supabase
      .from("user_tenant_roles")
      .select("tenant_id, role")
      .eq("user_id", data.user.id);

    if (rolesError) return {}; // Erreur DB → landing + warning.

    const list = roles ?? [];
    const isPlatformAdmin = list.some((r) => r.role === "platform_admin");
    const isClient = list.some((r) => r.role === "client");
    const staffTenantId = list.find((r) => r.role === "staff" || r.role === "lounge_admin")?.tenant_id ?? null;

    // Ordre de priorité : admin > staff/lounge > client > landing.
    if (isPlatformAdmin) throw redirect({ to: "/platform" });
    if (staffTenantId) throw redirect({ to: "/app/salle" });
    if (isClient) throw redirect({ to: "/client" });

    return {}; // Logué sans rôle → landing + section warning.
  },
  component: Landing,
});

/**
 * Landing — Kingston GameZone (RT.B.10b + RT.B.10c polish)
 *
 * Structure sémantique :
 *  - <header role="banner">      — barre de marque + nav signée
 *  - <main>                      — contenu
 *      - <section> hero          — titre, baseline, CTA primaire/secondaire
 *      - <section> features      — 6 cartes capacités (emoji + titre + body)
 *      - <section> how-it-works  — 3 étapes (Mise en route / Au quotidien / Pilotage)
 *      - <section> warning       — affiché seulement si compte sans rôle
 *  - <footer role="contentinfo"> — liens + signature
 *
 * Classes KG consommées (définies dans src/views/theme.css, RT.B.10c) :
 *   .kg-cta-primary, .kg-cta-ghost, .kg-nav-link, .kg-nav-link-primary,
 *   .kg-landing-feature-card, .kg-landing-step, .kg-landing-warning
 *
 * L'auto-routing signed-in reste identique : plateforme > salle > client > landing.
 */
function Landing() {
  const { user } = useSession();
  const { staffTenants, isPlatformAdmin, isClient } = useUserAccess(user);

  return (
    <div className="kg-landing min-h-screen w-full overflow-x-hidden kg-landing-bg">
      {/* ===== HEADER / NAV ===== */}
      <header role="banner" className="kg-landing-header">
        <Link to="/" aria-label="Kingston GameZone — Accueil" className="kg-landing-brand">
          <img
            src={logo}
            alt=""
            aria-hidden="true"
            className="kg-landing-brand-logo"
          />
          <span className="kg-landing-brand-text">
            KINGSTON <span className="kg-landing-brand-accent">GAMEZONE</span>
          </span>
        </Link>
        <nav aria-label="Navigation principale" className="kg-landing-nav">
          {user ? (
            <>
              {staffTenants.length > 0 && (
                <Link to="/app/salle" className="kg-nav-link">
                  Caisse
                </Link>
              )}
              {isClient && (
                <Link to="/client" className="kg-nav-link">
                  Mon espace
                </Link>
              )}
              {isPlatformAdmin && (
                <Link to="/platform" className="kg-nav-link">
                  Plateforme
                </Link>
              )}
            </>
          ) : (
            <Link to="/auth" className="kg-nav-link-primary">
              Connexion
            </Link>
          )}
        </nav>
      </header>

      <main className="kg-landing-main">
        {/* ===== HERO ===== */}
        <section aria-labelledby="kg-hero-title" className="kg-landing-hero">
          <span className="kg-landing-eyebrow">Kingston GameZone — outil de gestion interne</span>
          <h1 id="kg-hero-title" className="kg-landing-hero-title">
            La caisse gaming pour l&apos;Afrique
          </h1>
          <p className="kg-landing-hero-baseline">
            Une plateforme privée pour gérer vos postes, tickets, sessions et paiements
            Mobile Money — même hors connexion. Multi-salles, rôles fins, statistiques
            temps réel.
          </p>
          <div className="kg-landing-hero-ctas">
            <Link to="/auth" className="kg-cta-primary">
              Démarrer maintenant
            </Link>
            {user && staffTenants.length > 0 && (
              <Link to="/app/salle" className="kg-cta-ghost">
                Ouvrir la caisse
              </Link>
            )}
          </div>
        </section>

        {/* ===== FEATURES ===== */}
        <section aria-labelledby="kg-features-title" className="kg-landing-section">
          <h2 id="kg-features-title" className="kg-landing-section-title">
            Tout ce qu&apos;il faut pour piloter une salle
          </h2>
          <div className="kg-landing-grid">
            {[
              { icon: "🎮", title: "Sessions & postes", body: "Suivi temps réel, alertes sonores et vocales, pause/reprise." },
              { icon: "🎫", title: "Tickets & fidélité", body: "QR codes, scanner caméra, temps sauvegardé, points de fidélité." },
              { icon: "💳", title: "Mobile Money", body: "Airtel Money, MTN, cash — reconciliations et stats par mode." },
              { icon: "📊", title: "Statistiques", body: "Revenu jour / semaine / mois, top postes, top clients, exports." },
              { icon: "🌐", title: "Offline-first", body: "L'app tourne sans internet ; sync automatique dès la reconnexion." },
              { icon: "🏢", title: "Multi-salles", body: "Architecture pensée pour un parc de salles (back-office unifié)." },
            ].map((c) => (
              <article key={c.title} className="kg-landing-feature-card">
                <div aria-hidden="true" className="kg-landing-feature-icon">
                  {c.icon}
                </div>
                <h3 className="kg-landing-feature-title">{c.title}</h3>
                <p className="kg-landing-feature-body">{c.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ===== HOW IT WORKS ===== */}
        <section aria-labelledby="kg-howto-title" className="kg-landing-section">
          <h2 id="kg-howto-title" className="kg-landing-section-title">
            Comment ça marche
          </h2>
          <ol className="kg-landing-grid kg-landing-steps">
            {[
              { n: 1, title: "Pour le gérant de salle", body: "Le gérant de salle configure ses postes, ses tarifs et ses modes de paiement depuis le back-office." },
              { n: 2, title: "Au quotidien", body: "Lancez les sessions, encaissez Mobile Money, scannez les tickets — l'app tourne même sans réseau." },
              { n: 3, title: "Pilotage", body: "Suivez vos revenus, vos meilleurs clients et vos heures de pointe depuis n'importe où." },
            ].map((s) => (
              <li key={s.n} className="kg-landing-step">
                <span aria-hidden="true" className="kg-landing-step-number">
                  {s.n}
                </span>
                <h3 className="kg-landing-step-title">{s.title}</h3>
                <p className="kg-landing-step-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ===== NO-ROLE WARNING ===== */}
        {user && staffTenants.length === 0 && !isPlatformAdmin && !isClient && (
          <section aria-labelledby="kg-warning-title" className="kg-landing-warning">
            <h2 id="kg-warning-title" className="kg-landing-warning-title">
              Aucun rôle pour le moment
            </h2>
            <p className="kg-landing-warning-body">
              Votre compte n&apos;a pas encore de rôle. Contactez votre administrateur
              pour être ajouté à une salle.
            </p>
          </section>
        )}
      </main>

      {/* ===== FOOTER ===== */}
      <footer role="contentinfo" className="kg-landing-footer">
        <div className="kg-landing-footer-brand">
          KINGSTON <span className="kg-landing-brand-accent">GAMEZONE</span>
        </div>
        <div className="kg-landing-footer-meta">
          Pointe-Noire · Congo · Caisse gaming pour l&apos;Afrique
        </div>
      </footer>
    </div>
  );
}