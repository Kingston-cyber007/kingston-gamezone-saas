import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/views/components/Toast";
import { ConfirmModal } from "@/views/components/ConfirmModal";
import { TenantUsersModal } from "@/views/components/TenantUsersModal";
import { todayKey, fmtMoney } from "@/lib-app/helpers";
import type { AppRole } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/platform/")({
  component: PlatformDashboard,
});

/** RT.B V1 — étendu aux 10 colonnes réelles de `public.tenants` (avant : 7).
 *  `logo_url`, `country`, `updated_at` ajoutés pour exploiter la table complète
 *  dans l'UI édition + KPI. */
interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  billing_status: string;
  logo_url: string | null;
  city: string | null;
  country: string | null;
  created_at: string;
  updated_at: string;
}

interface Invitation {
  id: string;
  tenant_id: string;
  email: string;
  role: AppRole;
  token: string;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

interface PlatformAdmin {
  email: string;
  created_at: string;
  notes: string | null;
}

/** RT.P.0c' — KPI revenu plateforme. On ne charge QUE les colonnes utiles
 *  (`amount`, `tenant_id`) et on filtre côté SQL par `day = today` (cf.
 *  migration 20260723171443 : `day date NOT NULL DEFAULT CURRENT_DATE`).
 *  La RLS `sessions_caisse SELECT` via `has_tenant_access(auth.uid(), tenant_id)`
 *  autorise actuellement le platform_admin à tout lire (cf. dette #5 dans
 *  dette-technique.md — retrait de cet accès à arbitrer en phase C). */
interface SessionRow {
  amount: number;
  tenant_id: string;
}

/** RT.P.0-tenantcfg — Réglages par salle (résolution dette #24).
 *  Type aligné sur `public.tenant_settings` (migration 20260723171443 L201-209).
 *  `prices` est un jsonb `{ "30": 500, "60": 900, ... }` — on le manipule via
 *  Record<number, number> côté UI. */
interface TenantSettings {
  tenant_id: string;
  poste_count: number;
  warn_minutes: number;
  prices: Record<string, number>;
  custom_price_per_minute: number;
  price_drink: number;
  updated_at: string;
}

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "lounge_admin", label: "Admin de salle" },
  { value: "staff", label: "Staff / Caissier" },
  { value: "client", label: "Client" },
];

/**
 * Dashboard plateforme — Kingston GameZone (RT.B.14).
 *
 * Sections :
 *  - Créer une salle (formulaire)
 *  - Salles (table)
 *  - Inviter un utilisateur (formulaire + liste invitations)
 *  - Administrateurs plateforme (5B.3 — carte qui était documentée comme
 *    « appliquée » dans le journal du 26/07 alors qu'elle ne l'avait jamais
 *    été ; ce code applique réellement la fonctionnalité).
 *
 * Logique métier inchangée ; refonte visuelle via classes KG.
 */
function PlatformDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [admins, setAdmins] = useState<PlatformAdmin[]>([]);
  const [todaySessions, setTodaySessions] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  // RT.P.0-tenantcfg — édition des réglages par salle.
  // On garde le `cfgTenantId` (salle sélectionnée) et `cfgDraft` (formulaire
  // local, non persisté tant que l'utilisateur n'a pas cliqué "Enregistrer").
  const [cfgTenantId, setCfgTenantId] = useState<string>("");
  const [cfgDraft, setCfgDraft] = useState<TenantSettings | null>(null);
  const [cfgLoading, setCfgLoading] = useState(false);
  const [cfgInfo, setCfgInfo] = useState<string | null>(null);

  // Invitation form
  const [invTenant, setInvTenant] = useState<string>("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<AppRole>("staff");
  const [invInfo, setInvInfo] = useState<string | null>(null);

  // Admin form (5B.3)
  const [adminEmail, setAdminEmail] = useState("");
  const [adminNotes, setAdminNotes] = useState("");
  const [adminInfo, setAdminInfo] = useState<string | null>(null);

  // RT.B V1 — édition salle + recherche mémoïsée
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Tenant | null>(null);

  // RT.B V2 — suspension/réactivation via ConfirmModal réutilisable
  const [suspendTarget, setSuspendTarget] = useState<Tenant | null>(null);

  // RT.B V3 — modale liste des utilisateurs d'une salle
  const [usersModalTenant, setUsersModalTenant] = useState<{ id: string; name: string } | null>(
    null,
  );

  // RT.B V3 — KPI Vue d'ensemble (recalculés à chaque render)
  const activeTenants = useMemo(
    () => tenants.filter((t) => t.status === "active").length,
    [tenants],
  );
  const trialTenants = useMemo(
    () => tenants.filter((t) => t.billing_status === "trial").length,
    [tenants],
  );
  const pendingInvitations = useMemo(
    () => invitations.filter((i) => !i.accepted_at && new Date(i.expires_at) > new Date()).length,
    [invitations],
  );
  // RT.P.0c' — Revenu plateforme cumulé sur la journée en cours.
  // Addition simple côté client (charge déjà bornée par le filtre SQL `day = today`).
  const totalRevenueToday = useMemo(
    () => todaySessions.reduce((sum, s) => sum + (s.amount ?? 0), 0),
    [todaySessions],
  );

  const filteredTenants = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.slug.toLowerCase().includes(q) ||
        (t.city ?? "").toLowerCase().includes(q),
    );
  }, [tenants, search]);

  // RT.B V2 — état pour ConfirmModal sur révocation invitation + retrait admin
  const [revokeInviteId, setRevokeInviteId] = useState<string | null>(null);
  const [removeAdminEmail, setRemoveAdminEmail] = useState<string | null>(null);

  async function refresh() {
    const today = todayKey();
    const [tRes, iRes, aRes, sRes] = await Promise.all([
      supabase.from("tenants").select("*").order("created_at", { ascending: false }),
      supabase.from("tenant_invitations").select("*").order("created_at", { ascending: false }),
      supabase.from("platform_admins").select("*").order("created_at", { ascending: false }),
      // RT.P.0c' — revenu plateforme du jour : on récupère uniquement les colonnes
      // utiles (amount, tenant_id) pour minimiser le payload, et on filtre côté SQL
      // par `day = todayKey()` (index implicite sur `day` + `tenant_id` déjà utilisé
      // par la realtime channel de `_authenticated/app/route.tsx`).
      supabase
        .from("sessions_caisse")
        .select("amount, tenant_id")
        .eq("day", today),
    ]);
    if (tRes.error) setError(tRes.error.message);
    setTenants((tRes.data ?? []) as Tenant[]);
    setInvitations((iRes.data ?? []) as Invitation[]);
    setAdmins((aRes.data ?? []) as PlatformAdmin[]);
    setTodaySessions((sRes.data ?? []) as SessionRow[]);
    setLoading(false);
  }
  useEffect(() => {
    refresh();
  }, []);

  // RT.P.0-tenantcfg — auto-charge la config quand on change de salle
  useEffect(() => {
    if (cfgTenantId) loadTenantSettings(cfgTenantId);
  }, [cfgTenantId]);

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("tenants").insert({ name: newName, slug: newSlug });
    if (error) {
      setError(error.message);
      showToast("Erreur : " + error.message, "❌", "var(--red)");
      return;
    }
    setNewName("");
    setNewSlug("");
    showToast(`Salle « ${newName || "?"} » créée`, "✅");
    refresh();
  }

  /** RT.B V1 — sauvegarde de l'édition inline (modale). Met à jour name,
   *  slug, city, billing_status. Le `status` reste read-only ici (modifié via
   *  V2 — suspension/réactivation). */
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { error } = await supabase
      .from("tenants")
      .update({
        name: editing.name,
        slug: editing.slug,
        city: editing.city,
        billing_status: editing.billing_status,
      })
      .eq("id", editing.id);
    if (error) {
      showToast("Erreur : " + error.message, "❌", "var(--red)");
      return;
    }
    showToast(`Salle « ${editing.name} » mise à jour`, "✅");
    setEditing(null);
    refresh();
  }

  /** RT.B V2 — bascule du statut actif/suspendu. Appelé après confirmation via
   *  ConfirmModal. La policy RLS `tenants FOR UPDATE` côté platform_admin est
   *  déjà active, donc pas de 403 attendu. */
  async function toggleSuspend(t: Tenant) {
    const next: Tenant["status"] = t.status === "active" ? "suspended" : "active";
    const { error } = await supabase.from("tenants").update({ status: next }).eq("id", t.id);
    if (error) {
      showToast("Erreur : " + error.message, "❌", "var(--red)");
      return;
    }
    showToast(
      next === "suspended" ? `Salle « ${t.name} » suspendue` : `Salle « ${t.name} » réactivée`,
      next === "suspended" ? "⏸️" : "▶️",
    );
    setSuspendTarget(null);
    refresh();
  }

  async function sendInvitation(e: React.FormEvent) {
    e.preventDefault();
    setInvInfo(null);
    if (!invTenant) {
      setInvInfo("Choisissez une salle.");
      return;
    }
    const { error } = await supabase.from("tenant_invitations").insert({
      tenant_id: invTenant,
      email: invEmail.trim().toLowerCase(),
      role: invRole,
    });
    if (error) {
      setInvInfo("Erreur : " + error.message);
      return;
    }
    setInvEmail("");
    setInvInfo("Invitation créée. Partagez le lien ci-dessous à l'invité.");
    refresh();
  }

  async function revokeInvitation(id: string) {
    // RT.B V2 — confirmation via ConfirmModal KG (avant : window.confirm natif)
    setRevokeInviteId(id);
  }

  async function confirmRevokeInvitation() {
    if (!revokeInviteId) return;
    await supabase.from("tenant_invitations").delete().eq("id", revokeInviteId);
    setRevokeInviteId(null);
    showToast("Invitation révoquée", "🗑️");
    refresh();
  }

  async function addAdmin(e: React.FormEvent) {
    e.preventDefault();
    setAdminInfo(null);
    const email = adminEmail.trim().toLowerCase();
    if (!email) {
      setAdminInfo("Email requis.");
      return;
    }
    const { error } = await supabase.from("platform_admins").insert({
      email,
      notes: adminNotes.trim() || null,
    });
    if (error) {
      setAdminInfo("Erreur : " + error.message);
      return;
    }
    setAdminEmail("");
    setAdminNotes("");
    setAdminInfo("Administrateur plateforme ajouté.");
    refresh();
  }

  async function removeAdmin(email: string) {
    // RT.B V2 — confirmation via ConfirmModal KG (avant : window.confirm natif)
    setRemoveAdminEmail(email);
  }

  async function confirmRemoveAdmin() {
    if (!removeAdminEmail) return;
    await supabase.from("platform_admins").delete().eq("email", removeAdminEmail);
    setRemoveAdminEmail(null);
    showToast(`Administrateur ${removeAdminEmail} retiré`, "🗑️");
    refresh();
  }

  // RT.P.0-tenantcfg — charger les réglages d'une salle. Si la ligne
  // n'existe pas (nouveau tenant), on retourne un DEFAULT_SETTINGS dérivé
  // de la table `tenant_settings` (migration 20260723171443 L203-208).
  async function loadTenantSettings(tenantId: string) {
    if (!tenantId) {
      setCfgDraft(null);
      return;
    }
    setCfgLoading(true);
    setCfgInfo(null);
    const { data, error } = await supabase
      .from("tenant_settings")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) {
      showToast("Erreur chargement réglages : " + error.message, "❌", "var(--red)");
      setCfgDraft(null);
      setCfgLoading(false);
      return;
    }
    if (data) {
      setCfgDraft({
        tenant_id: data.tenant_id,
        poste_count: data.poste_count,
        warn_minutes: data.warn_minutes,
        prices: (data.prices as Record<string, number>) ?? { "30": 500, "60": 900, "90": 1300, "120": 1600 },
        custom_price_per_minute: data.custom_price_per_minute,
        price_drink: data.price_drink,
        updated_at: data.updated_at,
      });
    } else {
      // Pas encore de ligne → on propose le DEFAULT pour cette salle
      setCfgDraft({
        tenant_id: tenantId,
        poste_count: 5,
        warn_minutes: 5,
        prices: { "30": 500, "60": 900, "90": 1300, "120": 1600 },
        custom_price_per_minute: 15,
        price_drink: 200,
        updated_at: new Date().toISOString(),
      });
      setCfgInfo("Aucun réglage enregistré pour cette salle — valeurs par défaut affichées.");
    }
    setCfgLoading(false);
  }

  // RT.P.0-tenantcfg — sauvegarde via UPSERT (la ligne peut ne pas exister).
  // La RLS `tenant_settings FOR ALL` autorise platform_admin (migration L214-216).
  async function saveTenantSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!cfgDraft) return;
    setCfgLoading(true);
    const { error } = await supabase
      .from("tenant_settings")
      .upsert({
        tenant_id: cfgDraft.tenant_id,
        poste_count: cfgDraft.poste_count,
        warn_minutes: cfgDraft.warn_minutes,
        prices: cfgDraft.prices,
        custom_price_per_minute: cfgDraft.custom_price_per_minute,
        price_drink: cfgDraft.price_drink,
        updated_at: new Date().toISOString(),
      });
    setCfgLoading(false);
    if (error) {
      showToast("Erreur : " + error.message, "❌", "var(--red)");
      return;
    }
    showToast(`Réglages de la salle enregistrés`, "💾");
    setCfgInfo("Enregistré à l'instant.");
  }

  function inviteLink(token: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/auth?invite=${token}`;
  }

  return (
    <div className="kg-platform-dashboard">
      {/* ===== RT.B V3 — VUE D'ENSEMBLE (KPI) ===== */}
      <section className="kg-platform-card" aria-labelledby="kg-platform-card-overview">
        <h2 id="kg-platform-card-overview" className="kg-platform-card-title">
          Vue d&apos;ensemble
        </h2>
        <div className="kg-platform-kpi-grid">
          <div className="kg-platform-kpi-tile">
            <span className="kg-platform-kpi-icon" aria-hidden="true">
              🏢
            </span>
            <div>
              <div className="kg-platform-kpi-value">{activeTenants}</div>
              <div className="kg-platform-kpi-label">Salles actives</div>
            </div>
          </div>
          <div className="kg-platform-kpi-tile">
            <span className="kg-platform-kpi-icon" aria-hidden="true">
              ⏳
            </span>
            <div>
              <div className="kg-platform-kpi-value">{trialTenants}</div>
              <div className="kg-platform-kpi-label">En période d&apos;essai</div>
            </div>
          </div>
          <div className="kg-platform-kpi-tile">
            <span className="kg-platform-kpi-icon" aria-hidden="true">
              ✉️
            </span>
            <div>
              <div className="kg-platform-kpi-value">{pendingInvitations}</div>
              <div className="kg-platform-kpi-label">Invitations en attente</div>
            </div>
          </div>
          <div className="kg-platform-kpi-tile">
            <span className="kg-platform-kpi-icon" aria-hidden="true">
              🛡️
            </span>
            <div>
              <div className="kg-platform-kpi-value">{admins.length}</div>
              <div className="kg-platform-kpi-label">Admins plateforme</div>
            </div>
          </div>
          {/* RT.P.0c' — Revenu plateforme cumulé sur la journée. 5e tuile pour
              fermer la grille (4 → 5). Label en deux lignes pour rester compact. */}
          <div className="kg-platform-kpi-tile">
            <span className="kg-platform-kpi-icon" aria-hidden="true">
              💰
            </span>
            <div>
              <div className="kg-platform-kpi-value">{fmtMoney(totalRevenueToday)}</div>
              <div className="kg-platform-kpi-label">Recette plateforme (aujourd&apos;hui)</div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== CRÉER UNE SALLE ===== */}
      <section className="kg-platform-card" aria-labelledby="kg-platform-card-tenant">
        <h2 id="kg-platform-card-tenant" className="kg-platform-card-title">
          Créer une salle
        </h2>
        <form onSubmit={createTenant} className="kg-platform-form-row">
          <input
            required
            placeholder="Nom"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="kg-platform-input"
          />
          <input
            required
            placeholder="slug-unique"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            className="kg-platform-input kg-platform-input--mono"
          />
          <button type="submit" className="kg-platform-button">
            Créer
          </button>
        </form>
        {error && (
          <div className="kg-platform-error" role="alert">
            {error}
          </div>
        )}
      </section>

      {/* ===== LISTE SALLES ===== */}
      <section className="kg-platform-card" aria-labelledby="kg-platform-card-tenants">
        <h2 id="kg-platform-card-tenants" className="kg-platform-card-title">
          Salles ({tenants.length})
        </h2>
        {loading ? (
          <p className="kg-platform-loading">Chargement…</p>
        ) : (
          <>
            {/* RT.B V1 — recherche mémoïsée sur name / slug / city */}
            <input
              type="search"
              placeholder="Rechercher (nom, slug, ville)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="kg-platform-search-input"
              aria-label="Filtrer les salles"
            />
            <div className="kg-platform-table-wrap">
              <table className="kg-platform-table">
                <thead>
                  <tr>
                    <th>Nom</th>
                    <th>Slug</th>
                    <th>Ville</th>
                    <th>Statut</th>
                    <th>Facturation</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.name}</td>
                      <td className="mono">{t.slug}</td>
                      <td style={{ color: "var(--text2)" }}>{t.city ?? "—"}</td>
                      <td>
                        <span
                          className={
                            t.status === "active"
                              ? "kg-platform-badge kg-platform-badge--active"
                              : "kg-platform-badge kg-platform-badge--danger"
                          }
                        >
                          {t.status}
                        </span>
                      </td>
                      <td>
                        <span className="kg-platform-badge kg-platform-badge--info">
                          {t.billing_status}
                        </span>
                      </td>
                      <td>
                        {/* RT.B V1+V2 — Modifier (édition V1) + Suspendre/Réactiver (V2). */}
                        <div className="kg-platform-actions-cell">
                          <button
                            type="button"
                            onClick={() => setEditing(t)}
                            className="kg-platform-button kg-platform-button--ghost kg-platform-button--small"
                            aria-label={`Modifier ${t.name}`}
                          >
                            Modifier
                          </button>
                          <button
                            type="button"
                            onClick={() => setSuspendTarget(t)}
                            className={
                              t.status === "active"
                                ? "kg-platform-button kg-platform-button--danger kg-platform-button--small"
                                : "kg-platform-button kg-platform-button--small"
                            }
                            aria-label={
                              t.status === "active" ? `Suspendre ${t.name}` : `Réactiver ${t.name}`
                            }
                          >
                            {t.status === "active" ? "Suspendre" : "Réactiver"}
                          </button>
                          {/* RT.B V3 — liste des utilisateurs effectifs d'une salle */}
                          <button
                            type="button"
                            onClick={() => setUsersModalTenant({ id: t.id, name: t.name })}
                            className="kg-platform-button kg-platform-button--ghost kg-platform-button--small"
                            aria-label={`Voir les utilisateurs de ${t.name}`}
                          >
                            Utilisateurs
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredTenants.length === 0 && (
                    <tr>
                      <td colSpan={6} className="kg-platform-empty">
                        Aucune salle ne correspond à « {search} ».
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ===== INVITATIONS ===== */}
      <section className="kg-platform-card" aria-labelledby="kg-platform-card-invitations">
        <h2 id="kg-platform-card-invitations" className="kg-platform-card-title">
          Inviter un utilisateur
        </h2>
        <form onSubmit={sendInvitation} className="kg-platform-form-row">
          <select
            required
            value={invTenant}
            onChange={(e) => setInvTenant(e.target.value)}
            className="kg-platform-select"
            aria-label="Salle cible"
          >
            <option value="">— Salle —</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <input
            required
            type="email"
            placeholder="email@exemple.com"
            value={invEmail}
            onChange={(e) => setInvEmail(e.target.value)}
            className="kg-platform-input"
          />
          <select
            value={invRole}
            onChange={(e) => setInvRole(e.target.value as AppRole)}
            className="kg-platform-select"
            aria-label="Rôle"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button type="submit" className="kg-platform-button">
            Inviter
          </button>
        </form>
        {invInfo && <div className="kg-platform-info">{invInfo}</div>}

        <h3 className="kg-platform-section-subtitle">Invitations ({invitations.length})</h3>
        {invitations.length === 0 ? (
          <p className="kg-platform-empty">Aucune invitation.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {invitations.map((inv) => {
              const tenant = tenants.find((t) => t.id === inv.tenant_id);
              const link = inviteLink(inv.token);
              const status = inv.accepted_at
                ? "acceptée"
                : new Date(inv.expires_at) < new Date()
                  ? "expirée"
                  : "en attente";
              return (
                <div key={inv.id} className="kg-platform-invitation">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="kg-platform-invitation-email">{inv.email}</div>
                    <div className="kg-platform-invitation-meta">
                      {tenant?.name ?? "—"} · {inv.role} · {status}
                    </div>
                    {!inv.accepted_at && <div className="kg-platform-invitation-link">{link}</div>}
                  </div>
                  {!inv.accepted_at && (
                    <>
                      <button
                        type="button"
                        onClick={() => navigator.clipboard.writeText(link)}
                        className="kg-platform-button kg-platform-button--ghost kg-platform-button--small"
                      >
                        Copier le lien
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvitation(inv.id)}
                        className="kg-platform-button kg-platform-button--danger kg-platform-button--small"
                      >
                        Révoquer
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ===== 5B.3 — ADMINISTRATEURS PLATEFORME ===== */}
      <section className="kg-platform-card" aria-labelledby="kg-platform-card-admins">
        <h2 id="kg-platform-card-admins" className="kg-platform-card-title">
          Administrateurs plateforme ({admins.length})
        </h2>
        <p className="kg-platform-loading" style={{ marginTop: 0, marginBottom: 16 }}>
          Liste des emails ayant accès à <code>public.platform_admins</code>. Étape 5B.3 —
          dépendance ouverte depuis 5A.1, résolue ici.
        </p>
        <form onSubmit={addAdmin} className="kg-platform-form-row">
          <input
            required
            type="email"
            placeholder="email@exemple.com"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            className="kg-platform-input"
            aria-label="Email du nouvel admin"
          />
          <input
            placeholder="Notes (optionnel)"
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            className="kg-platform-input"
            aria-label="Notes"
          />
          <button type="submit" className="kg-platform-button">
            Ajouter
          </button>
        </form>
        {adminInfo && <div className="kg-platform-info">{adminInfo}</div>}

        <h3 className="kg-platform-section-subtitle">Admins actifs</h3>
        {admins.length === 0 ? (
          <p className="kg-platform-empty">Aucun administrateur plateforme.</p>
        ) : (
          <div className="kg-platform-table-wrap">
            <table className="kg-platform-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Notes</th>
                  <th>Créé le</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.email}>
                    <td className="mono">{a.email}</td>
                    <td style={{ color: "var(--text2)" }}>{a.notes ?? "—"}</td>
                    <td style={{ color: "var(--text2)" }}>
                      {new Date(a.created_at).toLocaleDateString("fr-FR")}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => removeAdmin(a.email)}
                        className="kg-platform-button kg-platform-button--danger kg-platform-button--small"
                        aria-label={`Retirer ${a.email} des administrateurs`}
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===== RT.B V1 — MODALE D'ÉDITION INLINE =====
          Pour cette vague on inline la modale (pas de composant séparé). Elle
          sera extraite ou remplacée par ConfirmModal en V2 si nécessaire. */}
      {editing && (
        <div
          className="kg-platform-modal-overlay"
          onClick={(e) => {
            // Click overlay = annuler
            if (e.target === e.currentTarget) setEditing(null);
          }}
          role="presentation"
        >
          <div
            className="kg-platform-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kg-platform-modal-edit-title"
          >
            <h3 id="kg-platform-modal-edit-title" className="kg-platform-modal-title">
              Modifier la salle
            </h3>
            <form onSubmit={saveEdit} className="kg-platform-form">
              <label className="kg-platform-form-field">
                <span>Nom</span>
                <input
                  required
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="kg-platform-input"
                />
              </label>
              <label className="kg-platform-form-field">
                <span>Slug</span>
                <input
                  required
                  value={editing.slug}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                    })
                  }
                  className="kg-platform-input kg-platform-input--mono"
                />
              </label>
              <label className="kg-platform-form-field">
                <span>Ville</span>
                <input
                  value={editing.city ?? ""}
                  onChange={(e) => setEditing({ ...editing, city: e.target.value || null })}
                  className="kg-platform-input"
                />
              </label>
              <label className="kg-platform-form-field">
                <span>Facturation</span>
                <select
                  value={editing.billing_status}
                  onChange={(e) => setEditing({ ...editing, billing_status: e.target.value })}
                  className="kg-platform-select"
                >
                  <option value="trial">trial</option>
                  <option value="active">active</option>
                  <option value="paused">paused</option>
                  <option value="cancelled">cancelled</option>
                </select>
              </label>
              <div className="kg-platform-modal-status">
                Statut : <strong>{editing.status}</strong>{" "}
                <span style={{ color: "var(--text2)" }}>
                  (modifié via Suspendre/Réactiver — V2)
                </span>
              </div>
              <div className="kg-platform-modal-actions">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="kg-platform-button kg-platform-button--ghost"
                >
                  Annuler
                </button>
                <button type="submit" className="kg-platform-button">
                  Enregistrer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===== RT.B V3 — Modale liste utilisateurs ===== */}
      <TenantUsersModal
        open={usersModalTenant !== null}
        tenant={usersModalTenant}
        onClose={() => setUsersModalTenant(null)}
      />

      {/* ===== RT.B V2 — ConfirmModal réutilisable (3 usages) ===== */}
      <ConfirmModal
        open={suspendTarget !== null}
        title={
          suspendTarget?.status === "active"
            ? `Suspendre « ${suspendTarget?.name ?? ""} » ?`
            : `Réactiver « ${suspendTarget?.name ?? ""} » ?`
        }
        body={
          suspendTarget?.status === "active"
            ? "Les utilisateurs de cette salle ne pourront plus s'y connecter tant que la suspension est active. Les données ne sont pas supprimées."
            : "Les utilisateurs pourront à nouveau se connecter à cette salle."
        }
        confirmLabel={suspendTarget?.status === "active" ? "Suspendre" : "Réactiver"}
        danger={suspendTarget?.status === "active"}
        onConfirm={() => suspendTarget && toggleSuspend(suspendTarget)}
        onCancel={() => setSuspendTarget(null)}
      />

      <ConfirmModal
        open={revokeInviteId !== null}
        title="Révoquer cette invitation ?"
        body="Le lien d'invitation ne fonctionnera plus. L'utilisateur devra recevoir un nouveau lien."
        confirmLabel="Révoquer"
        danger
        onConfirm={confirmRevokeInvitation}
        onCancel={() => setRevokeInviteId(null)}
      />

      <ConfirmModal
        open={removeAdminEmail !== null}
        title={`Retirer ${removeAdminEmail ?? ""} des administrateurs ?`}
        body="Cet email n'aura plus accès au dashboard /platform. L'utilisateur ne sera pas supprimé côté auth."
        confirmLabel="Retirer"
        danger
        onConfirm={confirmRemoveAdmin}
        onCancel={() => setRemoveAdminEmail(null)}
      />

      {/* RT.P.0-tenantcfg — section Réglages par salle. Utilise la table
          `tenant_settings` (migration 20260723171443) — résout dette #24
          (« table tenant_settings non utilisée côté UI »). */}
      <div className="kg-platform-section">
        <h2>⚙️ Réglages par salle</h2>
        <p className="kg-platform-subtitle">
          Configuration propre à chaque salle : nombre de postes, durée
          d'avertissement, grille tarifaire.
        </p>

        <div className="kg-tenantcfg-bar">
          <label>
            Salle :{" "}
            <select
              className="kg-select"
              value={cfgTenantId}
              onChange={(e) => setCfgTenantId(e.target.value)}
              disabled={cfgLoading}
            >
              <option value="">— Choisir une salle —</option>
              {tenants.map((tn) => (
                <option key={tn.id} value={tn.id}>{tn.name}</option>
              ))}
            </select>
          </label>
        </div>

        {!cfgTenantId ? (
          <p className="kg-platform-empty">
            Sélectionnez une salle pour voir et modifier ses réglages.
          </p>
        ) : !cfgDraft ? (
          <p className="kg-platform-empty">Chargement…</p>
        ) : (
          <form onSubmit={saveTenantSettings} className="kg-tenantcfg-form">
            <div className="kg-tenantcfg-grid">
              <label>
                Nombre de postes
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={cfgDraft.poste_count}
                  onChange={(e) =>
                    setCfgDraft({ ...cfgDraft, poste_count: Number(e.target.value) || 1 })
                  }
                />
              </label>

              <label>
                Avertissement (min)
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={cfgDraft.warn_minutes}
                  onChange={(e) =>
                    setCfgDraft({ ...cfgDraft, warn_minutes: Number(e.target.value) || 1 })
                  }
                />
              </label>

              <label>
                Prix / minute (custom)
                <input
                  type="number"
                  min={0}
                  value={cfgDraft.custom_price_per_minute}
                  onChange={(e) =>
                    setCfgDraft({
                      ...cfgDraft,
                      custom_price_per_minute: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>

              <label>
                Prix boisson
                <input
                  type="number"
                  min={0}
                  value={cfgDraft.price_drink}
                  onChange={(e) =>
                    setCfgDraft({ ...cfgDraft, price_drink: Number(e.target.value) || 0 })
                  }
                />
              </label>
            </div>

            <fieldset className="kg-tenantcfg-prices">
              <legend>Grille tarifaire (FCFA / minutes)</legend>
              {(["30", "60", "90", "120"] as const).map((m) => (
                <label key={m}>
                  {m} min
                  <input
                    type="number"
                    min={0}
                    value={cfgDraft.prices[m] ?? 0}
                    onChange={(e) =>
                      setCfgDraft({
                        ...cfgDraft,
                        prices: {
                          ...cfgDraft.prices,
                          [m]: Number(e.target.value) || 0,
                        },
                      })
                    }
                  />
                </label>
              ))}
            </fieldset>

            {cfgInfo && <p className="kg-tenantcfg-info">{cfgInfo}</p>}

            <div className="kg-tenantcfg-actions">
              <button type="submit" className="kg-btn-primary" disabled={cfgLoading}>
                {cfgLoading ? "Enregistrement…" : "💾 Enregistrer"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
