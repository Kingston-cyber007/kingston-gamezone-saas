import { createFileRoute } from "@tanstack/react-router";
import { useSession } from "@/lib/session";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

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
 */
function ClientHome() {
  const { user } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loyalty, setLoyalty] = useState<number>(0);
  const [loading, setLoading] = useState(true);

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
    </div>
  );
}