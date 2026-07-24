import { createFileRoute, Outlet, useNavigate, useLocation, Link } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import "@/kingston/kingston.css";
import { useStore } from "@/kingston/store/useStore";
import { ToastContainer, showToast } from "@/kingston/components/Toast";
import { useT, useI18n, LOCALES } from "@/kingston/i18n";
import { fmtMoney, todayKey } from "@/kingston/lib/helpers";
import { supabase } from "@/integrations/supabase/client";
import { useSession, useUserAccess, getActiveTenantId, setActiveTenantId } from "@/lib/session";
import logoAsset from "@/assets/kingston-logo.png.asset.json";

export const Route = createFileRoute("/_authenticated/app")({
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

  useEffect(() => {
    if (!accessLoading && staffTenants.length === 0 && !isPlatformAdmin) {
      showToast("Aucune salle assignée. Redirection…");
      navigate({ to: "/" });
    }
  }, [accessLoading, staffTenants.length, isPlatformAdmin, navigate]);

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
          <img src={logoAsset.url} alt="Kingston GameZone" style={{ height: 44, objectFit: "contain" }} />
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
        Kingston GameZone · SaaS Multi-salles · Données synchronisées via Lovable Cloud
      </footer>

      <ToastContainer />
    </div>
  );
}
