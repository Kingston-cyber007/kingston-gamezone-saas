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

function ClientHome() {
  const { user } = useSession();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loyalty, setLoyalty] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const [tk, lp] = await Promise.all([
        supabase.from("tickets").select("id, code, nom, prenom, date_creation, date_expiration, saved_remaining_ms, total_amount").eq("client_user_id", user.id).order("date_creation", { ascending: false }),
        supabase.from("loyalty_points").select("points").eq("client_user_id", user.id),
      ]);
      setTickets((tk.data ?? []) as Ticket[]);
      setLoyalty((lp.data ?? []).reduce((s: number, r: any) => s + (r.points ?? 0), 0));
      setLoading(false);
    })();
  }, [user?.id]);

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-black/40 border border-cyan-500/30 p-6">
          <div className="text-sm text-gray-400 uppercase">Points de fidélité</div>
          <div className="text-4xl font-black text-cyan-300 mt-2">{loyalty}</div>
          <div className="text-xs text-gray-500 mt-1">Tous programmes confondus</div>
        </div>
        <div className="rounded-2xl bg-black/40 border border-cyan-500/30 p-6">
          <div className="text-sm text-gray-400 uppercase">Mes tickets</div>
          <div className="text-4xl font-black text-cyan-300 mt-2">{tickets.length}</div>
          <div className="text-xs text-gray-500 mt-1">Historique complet</div>
        </div>
      </div>

      <div className="rounded-2xl bg-black/40 border border-cyan-500/20 p-6">
        <h2 className="text-lg font-bold mb-4">Historique des tickets</h2>
        {loading ? (
          <p className="text-gray-500">Chargement…</p>
        ) : tickets.length === 0 ? (
          <p className="text-gray-500">Aucun ticket associé à votre compte pour le moment. Demandez à la caisse d'associer vos prochains tickets à votre email.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 uppercase text-xs">
              <tr><th className="text-left py-2">Code</th><th className="text-left">Nom</th><th className="text-right">Montant</th><th className="text-right">Créé</th></tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="py-2 font-mono text-cyan-300">{t.code}</td>
                  <td>{t.prenom} {t.nom}</td>
                  <td className="text-right">{Number(t.total_amount).toLocaleString()} FCFA</td>
                  <td className="text-right text-gray-400">{new Date(t.date_creation).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
