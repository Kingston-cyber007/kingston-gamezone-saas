import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DoubleConfirmModal } from "@/views/components/DoubleConfirmModal";
import { showToast } from "@/views/components/Toast";

export const Route = createFileRoute("/_authenticated/client/")({
  component: ClientHome,
});

interface Ticket {
  id: string;
  code: string;
  nom: string;
  prenom: string;
  date_creation: string;
  date_expiration: string;
  saved_remaining_ms: number | null;
  total_amount: number;
}

/**
 * Espace client — Kingston GameZone (RT.B.15).
 * Logique métier inchangée : lit `tickets` et `loyalty_points` filtrés par
 * `client_user_id = user.id`. Refonte visuelle via classes KG (accent cyan
 * pour distinguer du violet admin plateforme).
 *
 * CHANTIER 3 C.1 — Section "Mon compte" en bas de page :
 *   - Affichage email + bouton rouge "Supprimer mon compte"
 *   - Modale double confirmation (tape "SUPPRIMER") via DoubleConfirmModal
 *   - Appelle Edge Function delete-own-account (verify_jwt=true, mode self)
 *   - Sur succès → signOut + redirect / avec toast d'info
 *   - Sur erreur → toast d'erreur (compte NON déconnecté pour que l'user
 *     puisse réessayer)
 */
function ClientHome() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loyalty, setLoyalty] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // CHANTIER 3 C.1 — état suppression de compte
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [tk, lp] = await Promise.all([
        supabase
          .from("tickets")
          .select("id, code, nom, prenom, date_creation, date_expiration, saved_remaining_ms, total_amount")
          .eq("client_user_id", user.id)
          .order("date_creation", { ascending: false }),
        supabase.from("loyalty_points").select("points").eq("client_user_id", user.id),
      ]);
      setTickets((tk.data ?? []) as Ticket[]);
      setLoyalty((lp.data ?? []).reduce((s: number, r: any) => s + (r.points ?? 0), 0));
      setLoading(false);
    })();
  }, [user?.id]);

  function openConfirm() {
    setConfirmOpen(true);
  }

  function cancelConfirm() {
    if (submitting) return;
    setConfirmOpen(false);
  }

  async function confirmDelete() {
    if (!user) return;
    setSubmitting(true);

    // Mode self : pas de body.target_user_id. La Edge Function lit le JWT
    // caller et utilise caller.id comme cible.
    const { data, error } = await supabase.functions.invoke<{
      deleted_at?: string;
      scheduled_purge_at?: string;
      already_deleted?: boolean;
      mode?: "self" | "admin";
      error?: string;
      code?: string;
    }>("delete-own-account", { body: {} });

    setSubmitting(false);

    if (error || data?.error) {
      // L'utilisateur reste connecté — on le laisse réessayer ou contacter
      // le support.
      console.error("[KG client] delete-own-account failed:", error, data);
      showToast(
        "Suppression échouée : " + (data?.error ?? error?.message ?? "erreur inconnue"),
        "❌",
        "var(--red)",
      );
      setConfirmOpen(false);
      return;
    }

    // Succès — la fenêtre 30j commence maintenant. On déconnecte
    // immédiatement pour éviter toute action non intentionnelle sur un
    // compte qui sera bloqué au prochain sign-in.
    setConfirmOpen(false);
    showToast(
      "Compte marqué pour suppression. Tu as 30 jours pour demander l'annulation via le gérant de ta salle.",
      "ℹ️",
    );
    await supabase.auth.signOut();
    navigate({ to: "/" });
  }

  return (
    <div className="kg-client-home">
      <section className="kg-client-kpis" aria-label="Indicateurs clés">
        <div className="kg-client-kpi">
          <div className="kg-client-kpi-label">Points de fidélité</div>
          <div className="kg-client-kpi-value">{loyalty}</div>
          <div className="kg-client-kpi-meta">Tous programmes confondus</div>
        </div>
        <div className="kg-client-kpi">
          <div className="kg-client-kpi-label">Mes tickets</div>
          <div className="kg-client-kpi-value">{tickets.length}</div>
          <div className="kg-client-kpi-meta">Historique complet</div>
        </div>
      </section>

      <section className="kg-client-section" aria-labelledby="kg-client-tickets-title">
        <h2 id="kg-client-tickets-title" className="kg-client-section-title">
          Historique des tickets
        </h2>
        {loading ? (
          <p className="kg-client-loading">Chargement…</p>
        ) : tickets.length === 0 ? (
          <p className="kg-client-empty">
            Aucun ticket associé à votre compte pour le moment. Demandez à la
            caisse d&apos;associer vos prochains tickets à votre email.
          </p>
        ) : (
          <div className="kg-client-table-wrap">
            <table className="kg-client-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Nom</th>
                  <th className="right">Montant</th>
                  <th className="right">Créé</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id}>
                    <td className="mono">{t.code}</td>
                    <td>
                      {t.prenom} {t.nom}
                    </td>
                    <td className="right">
                      {Number(t.total_amount).toLocaleString()} FCFA
                    </td>
                    <td className="right" style={{ color: "var(--text2)" }}>
                      {new Date(t.date_creation).toLocaleDateString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* CHANTIER 3 C.1 — Section "Mon compte" + bouton supprimer */}
      <section
        className="kg-client-section"
        aria-labelledby="kg-client-account-title"
      >
        <h2 id="kg-client-account-title" className="kg-client-section-title">
          Mon compte
        </h2>
        <div className="kg-client-account-card">
          <div className="kg-client-account-info">
            <div className="kg-client-account-label">Email</div>
            <div className="kg-client-account-value">{user?.email ?? "—"}</div>
          </div>
          <div className="kg-client-account-danger">
            <div className="kg-client-account-danger-title">
              Supprimer mon compte
            </div>
            <p className="kg-client-account-danger-text">
              Cette action est irréversible après 30 jours. Pendant cette
              fenêtre, le gérant de ta salle peut annuler la suppression.
              Au-delà, tes informations personnelles (nom, prénom, email,
              téléphone) seront anonymisées et ton compte bloqué
              définitivement.
            </p>
            <button
              type="button"
              onClick={openConfirm}
              className="kg-platform-button kg-platform-button--danger"
              aria-label="Supprimer mon compte"
            >
              Supprimer mon compte
            </button>
          </div>
        </div>
      </section>

      {/* CHANTIER 3 C.1 — Modale double confirmation (tape SUPPRIMER) */}
      <DoubleConfirmModal
        open={confirmOpen}
        title="Supprimer mon compte ?"
        confirmWord="SUPPRIMER"
        danger
        cancelLabel="Annuler"
        confirmLabel="Supprimer définitivement"
        loading={submitting}
        onCancel={cancelConfirm}
        onConfirm={() => {
          if (submitting) return;
          void confirmDelete();
        }}
        body={
          <div>
            <p>
              Pour confirmer, tape <strong>SUPPRIMER</strong> en majuscules
              dans le champ ci-dessous. Cette action :
            </p>
            <ul>
              <li>Marque ton compte pour suppression immédiate</li>
              <li>Bloque ta connexion pendant 30 jours</li>
              <li>
                Anonymise tes données personnelles si non annulée par le
                gérant
              </li>
            </ul>
          </div>
        }
      />
    </div>
  );
}