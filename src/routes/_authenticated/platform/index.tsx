import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/platform/")({
  component: PlatformDashboard,
});

interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: string;
  billing_status: string;
  city: string | null;
  created_at: string;
}

function PlatformDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const { data, error } = await supabase.from("tenants").select("*").order("created_at", { ascending: false });
    if (error) setError(error.message);
    setTenants((data ?? []) as Tenant[]);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function createTenant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.from("tenants").insert({ name: newName, slug: newSlug });
    if (error) { setError(error.message); return; }
    setNewName(""); setNewSlug("");
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl bg-black/40 border border-amber-500/20 p-6">
        <h2 className="text-lg font-bold mb-4">Créer une salle</h2>
        <form onSubmit={createTenant} className="flex flex-wrap gap-3">
          <input required placeholder="Nom" value={newName} onChange={(e) => setNewName(e.target.value)} className="flex-1 min-w-48 rounded-lg bg-black/40 border border-amber-500/30 px-3 py-2" />
          <input required placeholder="slug-unique" value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} className="flex-1 min-w-48 rounded-lg bg-black/40 border border-amber-500/30 px-3 py-2 font-mono" />
          <button className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 font-semibold">Créer</button>
        </form>
        {error && <p className="text-sm text-red-400 mt-3">{error}</p>}
      </div>

      <div className="rounded-2xl bg-black/40 border border-amber-500/20 p-6">
        <h2 className="text-lg font-bold mb-4">Salles ({tenants.length})</h2>
        {loading ? <p className="text-gray-500">Chargement…</p> : (
          <table className="w-full text-sm">
            <thead className="text-gray-400 uppercase text-xs">
              <tr><th className="text-left py-2">Nom</th><th className="text-left">Slug</th><th className="text-left">Ville</th><th className="text-left">Statut</th><th className="text-left">Facturation</th></tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="py-2 font-semibold">{t.name}</td>
                  <td className="font-mono text-amber-300">{t.slug}</td>
                  <td className="text-gray-400">{t.city ?? "—"}</td>
                  <td><span className="px-2 py-0.5 rounded bg-green-500/20 text-green-300 text-xs">{t.status}</span></td>
                  <td><span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs">{t.billing_status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
