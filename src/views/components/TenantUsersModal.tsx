import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/views/components/Toast";
import { ConfirmModal } from "@/views/components/ConfirmModal";
import type { AppRole } from "@/lib/session";

/**
 * Modale "Utilisateurs d'une salle" — Kingston GameZone (RT.B V3).
 *
 * Affiche la liste des `user_tenant_roles` (assignations effectives) pour
 * un tenant donné, avec JOIN sur `profiles` pour avatar / display_name /
 * email. Utilise `<ConfirmModal>` (V2) pour confirmer la révocation.
 *
 * Côté RLS (état au 31/07/2026, migration `20260731150000_5c1_...`) :
 *  - La policy `Users can view their own profile` (auth.uid() = id) reste active.
 *  - La policy `Platform admins can view all profiles` ajoutée par la migration
 *    ci-dessus permet aux platform_admins de SELECT tous les profils.
 *    → `email` est désormais affiché pour les platform_admins (plus de
 *    "— (lecture restreinte)"). Pour les autres rôles, c'est `null` et
 *    l'UI continue d'afficher honnêtement le fallback.
 *  - Le tracking via `audit_log` reste à implémenter (dette #25, chantier
 *    dédié). Cette migration n'ajoute pas de log d'accès.
 *
 *  - L'avatar cercle gradient violet/cyan est généré localement à partir
 *    des initiales du display_name (ou "??") — pas de dépendance externe.
 */
export interface TenantUsersModalProps {
  open: boolean;
  tenant: { id: string; name: string } | null;
  onClose: () => void;
}

interface RoleRow {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
  profile: {
    email: string | null;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

const ROLE_LABELS: Record<AppRole, string> = {
  platform_admin: "Admin plateforme",
  lounge_admin: "Admin de salle",
  staff: "Staff",
  client: "Client",
};

function initials(name: string | null, email: string | null): string {
  const source = (name || email || "??").trim();
  const parts = source.split(/\s+|@/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function TenantUsersModal({ open, tenant, onClose }: TenantUsersModalProps) {
  const [rows, setRows] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<RoleRow | null>(null);

  useEffect(() => {
    if (!open || !tenant) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      // Jointure profiles via notation PostgREST : profiles!user_tenant_roles_user_id_fkey
      // (le nom de la FK est généré par Supabase — fallback ci-dessous si nom
      // différent on retente sans hint).
      const { data, error } = await supabase
        .from("user_tenant_roles")
        .select("id, user_id, role, created_at, profiles:user_id (email, display_name, avatar_url)")
        .eq("tenant_id", tenant!.id)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        showToast("Erreur : " + error.message, "❌", "var(--red)");
        setRows([]);
      } else {
        // Cast : la jointure imbriquée envoie un objet OU null selon RLS
        setRows((data ?? []) as unknown as RoleRow[]);
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open, tenant]);

  async function confirmRevoke() {
    if (!revokeTarget) return;
    const { error } = await supabase.from("user_tenant_roles").delete().eq("id", revokeTarget.id);
    if (error) {
      showToast("Erreur : " + error.message, "❌", "var(--red)");
      setRevokeTarget(null);
      return;
    }
    showToast(`Rôle « ${ROLE_LABELS[revokeTarget.role]} » retiré`, "🗑️");
    setRows((r) => r.filter((x) => x.id !== revokeTarget.id));
    setRevokeTarget(null);
  }

  if (!open || !tenant) return null;

  return (
    <>
      <div
        className="kg-platform-modal-overlay"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        role="presentation"
      >
        <div
          className="kg-platform-modal kg-platform-modal--wide"
          role="dialog"
          aria-modal="true"
          aria-labelledby="kg-tenant-users-title"
        >
          <h3 id="kg-tenant-users-title" className="kg-platform-modal-title">
            Utilisateurs — {tenant.name}
          </h3>
          {loading ? (
            <p className="kg-platform-loading">Chargement…</p>
          ) : rows.length === 0 ? (
            <p className="kg-platform-empty">
              Aucun utilisateur n&apos;est encore assigné à cette salle. Utilisez le formulaire «
              Inviter un utilisateur » ci-dessus.
            </p>
          ) : (
            <div className="kg-platform-table-wrap">
              <table className="kg-platform-table">
                <thead>
                  <tr>
                    <th aria-label="Avatar"></th>
                    <th>Email</th>
                    <th>Nom</th>
                    <th>Rôle</th>
                    <th>Depuis</th>
                    <th aria-label="Actions"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const ini = initials(r.profile?.display_name ?? null, r.profile?.email ?? null);
                    return (
                      <tr key={r.id}>
                        <td>
                          <span className="kg-platform-avatar" aria-hidden="true">
                            {ini}
                          </span>
                        </td>
                        <td className="mono">
                          {r.profile?.email ?? (
                            <span style={{ color: "var(--text3)" }}>— (lecture restreinte)</span>
                          )}
                        </td>
                        <td style={{ color: "var(--text2)" }}>{r.profile?.display_name ?? "—"}</td>
                        <td>
                          <span className="kg-platform-badge kg-platform-badge--info">
                            {ROLE_LABELS[r.role]}
                          </span>
                        </td>
                        <td style={{ color: "var(--text2)" }}>
                          {new Date(r.created_at).toLocaleDateString("fr-FR")}
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => setRevokeTarget(r)}
                            className="kg-platform-button kg-platform-button--danger kg-platform-button--small"
                            aria-label={`Retirer le rôle ${r.role}`}
                          >
                            Retirer
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="kg-platform-modal-actions">
            <button
              type="button"
              onClick={onClose}
              className="kg-platform-button kg-platform-button--ghost"
            >
              Fermer
            </button>
          </div>
        </div>
      </div>

      <ConfirmModal
        open={revokeTarget !== null}
        title="Retirer ce rôle ?"
        body={
          revokeTarget ? (
            <>
              L&apos;utilisateur{" "}
              <strong>
                {revokeTarget.profile?.display_name ??
                  revokeTarget.profile?.email ??
                  revokeTarget.user_id.slice(0, 8)}
              </strong>{" "}
              perdra le rôle <strong>{ROLE_LABELS[revokeTarget.role]}</strong> sur la salle{" "}
              <strong>{tenant.name}</strong>. Il pourra être ré-assigné via une nouvelle invitation.
            </>
          ) : null
        }
        confirmLabel="Retirer"
        danger
        onConfirm={confirmRevoke}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  );
}
