import { createFileRoute, Outlet, useNavigate, useLocation, Link, redirect } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import "@/views/theme.css";
import { useStore } from "@/store/useStore";
import { showToast } from "@/views/components/Toast";
import { PowerCutOverlay } from "@/views/components/PowerCutOverlay";
import { useT, useI18n, LOCALES } from "@/i18n";
import { fmtMoney, todayKey } from "@/lib-app/helpers";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useUserAccess, getActiveTenantId, setActiveTenantId } from "@/lib/session";
import logo from "@/assets/logo.png";

export const Route = createFileRoute("/_authenticated/app")({
  // RT.P.0-ppfix — garde anti-boucle de redirection, dans le même esprit que
  // RT.H.8 sur /platform. Avant ce hook, le `useEffect` ligne ~35 vérifiait
  // `staffTenants.length === 0 && !isPlatformAdmin` APRÈS render, ce qui créait
  // une fenêtre transitoire où la coquille /app/* était montée avec un store
  // Zustand vide avant que le navigate ne se déclenche. Si l'utilisateur
  // naviguait à nouveau pendant cette fenêtre (clic rapide, back-button), on
  // pouvait boucler /app/* → / → /app/* avant que les rôles Supabase ne soient
  // résolus.
  //
  // En beforeLoad, on interroge Supabase une seule fois, AVANT tout render,
  // et on throw redirect si l'utilisateur n'a pas accès à /app/*. Un seul
  // aller-retour, pas de fenêtre transitoire.
  //
  // Note : ce hook ne dédouane pas du useEffect existant (qui re-vérifie en
  // runtime pour gérer le cas où staffTenants devient vide APRÈS mount — par
  // exemple révocation live d'un rôle par un platform_admin). Les deux se
  // complètent : beforeLoad ferme le trou ping-pong initial, useEffect ferme
  // le trou révocation live.
  beforeLoad: async ({ context }) => {
    const user = context.user as { id: string } | undefined;
    if (!user) throw redirect({ to: "/auth" });

    const { data: roles, error } = await supabase
      .from("user_tenant_roles")
      .select("role")
      .eq("user_id", user.id);

    // Fail-closed : on n'affiche pas l'app si on ne peut pas vérifier.
    if (error) throw redirect({ to: "/" });

    const list = roles ?? [];
    const isPlatformAdmin = list.some((r) => r.role === "platform_admin");
    const isStaffOrLounge = list.some(
      (r) => r.role === "staff" || r.role === "lounge_admin",
    );

    // Ni staff/lounge ni platform_admin → pas d'accès à /app/*.
    // (Un platform_admin sans tenant assigné peut quand même naviguer
    // librement, c'est une décision : on lui laisse l'accès pour qu'il puisse
    // tester l'expérience staff. S'il n'a aucun tenant, il verra l'écran
    // vide géré par le useEffect runtime.)
    if (!isStaffOrLounge) throw redirect({ to: "/" });

    return { isPlatformAdmin, isStaffOrLounge };
  },
  component: AppShell,
});

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useSession();
  const { staffTenants, isPlatformAdmin, loading: accessLoading } = useUserAccess(user);
  const { sessions, postes, settings, updateSettings } = useStore();
  const t = useT();
  const { locale, setLocale } = useI18n();

  const activeTenant = useMemo(() => {
    const stored = getActiveTenantId();
    return staffTenants.find((tn) => tn.id === stored) ?? staffTenants[0] ?? null;
  }, [staffTenants]);

  useEffect(() => {
    if (activeTenant) setActiveTenantId(activeTenant.id);
  }, [activeTenant?.id]);

  // RT.P.0-ppfix — ce useEffect ne gère plus la garde anti-boucle (déplacée
  // en beforeLoad ci-dessus). Il reste pertinent uniquement pour le cas
  // runtime où staffTenants devient vide APRÈS mount (ex : révocation live
  // par un platform_admin via la UI). On garde un toast user-friendly.
  useEffect(() => {
    if (!accessLoading && staffTenants.length === 0 && !isPlatformAdmin) {
      showToast("Aucune salle assignée. Redirection…");
      navigate({ to: "/" });
    }
  }, [accessLoading, staffTenants.length, isPlatformAdmin, navigate]);

  // Realtime — écoute les changements caisse pour synchroniser plusieurs postes
  useEffect(() => {
    if (!activeTenant?.id) return;
    const channel = supabase
      .channel(`caisse-${activeTenant.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "sessions_caisse", filter: `tenant_id=eq.${activeTenant.id}` },
        (payload) => {
          const row = payload.new as { amount?: number; poste_name?: string };
          showToast(`💰 Nouvelle vente ${row.poste_name ?? ""} — ${fmtMoney(row.amount ?? 0)}`);
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "postes", filter: `tenant_id=eq.${activeTenant.id}` },
        () => { /* poste status changed elsewhere */ },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeTenant?.id]);

  const today = todayKey();
  const todaySessions = sessions.filter((s) => s.day === today);
  const revenue = todaySessions.reduce((sum, s) => sum + s.amount, 0);
  const busyCount = postes.filter((p) => p.status === "busy").length;

  const tabs: Array<[string, string]> = [
    ["/app/salle", t("nav_salle")],
    ["/app/caisse", t("nav_caisse")],
    ["/app/tickets", t("nav_tickets")],
    ["/app/stats", t("nav_stats")],
    ["/app/reglages", t("nav_reglages")],
  ];

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  function handleToggleSound() {
    updateSettings({ soundMuted: !settings.soundMuted });
    showToast(settings.soundMuted ? "🔊 Son activé" : "🔇 Son coupé");
  }

  return (
    <div className="kg-app">
      <div className="bg-particles" aria-hidden>
        {Array.from({ length: 12 }).map((_, i) => (
          <span
            key={i}
            className="bg-particle"
            style={{
              left: `${5 + i * 8}%`,
              animationDelay: `${i * 0.8}s`,
              animationDuration: `${8 + (i % 4) * 3}s`,
            }}
          >
            {["🎮", "⭐", "🏆", "⚡", "👾", "🎯", "💥", "🕹️"][i % 8]}
          </span>
        ))}
      </div>

      <header className="topbar">
        <div className="brand">
          <img src={logo} alt="Kingston GameZone" style={{ height: 44, objectFit: "contain" }} />
          <div className="brand-text">
            <strong>{activeTenant?.name ?? "Kingston GameZone"}</strong>
            <span>{user?.email ?? "—"}</span>
          </div>
        </div>

        <nav className="nav-tabs">
          {tabs.map(([to, label]) => {
            const active = location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`nav-tab ${active ? "active" : ""}`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="topbar-right">
          <div className="ts-pill">
            <span className="v">{busyCount}/{postes.length}</span>
            <span className="l">actifs</span>
          </div>
          <div className="ts-pill">
            <span className="v">{fmtMoney(revenue)}</span>
            <span className="l">aujourd'hui</span>
          </div>
          {staffTenants.length > 1 && (
            <select
              className="lang-select"
              value={activeTenant?.id ?? ""}
              onChange={(e) => {
                setActiveTenantId(e.target.value);
                window.location.reload();
              }}
              title="Salle active"
            >
              {staffTenants.map((tn) => (
                <option key={tn.id} value={tn.id}>{tn.name}</option>
              ))}
            </select>
          )}
          <button
            className="icon-btn"
            onClick={handleToggleSound}
            title={settings.soundMuted ? "Activer le son" : "Couper le son"}
          >
            {settings.soundMuted ? "🔇" : "🔊"}
          </button>
          <select
            className="lang-select"
            value={locale}
            onChange={(e) => setLocale(e.target.value as any)}
            aria-label="Langue"
          >
            {LOCALES.map((l) => (
              <option key={l.value} value={l.value}>{l.flag} {l.label}</option>
            ))}
          </select>
          <button className="lock-btn" onClick={handleSignOut} title="Déconnexion">
            Déconnexion
          </button>
        </div>
      </header>

      <main className="container">
        <Outlet />
      </main>

      <footer className="kg-footer">
        Kingston GameZone · SaaS Multi-salles · Données synchronisées via Supabase
      </footer>

      <PowerCutOverlay />
      {/* RT.T.0 — ToastContainer retiré (monté globalement dans __root.tsx) */}
    </div>
  );
}
