import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/views/components/Toast";
import { ConfirmModal } from "@/views/components/ConfirmModal";
import { DoubleConfirmModal } from "@/views/components/DoubleConfirmModal";
import { TenantUsersModal } from "@/views/components/TenantUsersModal";
import { todayKey, fmtMoney } from "@/lib-app/helpers";
import type { AppRole } from "@/lib/session";

export const Route = createFileRoute("/_authenticated/platform/")({
  component: PlatformDashboard,
});

/**
 * Helpers de validation explicite (ND5 — Fix #4, audit 2026-08-03).
 * Pas de nouvelle dépendance (règle 5 NOUVEAU_DEPART : pas de Zod/Valibot
 * sans accord explicite). Validation côté client défensive — la RLS
 * reste l'autorité finale côté serveur.
 */

// Email RFC 5322 simplifié — suffisant pour un formulaire admin.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

function isValidSlug(s: string): boolean {
  // slug = alphanum + tirets, 3-50 chars, ne commence/finit pas par '-'
  return /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/.test(s);
}

function isValidTenantName(s: string): boolean {
  const trimmed = s.trim();
  return trimmed.length >= 2 && trimmed.length <= 100;
}

function isValidNotes(s: string): boolean {
  return s.trim().length <= 500;
}

function isInRange(n: number, min: number, max: number): boolean {
  return Number.isFinite(n) && n >= min && n <= max;
}

/**
 * Valide un email et retourne le message d'erreur ou null.
 * Réutilisable pour createTenant slug, sendInvitation email, addAdmin email.
 */
function validateEmail(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed) return "Email requis";
  if (!isValidEmail(trimmed)) return "Email invalide";
  return null;
}

function validateSlug(slug: string): string | null {
  const trimmed = slug.trim();
  if (!trimmed) return "Slug requis";
  if (trimmed.length < 3) return "Slug trop court (min 3)";
  if (!isValidSlug(trimmed)) return "Slug invalide (a-z, 0-9, tirets)";
  return null;
}

function validateTenantName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Nom requis";
  if (!isValidTenantName(trimmed)) return "Nom invalide (2-100 caractères)";
  return null;
}

function validateNotes(notes: string): string | null {
  if (!isValidNotes(notes)) return "Notes trop longues (max 500 caractères)";
  return null;
}

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

/** CHANTIER 1C — Candidatures staff. Table `staff_applications` créée par
 *  migration 20260803113500 (cf. chantier1-statut.md, décision E1 option 2).
 *  FK explicite vers profiles ajoutée en migration 20260810000000
 *  (dette #27, ferme l'inférence de jointure PostgREST côté TS).
 *  On joint profiles (nom/prenom/email) + tenants (name) en PostgREST via
 *  les hints `!staff_applications_user_id_profile_fkey` et
 *  `!staff_applications_tenant_id_fkey`. */
interface StaffApplication {
  id: string;
  user_id: string;
  tenant_id: string;
  role: AppRole;
  message: string | null;
  status: "pending" | "approved" | "rejected";
  reviewer_id: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  // Jointures (chargées via select hint, optional côté UI)
  applicant_email?: string;
  applicant_nom?: string;
  applicant_prenom?: string;
  tenant_name?: string;
}

/** CHANTIER 3 C.2 — Comptes en attente de purge.
 *  Profil soft-deleted : `deleted_at IS NOT NULL AND anonymized_at IS NULL`.
 *  Fenêtre d'annulation 30j avant anonymisation définitive par pg_cron.
 *  Restaurable via Edge Function restore-account-admin (admin-only). */
interface DeletedProfile {
  id: string;
  email: string | null;
  nom: string | null;
  prenom: string | null;
  deleted_at: string;
  scheduled_purge_at: string;
}

/** CHANTIER 3 C.3 — Comptes actifs (non soft-deleted).
 *  Affichés dans /platform section "Gestion des comptes" admin. Permettent
 *  à l'admin de déclencher la suppression (FEAT-2) via delete-own-account
 *  avec target_user_id. */
