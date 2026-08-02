import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cloud } from "@/integrations/cloud/auth";
import "@/views/theme.css";
import logo from "@/assets/logo.png";

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

/**
 * Page auth — Kingston GameZone (RT.B.11).
 * Logique métier inchangée :
 *  - Session existante → redirige vers /
 *  - Token `invite` en query string → pré-remplit l'email + force le mode signup
 *  - Signup / signin email-password via Supabase
 *  - OAuth Google via wrapper `cloud.auth.signInWithOAuth` (RT.H.2 — bascule vers Supabase natif)
 * Refonte visuelle : classes KG (palette violet/cyan).
 */
function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState<string>("");  // RT.H.3 — string pour autoriser vide; parse côté submit
  const [sex, setSex] = useState<"" | "femme" | "homme">("");  // RT.H.3
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/" });
    });
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
        // RT.H.3 — Validation âge + sexe
        // RT.H.4 — Restriction 16+ (majorité numérique RDC, services en ligne)
        const ageNum = age ? parseInt(age, 10) : null;
        if (age && (isNaN(ageNum!) || ageNum! < 16 || ageNum! > 120)) {
          setError("L'accès à Kingston GameZone est réservé aux personnes âgées de 16 ans et plus.");
          setLoading(false);
          return;
        }
        if (!sex) {
          setError("Veuillez sélectionner votre sexe.");
          setLoading(false);
          return;
        }

        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: displayName || email.split("@")[0],
              age: ageNum,
              sex,
            },
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
    const result = await cloud.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      setError(result.error.message ?? "Erreur Google");
      return;
    }
    if (!result.redirected) navigate({ to: "/" });
  }

  return (
    <main className="kg-auth">
      <section className="kg-auth-card" aria-labelledby="kg-auth-title">
        <header className="kg-auth-header">
          <img src={logo} alt="Kingston GameZone" className="kg-auth-logo" />
          <h1 id="kg-auth-title" className="kg-auth-title">
            {mode === "signin" ? "Connexion" : "Créer un compte"}
          </h1>
          <p className="kg-auth-subtitle">Plateforme SaaS multi-salles</p>
        </header>

        {inviteEmail && (
          <div className="kg-auth-invite" role="status">
            🎟️ Invitation détectée pour <strong>{inviteEmail}</strong>. Créez votre
            compte pour rejoindre la salle.
          </div>
        )}

        <button
          type="button"
          onClick={handleGoogle}
          className="kg-auth-google"
          aria-label="Continuer avec Google"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285f4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34a853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#fbbc05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"/>
            <path fill="#ea4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/>
          </svg>
          Continuer avec Google
        </button>

        <div className="kg-auth-divider" role="separator" aria-label="ou email">
          <span className="kg-auth-divider-line" />
          <span className="kg-auth-divider-label">ou email</span>
          <span className="kg-auth-divider-line" />
        </div>

        <form onSubmit={handleEmail} className="kg-auth-form" aria-label={mode === "signin" ? "Formulaire de connexion" : "Formulaire de création de compte"}>
          {mode === "signup" && (
            <>
              <input
                type="text"
                placeholder="Nom d'affichage"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="kg-auth-input"
                autoComplete="name"
              />
              {/* RT.H.3 — âge + sexe */}
              <input
                type="number"
                placeholder="Âge (16+)"
                value={age}
                min={16}
                max={120}
                onChange={(e) => setAge(e.target.value)}
                className="kg-auth-input"
                autoComplete="off"
                aria-label="Âge"
              />
              <fieldset className="kg-auth-sex" aria-label="Sexe">
                <legend className="kg-auth-sex-legend">Sexe</legend>
                <label className="kg-auth-sex-option">
                  <input
                    type="radio"
                    name="sex"
                    value="femme"
                    checked={sex === "femme"}
                    onChange={() => setSex("femme")}
                  />
                  <span>Femme</span>
                </label>
                <label className="kg-auth-sex-option">
                  <input
                    type="radio"
                    name="sex"
                    value="homme"
                    checked={sex === "homme"}
                    onChange={() => setSex("homme")}
                  />
                  <span>Homme</span>
                </label>
              </fieldset>
            </>
          )}
          <input
            type="email"
            required
            placeholder="email@exemple.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="kg-auth-input"
            autoComplete="email"
          />
          <input
            type="password"
            required
            minLength={6}
            placeholder="Mot de passe (6+ caractères)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="kg-auth-input"
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
          />
          {error && (
            <div className="kg-auth-error" role="alert">
              {error}
            </div>
          )}
          {info && (
            <div className="kg-auth-info" role="status">
              {info}
            </div>
          )}
          <button type="submit" disabled={loading} className="kg-auth-submit">
            {loading ? "…" : mode === "signin" ? "Se connecter" : "Créer le compte"}
          </button>
        </form>

        <div className="kg-auth-switch">
          {mode === "signin" ? (
            <>
              Pas encore de compte ?
              <button type="button" onClick={() => setMode("signup")}>
                Inscription
              </button>
            </>
          ) : (
            <>
              Déjà inscrit ?
              <button type="button" onClick={() => setMode("signin")}>
                Connexion
              </button>
            </>
          )}
        </div>
        <div className="kg-auth-back">
          <Link to="/">← Retour à l&apos;accueil</Link>
        </div>
      </section>
    </main>
  );
}