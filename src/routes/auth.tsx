import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import logoAsset from "@/assets/kingston-logo.png.asset.json";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Connexion — Kingston GameZone" },
      { name: "description", content: "Connectez-vous à la plateforme Kingston GameZone : gestion de salles, caisse, tickets et fidélité." },
      { property: "og:title", content: "Connexion — Kingston GameZone" },
      { property: "og:description", content: "Plateforme SaaS multi-salles de gaming en Afrique." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
    // Check invite token in URL
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("invite");
      if (token) {
        supabase.rpc("get_invitation_by_token", { _token: token }).then(({ data }) => {
          const row = Array.isArray(data) ? data[0] : null;
          if (row?.email) {
            setInviteEmail(row.email);
            setEmail(row.email);
            setMode("signup");
          }
        });
      }
    }
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        setInfo("Compte créé. Vérifiez votre boîte mail si nécessaire, puis connectez-vous.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setError(null);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setError(result.error.message ?? "Erreur Google");
      return;
    }
    if (!result.redirected) navigate({ to: "/" });
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,#1a0f2e,#0a0614)] p-4">
      <div className="w-full max-w-md rounded-2xl bg-black/40 border border-purple-500/30 backdrop-blur-xl p-8 shadow-2xl">
        <div className="flex flex-col items-center mb-6">
          <img src={logoAsset.url} alt="Kingston GameZone" className="h-24 object-contain drop-shadow-[0_0_20px_rgba(139,92,246,0.5)]" />
          <h1 className="mt-4 text-2xl font-bold bg-gradient-to-r from-purple-400 to-cyan-400 bg-clip-text text-transparent">
            {mode === "signin" ? "Connexion" : "Créer un compte"}
          </h1>
          <p className="text-sm text-gray-400 mt-1">Plateforme SaaS multi-salles</p>
        </div>

        {inviteEmail && (
          <div className="mb-4 rounded-lg bg-purple-500/10 border border-purple-500/30 px-3 py-2 text-sm text-purple-200">
            🎟️ Invitation détectée pour <strong>{inviteEmail}</strong>. Créez votre compte pour rejoindre la salle.
          </div>
        )}

        <button
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-3 rounded-lg bg-white text-gray-900 py-2.5 font-medium hover:bg-gray-100 transition mb-4"
        >
          <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#fbbc05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/><path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
          Continuer avec Google
        </button>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-purple-500/20" />
          <span className="text-xs text-gray-500 uppercase">ou email</span>
          <div className="flex-1 h-px bg-purple-500/20" />
        </div>

        <form onSubmit={handleEmail} className="space-y-3">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Nom d'affichage"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full rounded-lg bg-black/40 border border-purple-500/30 px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400"
            />
          )}
          <input
            type="email"
            required
            placeholder="email@exemple.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-black/40 border border-purple-500/30 px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Mot de passe (6+ caractères)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-black/40 border border-purple-500/30 px-3 py-2 text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-400"
          />
          {error && <div className="text-sm text-red-400 bg-red-500/10 rounded px-3 py-2">{error}</div>}
          {info && <div className="text-sm text-green-400 bg-green-500/10 rounded px-3 py-2">{info}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-cyan-500 text-white py-2.5 font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {loading ? "…" : mode === "signin" ? "Se connecter" : "Créer le compte"}
          </button>
        </form>

        <div className="text-center mt-4 text-sm text-gray-400">
          {mode === "signin" ? (
            <>Pas encore de compte ?{" "}
              <button onClick={() => setMode("signup")} className="text-purple-400 hover:underline">Inscription</button>
            </>
          ) : (
            <>Déjà inscrit ?{" "}
              <button onClick={() => setMode("signin")} className="text-purple-400 hover:underline">Connexion</button>
            </>
          )}
        </div>
        <div className="text-center mt-4 text-xs text-gray-500">
          <Link to="/" className="hover:text-gray-300">← Retour</Link>
        </div>
      </div>
    </div>
  );
}