interface ActiveProfile {
  id: string;
  email: string | null;
  nom: string | null;
  prenom: string | null;
  created_at: string;
  roles: string[];
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
  // CHANTIER 1C — liste des candidatures staff (status='pending' surtout,
  // mais on charge tout pour historique).
  const [applications, setApplications] = useState<StaffApplication[]>([]);
  // CHANTIER 3 C.2 — profils soft-deleted, fenêtre d'annulation 30j ouverte.
  const [deletedProfiles, setDeletedProfiles] = useState<DeletedProfile[]>([]);
  // État pour la modale de confirmation de restauration.
  const [restoreTarget, setRestoreTarget] = useState<DeletedProfile | null>(null);
  const [restoring, setRestoring] = useState(false);
  // CHANTIER 3 C.3 — Comptes actifs + suppression directe par admin.
  const [activeProfiles, setActiveProfiles] = useState<ActiveProfile[]>([]);
  const [anonymizeTarget, setAnonymizeTarget] = useState<ActiveProfile | null>(null);
  const [anonymizing, setAnonymizing] = useState(false);
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

  // CHANTIER 1C — UI candidatures staff : state de rejet (modal/prompt
  // léger inline pour rejection_reason).
  const [rejectTarget, setRejectTarget] = useState<StaffApplication | null>(null);
  const [rejectReason, setRejectReason] = useState("");

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
  // CHANTIER 1C — compteur candidatures en attente (badge KPI + titre section).
  const pendingApplications = useMemo(
    () => applications.filter((a) => a.status === "pending").length,
    [applications],
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
    const [tRes, iRes, aRes, sRes, appRes, delRes, actRes] = await Promise.all([
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
      // CHANTIER 1C — candidatures staff. Jointures PostgREST : profiles
      // (email, nom, prenom) + tenants (name). Filtre : on garde les pending
      // en haut via order created_at desc, mais on charge aussi approved/
      // rejected pour permettre la consultation historique.
      // Types auto-générés (2026-08-10) → plus de cast nécessaire.
      // Migration 20260810000000 a ajouté la FK staff_applications_user_id_profile_fkey
      // → `profiles!staff_applications_user_id_profile_fkey(...)` typable.
      supabase
        .from("staff_applications")
        .select(`
          id, user_id, tenant_id, role, message, status, reviewer_id,
          reviewed_at, rejection_reason, created_at,
          profiles:profiles!staff_applications_user_id_profile_fkey(email, nom, prenom),
          tenants:tenants!staff_applications_tenant_id_fkey(name)
        `)
        .order("created_at", { ascending: false }),
      // CHANTIER 3 C.2 — profils soft-deleted en attente de purge.
      // Filtre : deleted_at IS NOT NULL ET anonymized_at IS NULL
      // (= encore restaurables, anonymisation pg_cron pas encore passée).
      // Tri : purge la plus proche en premier (urgence = expirer bientôt).
      supabase
        .from("profiles")
        .select("id, email, nom, prenom, deleted_at, scheduled_purge_at")
        .not("deleted_at", "is", null)
        .is("anonymized_at", null)
        .order("scheduled_purge_at", { ascending: true }),
      // CHANTIER 3 C.3 — profils actifs (non soft-deleted) + leurs rôles.
      // Jointure user_tenant_roles pour afficher le(s) rôle(s) du user dans
      // la table. Le rôle platform_admin est récupéré séparément via
      // auth.admin.getUserById() à la demande (trop coûteux pour toute la
      // liste — n'a pas besoin d'être affiché ici, l'admin connaît déjà
      // son propre rôle).
      supabase
        .from("profiles")
        .select(`
          id, email, nom, prenom, created_at,
          user_tenant_roles:user_tenant_roles!user_tenant_roles_user_id_profile_fkey(role)
        `)
        .is("deleted_at", null)
        .is("anonymized_at", null)
        .order("created_at", { ascending: false }),
    ]);
    if (tRes.error) setError(tRes.error.message);
    setTenants((tRes.data ?? []) as Tenant[]);
    setInvitations((iRes.data ?? []) as Invitation[]);
    setAdmins((aRes.data ?? []) as PlatformAdmin[]);
    setTodaySessions((sRes.data ?? []) as SessionRow[]);
    // CHANTIER 1C — aplatir les jointures (PostgREST retourne profils/tenants
    // comme tableaux d'objets). On prend le premier élément (relation N-1).
    // Le cast final `as StaffApplication[]` reste légitime : la jointure aplatie
    // (applicant_email/applicant_nom/applicant_prenom/tenant_name) ne fait pas
    // partie du Row de staff_applications.
    const apps = (appRes.data ?? []).map((row) => ({
      ...row,
      applicant_email: Array.isArray(row.profiles) ? row.profiles[0]?.email : row.profiles?.email,
      applicant_nom: Array.isArray(row.profiles) ? row.profiles[0]?.nom : row.profiles?.nom,
      applicant_prenom: Array.isArray(row.profiles) ? row.profiles[0]?.prenom : row.profiles?.prenom,
      tenant_name: Array.isArray(row.tenants) ? row.tenants[0]?.name : row.tenants?.name,
    })) as StaffApplication[];
    setApplications(apps);
    // CHANTIER 3 C.2 — profils soft-deleted. Si erreur RLS (cas rare non-admin),
    // on log mais on n'interrompt pas l'UI.
    if (delRes.error) {
      console.warn("[KG platform] load deleted_profiles error:", delRes.error.message);
      setDeletedProfiles([]);
    } else {
      setDeletedProfiles((delRes.data ?? []) as DeletedProfile[]);
    }
    // CHANTIER 3 C.3 — profils actifs. Aplatir les rôles (PostgREST retourne
    // un tableau de {role} par profile, on extrait juste les rôles).
    if (actRes.error) {
      console.warn("[KG platform] load active_profiles error:", actRes.error.message);
      setActiveProfiles([]);
    } else {
      const flat = (actRes.data ?? []).map((row: {
        id: string;
        email: string | null;
        nom: string | null;
        prenom: string | null;
        created_at: string;
        user_tenant_roles: { role: string }[] | { role: string } | null;
      }): ActiveProfile => {
        const roles = Array.isArray(row.user_tenant_roles)
          ? row.user_tenant_roles.map((r) => r.role)
          : row.user_tenant_roles
            ? [row.user_tenant_roles.role]
            : [];
        return {
          id: row.id,
          email: row.email,
          nom: row.nom,
          prenom: row.prenom,
          created_at: row.created_at,
          roles,
        };
      });
      setActiveProfiles(flat);
    }
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
    // ND5 — Fix #4 (audit 2026-08-03) : validation explicite côté client.
    // La RLS reste l'autorité finale (droits), mais on bloque les valeurs
    // manifestement mal formées AVANT l'appel réseau (UX + sécurité).
    const nameError = validateTenantName(newName);
    if (nameError) { setError(nameError); return; }
    const slugError = validateSlug(newSlug);
    if (slugError) { setError(slugError); return; }
    const { error } = await supabase
      .from("tenants")
      .insert({ name: newName.trim(), slug: newSlug.trim() });
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
    // ND5 — Fix #4 (audit 2026-08-03) : validation email explicite
    // (le HTML5 `type="email"` est bypassable via devtools).
    const emailError = validateEmail(invEmail);
    if (emailError) { setInvInfo(emailError); return; }
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
    // ND5 — Fix #4 (audit 2026-08-03) : validation email + notes explicites.
    const emailError = validateEmail(adminEmail);
    if (emailError) { setAdminInfo(emailError); return; }
    const notesError = validateNotes(adminNotes);
    if (notesError) { setAdminInfo(notesError); return; }
    const email = adminEmail.trim().toLowerCase();
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

  // CHANTIER 3 C.2 — Restaurer un compte soft-deleted (admin-only).
  // Appelle l'Edge Function restore-account-admin (verify_jwt=true). Côté SQL,
  // restore_deleted_profile() reset deleted_at/scheduled_purge_at/anonymized_at
  // ET auth.users.banned_until = NULL en une seule transaction atomique.
  async function confirmRestoreProfile() {
    if (!restoreTarget || restoring) return;
    setRestoring(true);

    const { data, error } = await supabase.functions.invoke<{
      target_user_id?: string;
      restored_at?: string;
      was_anonymized?: boolean;
      error?: string;
      code?: string;
    }>("restore-account-admin", { body: { target_user_id: restoreTarget.id } });

    setRestoring(false);

    if (error || data?.error) {
      console.error("[KG platform] restore-account-admin failed:", error, data);
      // Codes connus :
      //  - 403 "Réservé aux platform_admins" : pas admin (cas impossible ici
      //    car /platform est gardé par beforeLoad, mais on log).
      //  - 422 "not_restorable" : compte déjà anonymisé (pg_cron a tourné) ou
      //    jamais supprimé (état DB incohérent).
      const msg = data?.error ?? error?.message ?? "erreur inconnue";
      showToast("Restauration échouée : " + msg, "❌", "var(--red)");
      setRestoreTarget(null);
      return;
    }

    const wasAnon = data?.was_anonymized === true;
    showToast(
      wasAnon
        ? "Compte restauré (anonymisation réinitialisée)."
        : "Compte restauré. L'utilisateur peut se reconnecter.",
      "✅",
    );
    setRestoreTarget(null);
    void refresh();
  }

  // CHANTIER 3 C.3 — Anonymiser un compte actif (admin, FEAT-2 initial).
  // Appelle l'Edge Function delete-own-account avec target_user_id = user.id.
  // Le compte passe en soft-delete (deleted_at + scheduled_purge_at), bloqué
  // pendant 30j, anonymisable ensuite par pg_cron.
  async function confirmAnonymizeProfile() {
    if (!anonymizeTarget || anonymizing) return;
    setAnonymizing(true);

    const { data, error } = await supabase.functions.invoke<{
      deleted_at?: string;
      scheduled_purge_at?: string;
      already_deleted?: boolean;
      mode?: "self" | "admin";
      error?: string;
      code?: string;
    }>("delete-own-account", { body: { target_user_id: anonymizeTarget.id } });

    setAnonymizing(false);

    if (error || data?.error) {
      console.error("[KG platform] delete-own-account (admin) failed:", error, data);
      const msg = data?.error ?? error?.message ?? "erreur inconnue";
      showToast("Anonymisation échouée : " + msg, "❌", "var(--red)");
      setAnonymizeTarget(null);
      return;
    }

    showToast(
      "Compte marqué pour suppression. Restaurable depuis la section suivante pendant 30 jours.",
      "✅",
    );
    setAnonymizeTarget(null);
    void refresh();
  }

  // CHANTIER 1C.2 — Approuver une candidature staff.
  // Le trigger `grant_staff_role_on_approval` (migration 20260803113500
  // PARTIE 5, ligne 334-364) crée automatiquement la ligne user_tenant_roles
  // quand status passe à 'approved'. On UPDATE juste le status ici.
  async function approveApplication(app: StaffApplication) {
    const { data: userRes } = await supabase.auth.getUser();
    const reviewerId = userRes?.user?.id ?? null;
    const { error } = await supabase
      .from("staff_applications")
      .update({
        status: "approved",
        reviewer_id: reviewerId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", app.id);
    if (error) {
      showToast("Erreur approbation : " + error.message, "❌", "var(--red)");
      return;
    }
    showToast(
      `Candidature approuvée : ${app.applicant_prenom ?? ""} ${app.applicant_nom ?? app.applicant_email} → ${app.tenant_name ?? "salle"} (${app.role})`,
      "✅",
      "var(--green)",
    );
    refresh();
  }

  // CHANTIER 1C.2 — Rejeter une candidature. Ouvre le modal `rejectTarget`
  // (cf. JSX) qui demande un rejection_reason optionnel.
  async function confirmReject() {
    if (!rejectTarget) return;
    const { data: userRes } = await supabase.auth.getUser();
    const reviewerId = userRes?.user?.id ?? null;
    const { error } = await supabase
      .from("staff_applications")
      .update({
        status: "rejected",
        reviewer_id: reviewerId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: rejectReason.trim() || null,
      })
      .eq("id", rejectTarget.id);
    if (error) {
      showToast("Erreur rejet : " + error.message, "❌", "var(--red)");
      return;
    }
    showToast(
      `Candidature rejetée : ${rejectTarget.applicant_prenom ?? ""} ${rejectTarget.applicant_nom ?? rejectTarget.applicant_email}`,
      "🚫",
    );
    setRejectTarget(null);
    setRejectReason("");
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
    // ND5 — Fix #4 (audit 2026-08-03) : bornes défensives avant upsert.
    // Le UI limite déjà les champs via `min/max` mais un devtools `valueAsNumber`
    // peut outrepasser ces bornes. On valide côté JS avant INSERT.
    if (!isInRange(cfgDraft.poste_count, 1, 50)) {
      setCfgLoading(false);
      showToast("Nombre de postes invalide (1-50)", "❌", "var(--red)");
      return;
    }
    if (!isInRange(cfgDraft.warn_minutes, 1, 15)) {
      setCfgLoading(false);
      showToast("Avertissement minutes invalide (1-15)", "❌", "var(--red)");
      return;
    }
    if (!isInRange(cfgDraft.custom_price_per_minute, 0, 10000)) {
      setCfgLoading(false);
      showToast("Prix minute personnalisé invalide (0-10000)", "❌", "var(--red)");
      return;
    }
    if (!isInRange(cfgDraft.price_drink, 0, 10000)) {
      setCfgLoading(false);
      showToast("Prix boisson invalide (0-10000)", "❌", "var(--red)");
      return;
    }
    // `prices` est un dict {durée: prix_FCFA}. Chaque entrée doit être finie + dans [0, 100000].
    const pricesOk = Object.values(cfgDraft.prices).every(
      (p) => Number.isFinite(p) && p >= 0 && p <= 100000,
    );
    if (!pricesOk) {
      setCfgLoading(false);
      showToast("Une durée a un prix invalide (0-100000 F)", "❌", "var(--red)");
      return;
    }
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

      {/* ===== CHANTIER 1C — CANDIDATURES STAFF =====
          Liste les candidatures staff_applications avec jointures profiles
          (nom/prenom/email) + tenants (name). Badge pending à côté du titre.
          Boutons Approuver / Rejeter inline par ligne. Le rejet ouvre un
          mini-modal pour saisir rejection_reason. */}
      <section className="kg-platform-card" aria-labelledby="kg-platform-card-staff-apps">
        <h2 id="kg-platform-card-staff-apps" className="kg-platform-card-title">
          👔 Candidatures staff
          {pendingApplications > 0 && (
            <span className="kg-badge kg-badge-amber" style={{ marginLeft: 8 }}>
              {pendingApplications} en attente
            </span>
          )}
        </h2>
        <p className="kg-platform-loading" style={{ marginTop: 0, marginBottom: 16 }}>
          Auto-inscriptions de candidats staff pour une salle. Approbation = accès immédiat
          à <code>/app/salle</code>. Rejet = refus motivé (optionnel). Le trigger
          <code>grant_staff_role_on_approval</code> crée automatiquement le rôle
          lors de l'approbation.
        </p>

        {applications.length === 0 ? (
          <p className="kg-platform-empty">Aucune candidature pour l'instant.</p>
        ) : (
          <div className="kg-staff-apps-list">
            {applications.map((app) => (
              <div
                key={app.id}
                className={`kg-staff-app-item kg-staff-app-${app.status}`}
                data-status={app.status}
              >
                <div className="kg-staff-app-info">
                  <div className="kg-staff-app-name">
                    {app.applicant_prenom || app.applicant_nom ? (
                      <>
                        <strong>{app.applicant_prenom} {app.applicant_nom}</strong>
                        {" "}
                        <span className="kg-staff-app-email">({app.applicant_email})</span>
                      </>
                    ) : (
                      <strong>{app.applicant_email ?? "(email inconnu)"}</strong>
                    )}
                  </div>
                  <div className="kg-staff-app-meta">
                    <span>🏢 {app.tenant_name ?? "(salle inconnue)"}</span>
                    <span className="kg-staff-app-role">🎭 {app.role}</span>
                    <span className="kg-staff-app-date">
                      📅 {new Date(app.created_at).toLocaleDateString("fr-FR")}
                    </span>
                    <span className={`kg-staff-app-status kg-badge kg-badge-${
                      app.status === "pending" ? "amber" :
                      app.status === "approved" ? "green" : "red"
                    }`}>
                      {app.status === "pending" ? "⏳ En attente" :
                       app.status === "approved" ? "✅ Approuvée" : "❌ Rejetée"}
                    </span>
                  </div>
                  {app.message && (
                    <div className="kg-staff-app-message">
                      💬 {app.message}
                    </div>
                  )}
                  {app.status === "rejected" && app.rejection_reason && (
                    <div className="kg-staff-app-rejection">
                      Motif : {app.rejection_reason}
                    </div>
                  )}
                  {app.status === "approved" && app.reviewed_at && (
                    <div className="kg-staff-app-reviewed">
                      Approuvée le {new Date(app.reviewed_at).toLocaleDateString("fr-FR")}
                    </div>
                  )}
                </div>
                {app.status === "pending" && (
                  <div className="kg-staff-app-actions">
                    <button
                      type="button"
                      className="kg-btn kg-btn-green"
                      onClick={() => approveApplication(app)}
                      aria-label={`Approuver la candidature de ${app.applicant_email}`}
                    >
                      ✅ Approuver
                    </button>
                    <button
                      type="button"
                      className="kg-btn kg-btn-red"
                      onClick={() => { setRejectTarget(app); setRejectReason(""); }}
                      aria-label={`Rejeter la candidature de ${app.applicant_email}`}
                    >
                      🚫 Rejeter
                    </button>
                  </div>
                )}
              </div>
            ))}
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

      {/* ===== CHANTIER 3 C.3 — Gestion des comptes (admin) =====
          Liste tous les profils ACTIFS (non soft-deleted, non anonymisés).
          Chaque ligne permet à l'admin de déclencher la suppression (FEAT-2
          initial) via delete-own-account avec target_user_id. Action
          irréversible après 30 jours. */}
      <section
        className="kg-platform-card"
        aria-labelledby="kg-platform-card-active-profiles"
      >
        <h2 id="kg-platform-card-active-profiles" className="kg-platform-card-title">
          Gestion des comptes ({activeProfiles.length})
        </h2>
        <p className="kg-platform-loading" style={{ marginTop: 0, marginBottom: 16 }}>
          Tous les comptes utilisateurs <strong>actifs</strong> de la plateforme.
          Cliquer sur &laquo;&nbsp;Anonymiser ce compte&nbsp;&raquo; marque le
          profil pour suppression (bloqué 30&nbsp;j, PII anonymisées ensuite).
          Restauration possible depuis la section suivante pendant la fenêtre
          d&apos;annulation.
        </p>
        {activeProfiles.length === 0 ? (
          <p className="kg-platform-empty">Aucun compte actif.</p>
        ) : (
          <div className="kg-platform-table-wrap">
            <table className="kg-platform-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nom</th>
                  <th>Rôles</th>
                  <th>Inscrit le</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {activeProfiles.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">{p.email ?? "—"}</td>
                    <td style={{ color: "var(--text2)" }}>
                      {[p.prenom, p.nom].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td style={{ color: "var(--text2)", fontSize: "0.85rem" }}>
                      {p.roles.length === 0 ? (
                        <span style={{ opacity: 0.6 }}>aucun</span>
                      ) : (
                        p.roles.map((r) => (
                          <span
                            key={r}
                            className="kg-badge kg-badge-amber"
                            style={{ marginRight: 4 }}
                          >
                            {r}
                          </span>
                        ))
                      )}
                    </td>
                    <td style={{ color: "var(--text2)" }}>
                      {new Date(p.created_at).toLocaleDateString("fr-FR")}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => setAnonymizeTarget(p)}
                        className="kg-platform-button kg-platform-button--danger kg-platform-button--small"
                        aria-label={`Anonymiser le compte de ${p.email ?? p.id}`}
                      >
                        Anonymiser ce compte
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ===== CHANTIER 3 C.2 — Comptes en suppression =====
          Profils soft-deleted, fenêtre d'annulation 30j ouverte. Chaque ligne
          permet de restaurer le compte (reset deleted_at/scheduled_purge_at
          + auth.users.banned_until). Triés par purge la plus proche. */}
      <section
        className="kg-platform-card"
        aria-labelledby="kg-platform-card-deleted"
      >
        <h2 id="kg-platform-card-deleted" className="kg-platform-card-title">
          Comptes en suppression ({deletedProfiles.length})
        </h2>
        <p className="kg-platform-loading" style={{ marginTop: 0, marginBottom: 16 }}>
          Comptes soft-deleted par leur propriétaire ou par un admin. La
          fenêtre d'annulation se ferme à <code>scheduled_purge_at</code> ;
          passé ce délai, le profil est anonymisé (PII effacées) et le compte
          auth bloqué définitivement.
        </p>
        {deletedProfiles.length === 0 ? (
          <p className="kg-platform-empty">
            Aucun compte en attente de purge. Les demandes de suppression
            apparaîtront ici dès qu&apos;un utilisateur ou un admin en
            déclenche une.
          </p>
        ) : (
          <div className="kg-platform-table-wrap">
            <table className="kg-platform-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Nom</th>
                  <th>Supprimé le</th>
                  <th>Purge prévue</th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {deletedProfiles.map((p) => {
                  const daysLeft = Math.max(
                    0,
                    Math.ceil(
                      (new Date(p.scheduled_purge_at).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24),
                    ),
                  );
                  const urgent = daysLeft <= 3;
                  return (
                    <tr key={p.id}>
                      <td className="mono">{p.email ?? "—"}</td>
                      <td style={{ color: "var(--text2)" }}>
                        {[p.prenom, p.nom].filter(Boolean).join(" ") || "—"}
                      </td>
                      <td style={{ color: "var(--text2)" }}>
                        {new Date(p.deleted_at).toLocaleDateString("fr-FR")}
                      </td>
                      <td
                        style={{
                          color: urgent ? "var(--red)" : "var(--text2)",
                          fontWeight: urgent ? 700 : 400,
                        }}
                      >
                        {new Date(p.scheduled_purge_at).toLocaleDateString("fr-FR")}
                        {urgent && (
                          <span style={{ marginLeft: 6 }}>({daysLeft}j)</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          onClick={() => setRestoreTarget(p)}
                          className="kg-platform-button kg-platform-button--small"
                          aria-label={`Restaurer le compte de ${p.email ?? p.id}`}
                        >
                          Restaurer ce compte
                        </button>
                      </td>
                    </tr>
                  );
                })}
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

      {/* CHANTIER 3 C.2 — modale de confirmation de restauration. */}
      <ConfirmModal
        open={restoreTarget !== null}
        title="Restaurer ce compte ?"
        body={
          restoreTarget ? (
            <div className="kg-restore-account-body">
              <p>
                Le compte <strong>{restoreTarget.email ?? restoreTarget.id}</strong>
                {restoreTarget.prenom || restoreTarget.nom ? (
                  <>
                    {" "}({[restoreTarget.prenom, restoreTarget.nom].filter(Boolean).join(" ")})
                  </>
                ) : null}{" "}
                va être restauré :
              </p>
              <ul>
                <li>Connexion à nouveau possible immédiatement</li>
                <li>Demande de suppression annulée</li>
                <li>PII intactes (nom, prénom, email non vidés)</li>
              </ul>
              <p style={{ marginBottom: 0, color: "var(--text3)" }}>
                Suppression demandée le{" "}
                <strong>
                  {new Date(restoreTarget.deleted_at).toLocaleDateString("fr-FR")}
                </strong>
                . Purge prévue le{" "}
                <strong>
                  {new Date(restoreTarget.scheduled_purge_at).toLocaleDateString("fr-FR")}
                </strong>
                .
              </p>
            </div>
          ) : null
        }
        confirmLabel={restoring ? "Restauration…" : "Restaurer ce compte"}
        cancelLabel="Annuler"
        onConfirm={() => {
          if (!restoreTarget || restoring) return;
          void confirmRestoreProfile();
        }}
        onCancel={() => {
          if (restoring) return;
          setRestoreTarget(null);
        }}
      />

      {/* CHANTIER 3 C.3 — modale double confirmation pour anonymisation.
          Réutilise DoubleConfirmModal (cf. C.1 /client) — même pattern
          critique : tape SUPPRIMER pour confirmer. danger=true pour le
          bouton rouge. loading=true pendant l'appel Edge Function. */}
      <DoubleConfirmModal
        open={anonymizeTarget !== null}
        title="Anonymiser ce compte ?"
        confirmWord="SUPPRIMER"
        danger
        cancelLabel="Annuler"
        confirmLabel="Anonymiser ce compte"
        loading={anonymizing}
        onCancel={() => {
          if (anonymizing) return;
          setAnonymizeTarget(null);
        }}
        onConfirm={() => {
          if (anonymizing) return;
          void confirmAnonymizeProfile();
        }}
        body={
          anonymizeTarget ? (
            <div>
              <p>
                Tu t&apos;apprêtes à marquer le compte{" "}
                <strong>{anonymizeTarget.email ?? anonymizeTarget.id}</strong>
                {anonymizeTarget.prenom || anonymizeTarget.nom ? (
                  <>
                    {" "}({[anonymizeTarget.prenom, anonymizeTarget.nom].filter(Boolean).join(" ")})
                  </>
                ) : null}{" "}
                pour suppression.
              </p>
              <ul>
                <li>Connexion bloquée pendant 30 jours</li>
                <li>PII intactes pendant 30 jours</li>
                <li>Anonymisation définitive par pg_cron après ce délai</li>
                <li>
                  Restauration possible pendant la fenêtre (cf. section
                  suivante)
                </li>
              </ul>
              <p style={{ marginBottom: 0, color: "var(--text3)" }}>
                Rôles actuels :{" "}
                {anonymizeTarget.roles.length === 0 ? (
                  <em>aucun</em>
                ) : (
                  anonymizeTarget.roles.join(", ")
                )}
                .
              </p>
            </div>
          ) : null
        }
      />

      {/* CHANTIER 1C — modale de rejet d'une candidature staff.
          Le ConfirmModal natif ne supporte pas de textarea ; on inline une
          modale KG simple (overlay + modal + body + actions). Pas de nouvelle
          dépendance (cf. règle 5 NOUVEAU_DEPART). */}
      {rejectTarget && (
        <div className="kg-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="kg-reject-title">
          <div className="kg-modal">
            <h3 id="kg-reject-title" className="kg-modal-title">
              🚫 Rejeter la candidature
            </h3>
            <p className="kg-modal-body">
              {rejectTarget.applicant_prenom || rejectTarget.applicant_nom
                ? `${rejectTarget.applicant_prenom} ${rejectTarget.applicant_nom}`
                : rejectTarget.applicant_email}
              {" "}pour la salle <strong>{rejectTarget.tenant_name}</strong>.
            </p>
            <label className="kg-modal-label">
              Motif du rejet (optionnel)
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="ex : pas de profil caissier, salle complète, …"
                className="kg-modal-textarea"
                rows={3}
                maxLength={500}
                autoFocus
              />
            </label>
            <div className="kg-modal-actions">
              <button
                type="button"
                className="kg-btn"
                onClick={() => { setRejectTarget(null); setRejectReason(""); }}
              >
                Annuler
              </button>
              <button
                type="button"
                className="kg-btn kg-btn-red"
                onClick={confirmReject}
              >
                Confirmer le rejet
              </button>
            </div>
          </div>
        </div>
      )}

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
