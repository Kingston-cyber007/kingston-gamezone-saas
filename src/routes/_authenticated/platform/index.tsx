import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "@/lib/session";

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

const ROLE_OPTIONS: { value: AppRole; label: string }[] = [
  { value: "lounge_admin", label: "Admin de salle" },
  { value: "staff", label: "Staff / Caissier" },
  { value: "client", label: "Client" },
];

function PlatformDashboard() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Invitation form
  const [invTenant, setInvTenant] = useState<string>("");
  const [invEmail, setInvEmail] = useState("");
  const [invRole, setInvRole] = useState<AppRole>("staff");
  const [invInfo, setInvInfo] = useState<string | null>(null);

  async function refresh() {
    const [tRes, iRes] = await Promise.all([
      supabase.from("tenants").select("*").order("created_at", { ascending: false }),
      supabase.from("tenant_invitations").select("*").order("created_at", { ascending: false }),
    ]);
    if (tRes.error) setError(tRes.error.message);
    setTenants((tRes.data ?? []) as Tenant[]);
    setInvitations((iRes.data ?? []) as Invitation[]);
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

  async function sendInvitation(e: React.FormEvent) {
    e.preventDefault();
    setInvInfo(null);
    if (!invTenant) { setInvInfo("Choisissez une salle."); return; }
    const { error } = await supabase.from("tenant_invitations").insert({
      tenant_id: invTenant, email: invEmail.trim().toLowerCase(), role: invRole,
    });
    if (error) { setInvInfo("Erreur : " + error.message); return; }
    setInvEmail("");
    setInvInfo("Invitation créée. Partagez le lien ci-dessous à l'invité.");
    refresh();
  }

  async function revokeInvitation(id: string) {
    if (!confirm("Révoquer cette invitation ?")) return;
    await supabase.from("tenant_invitations").delete().eq("id", id);
    refresh();
  }

  function inviteLink(token: string) {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/auth?invite=${token}`;
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
          <div className="overflow-x-auto">
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
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-black/40 border border-purple-500/20 p-6">
        <h2 className="text-lg font-bold mb-4">Inviter un utilisateur</h2>
        <form onSubmit={sendInvitation} className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <select required value={invTenant} onChange={(e) => setInvTenant(e.target.value)} className="rounded-lg bg-black/40 border border-purple-500/30 px-3 py-2">
            <option value="">— Salle —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input required type="email" placeholder="email@exemple.com" value={invEmail} onChange={(e) => setInvEmail(e.target.value)} className="rounded-lg bg-black/40 border border-purple-500/30 px-3 py-2" />
          <select value={invRole} onChange={(e) => setInvRole(e.target.value as AppRole)} className="rounded-lg bg-black/40 border border-purple-500/30 px-3 py-2">
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button className="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 font-semibold">Inviter</button>
        </form>
        {invInfo && <p className="text-sm mt-3 text-purple-200">{invInfo}</p>}

        <h3 className="mt-6 mb-2 text-sm font-semibold text-gray-400 uppercase">Invitations ({invitations.length})</h3>
        {invitations.length === 0 ? (
          <p className="text-sm text-gray-500">Aucune invitation.</p>
        ) : (
          <div className="space-y-2">
            {invitations.map((inv) => {
              const tenant = tenants.find((t) => t.id === inv.tenant_id);
              const link = inviteLink(inv.token);
              const status = inv.accepted_at ? "acceptée" : new Date(inv.expires_at) < new Date() ? "expirée" : "en attente";
              return (
                <div key={inv.id} className="rounded-lg border border-white/10 bg-black/30 p-3 flex flex-wrap items-center gap-3 text-sm">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold truncate">{inv.email}</div>
                    <div className="text-xs text-gray-500">
                      {tenant?.name ?? "—"} · {inv.role} · {status}
                    </div>
                    {!inv.accepted_at && (
                      <div className="mt-1 text-xs text-purple-300 truncate font-mono">{link}</div>
                    )}
                  </div>
                  {!inv.accepted_at && (
                    <>
                      <button
                        onClick={() => navigator.clipboard.writeText(link)}
                        className="px-3 py-1.5 rounded bg-purple-500/20 hover:bg-purple-500/30 text-xs"
                      >
                        Copier le lien
                      </button>
                      <button
                        onClick={() => revokeInvitation(inv.id)}
                        className="px-3 py-1.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs"
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
      </div>
    </div>
  );
}
