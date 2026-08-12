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
  // CHANTIER 1B — extension auth : ajout de "signup-staff" pour les candidatures
  // (option 2 tranchée à E1 — table staff_applications séparée), et "reset"
  // pour le flux mot de passe oublié (B.4).
  const [mode, setMode] = useState<"signin" | "signup" | "signup-staff" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState<string>("");  // RT.H.3 — string pour autoriser vide; parse côté submit
  const [sex, setSex] = useState<"" | "femme" | "homme">("");  // RT.H.3
  // CHANTIER 1B.1 — PII client étendues (mapped vers raw_user_meta_data → handle_new_user).
  // Migration 20260803113500 a ajouté nom, prenom, sexe, age, telephone, indicatif_pays
  // dans profiles. is_minor GENERATED ALWAYS AS (age < 18) — mineur PEUT être créé
  // (RT.H.4 cohérence 16+) mais bloqué côté réservation/paiement en ligne (B.2).
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [indicatifPays, setIndicatifPays] = useState("+242"); // Congo par défaut
  const [telephone, setTelephone] = useState("");
  // CHANTIER 1B.5 — candidature staff : tenant_id choisi via dropdown
  // (chargé depuis supabase.from("tenants") au mount).
  const [staffTenants, setStaffTenants] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [signupStaffTenantId, setSignupStaffTenantId] = useState("");
  const [staffMessage, setStaffMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState<string | null>(null);

  useEffect(() => {
    // BUG-2 — boucle /auth ↔ / (2026-08-08)
    //
    // PROBLÈME : on utilisait `supabase.auth.getSession()` qui lit UNIQUEMENT
    // localStorage sans re-valider le JWT côté serveur. Si une session est
    // stale (cas typique : juste après une rotation de SUPABASE_SERVICE_ROLE_KEY
    // sur l'ancien système JWT — la rotation invalide toutes les sessions actives
    // cf. dette #28), getSession() retourne quand même la session locale, on
    // redirige vers "/", puis index.tsx beforeLoad appelle getUser() qui
    // rejette le JWT serveur → landing vide → l'utilisateur ne peut plus se
    // connecter sans avoir nettoyé manuellement localStorage.
    //
    // FIX : utiliser `getUser()` qui fait un round-trip serveur Auth. Si le
    // JWT est invalide/expiré, `data.user` est null → on ne redirige PAS,
    // l'utilisateur voit le formulaire /auth et peut se reconnecter.
    //
    // Coût : +1 requête réseau au mount de /auth (~100ms). Acceptable.
    //
    // Alternative écartée : `supabase.auth.signOut()` automatique sur session
    // invalide — dangereux (supprime l'état local sans action user, perdrait
    // les work-in-progress dans le form). On laisse l'utilisateur gérer.
    supabase.auth.getUser().then(({ data, error }) => {
      if (!error && data.user) navigate({ to: "/" });
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
    // CHANTIER 1B.5 — chargement de la liste des salles actives pour le mode
    // signup-staff. On filtre status='active' (RLS public via `tenants` est
    // déjà permissif pour SELECT ; cf. migrations 20260723171443).
    supabase
      .from("tenants")
      .select("id, name, status")
      .eq("status", "active")
      .order("name")
      .then(({ data }) => {
        if (data) setStaffTenants(data as Array<{ id: string; name: string; status: string }>);
      });
  }, [navigate]);

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      // CHANTIER 1B.4 — Reset password : flux dédié avec message neutre
      // (ne jamais confirmer/infirmer l'existence d'un compte — sécurité).
      if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/auth?mode=signin",
        });
        // Message NEUTRE — identique que le compte existe ou non.
        setInfo("Si ce compte existe, un email de réinitialisation a été envoyé.");
        if (error) console.warn("[KG auth] resetPasswordForEmail:", error.message);
        setLoading(false);
        return;
      }

      if (mode === "signup" || mode === "signup-staff") {
        // RT.H.3 — Validation âge + sexe (maintenu 16+, cohérence RT.H.4).
        // CHANTIER 1B.1 — PII obligatoires : nom + prenom (RHS trim).
        // CHANTIER 1B.2 — bandeau < 18 ans plus bas dans le JSX.
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
        if (!nom.trim() || !prenom.trim()) {
          setError("Nom et prénom sont obligatoires.");
          setLoading(false);
          return;
        }
        // CHANTIER 1B.1 — téléphone : format simple (chiffres + espaces + tirets,
        // 6-15 chars après l'indicatif). On accepte les espaces/tirets pour
        // tolérance UX ; l'API Edge Function côté serveur revalide.
        const phoneDigits = telephone.replace(/[\s-]/g, "");
        if (phoneDigits.length < 6 || phoneDigits.length > 15 || !/^\d+$/.test(phoneDigits)) {
          setError("Numéro de téléphone invalide (6 à 15 chiffres).");
          setLoading(false);
          return;
        }

        // CHANTIER 1B.3 — Anti-jetable via Edge Function Deno.
        // Validation CÔTÉ SERVEUR uniquement (cf. décision mailchecker actée).
        // Le client peut bypasser devtools : la sécurité est dans l'Edge Function.
        try {
          const { data: jetableData, error: jetableErr } = await supabase.functions.invoke<{
            jetable: boolean;
            domain: string;
          }>("check-email-jetable", { body: { email } });
          if (!jetableErr && jetableData?.jetable) {
            setError(
              `Adresse email rejetée : le domaine « ${jetableData.domain} » est sur la liste des fournisseurs temporaires. Utilise une adresse permanente.`,
            );
            setLoading(false);
            return;
          }
          // Si l'Edge Function est indisponible (réseau, non déployée),
          // on log mais on ne BLOQUE PAS — préférable à un false positive
          // qui empêche toute inscription. À surveiller en monitoring.
          if (jetableErr) {
            console.warn("[KG auth] check-email-jetable indisponible:", jetableErr.message);
          }
        } catch (jetableEx) {
          console.warn("[KG auth] check-email-jetable exception:", jetableEx);
        }

        // CHANTIER 1B.5 — candidature staff : tenant requis.
        if (mode === "signup-staff" && !signupStaffTenantId) {
          setError("Sélectionne la salle pour laquelle tu postules.");
          setLoading(false);
          return;
        }

        // Le signUp crée auth.users ET déclenche handle_new_user (migration
        // 20260803113500 PARTIE 2 ligne 67-120) qui mappe nom/prenom/sexe/age/
        // telephone/indicatif_pays depuis raw_user_meta_data vers profiles.
        const { data: signUpData, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: {
              display_name: displayName || `${prenom} ${nom}`,
              age: ageNum,
              sex,
              nom: nom.trim(),
              prenom: prenom.trim(),
              telephone: phoneDigits,
              indicatif_pays: indicatifPays,
            },
          },
        });
        if (error) throw error;

        // CHANTIER 1B.5 — si mode staff et compte créé, on insère la candidature.
        // user_id vient du signUp (auth.users.id tout juste créé). status='pending'
        // par défaut (cf. table staff_applications).
        if (mode === "signup-staff" && signUpData?.user?.id && signupStaffTenantId) {
          // Types auto-générés via `supabase gen types typescript` (2026-08-10).
          // Plus de cast nécessaire : `staff_applications` est connue du client TS.
          const { error: appErr } = await supabase.from("staff_applications").insert({
            user_id: signUpData.user.id,
            tenant_id: signupStaffTenantId,
            role: "staff",
            message: staffMessage.trim() || null,
          });
          if (appErr) {
            // Le compte est créé mais la candidature a échoué : on prévient
            // l'user sans rollback (impossible de rollback signUp côté client).
            console.error("[KG auth] staff_applications insert failed:", appErr);
            setError(
              "Compte créé, mais l'envoi de candidature a échoué. Contacte le gérant de la salle pour finaliser ta candidature.",
            );
            setLoading(false);
            return;
          }
          setInfo(
            "Candidature envoyée. Tu peux te connecter, mais l'accès à la salle sera désactivé tant qu'un admin n'aura pas approuvé ta candidature.",
          );
          setMode("signin");
          return;
        }

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
            {mode === "signin"
              ? "Connexion"
              : mode === "signup"
                ? "Créer un compte"
                : mode === "signup-staff"
                  ? "Candidature staff"
                  : "Mot de passe oublié"}
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

        <form onSubmit={handleEmail} className="kg-auth-form" aria-label={mode === "signin" ? "Formulaire de connexion" : mode === "signup-staff" ? "Formulaire de candidature staff" : "Formulaire de création de compte"}>
          {(mode === "signup" || mode === "signup-staff") && (
            <>
              {/* CHANTIER 1B.1 — PII obligatoires (mapped vers profiles via
                  handle_new_user, cf. migration 20260803113500 PARTIE 2). */}
              <div className="kg-auth-row">
                <input
                  type="text"
                  placeholder="Nom"
                  value={nom}
                  onChange={(e) => setNom(e.target.value)}
                  className="kg-auth-input"
                  autoComplete="family-name"
                  required
                  aria-label="Nom"
                />
                <input
                  type="text"
                  placeholder="Prénom"
                  value={prenom}
                  onChange={(e) => setPrenom(e.target.value)}
                  className="kg-auth-input"
                  autoComplete="given-name"
                  required
                  aria-label="Prénom"
                />
              </div>
              {/* CHANTIER 1B.1 — téléphone avec dropdown indicatif pays.
                  Valeur par défaut +242 (Congo, marché principal). */}
              <div className="kg-auth-row">
                <select
                  value={indicatifPays}
                  onChange={(e) => setIndicatifPays(e.target.value)}
                  className="kg-auth-input kg-auth-indicatif"
                  aria-label="Indicatif pays"
                >
                  <option value="+242">🇨🇩 +242 (RD Congo)</option>
                  <option value="+242">🇨🇬 +242 (Congo-Brazzaville)</option>
                  <option value="+243">🇨🇩 +243 (RDC alternatif)</option>
                  <option value="+33">🇫🇷 +33 (France)</option>
                  <option value="+1">🇺🇸 +1 (USA/Canada)</option>
                  <option value="+225">🇨🇮 +225 (Côte d'Ivoire)</option>
                  <option value="+221">🇸🇳 +221 (Sénégal)</option>
                  <option value="+237">🇨🇲 +237 (Cameroun)</option>
                  <option value="+241">🇬🇦 +241 (Gabon)</option>
                  <option value="+261">🇲🇬 +261 (Madagascar)</option>
                </select>
                <input
                  type="tel"
                  placeholder="06 123 45 67"
                  value={telephone}
                  onChange={(e) => setTelephone(e.target.value)}
                  className="kg-auth-input kg-auth-tel"
                  autoComplete="tel-national"
                  required
                  aria-label="Numéro de téléphone"
                />
              </div>
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
              {/* CHANTIER 1B.2 — bandeau d'avertissement pour < 18 ans.
                  Affiché uniquement si l'âge est rempli ET < 18. */}
              {age && parseInt(age, 10) >= 16 && parseInt(age, 10) < 18 && (
                <div className="kg-auth-warn-minor" role="status">
                  ⚠️ Tu as moins de 18 ans. Ton compte sera créé, mais l'accès à
                  la réservation et au paiement en ligne sera désactivé. Tu peux
                  uniquement passer en salle avec paiement en espèces.
                </div>
              )}
              {/* CHANTIER 1B.5 — candidature staff : dropdown tenant. */}
              {mode === "signup-staff" && (
                <>
                  <select
                    value={signupStaffTenantId}
                    onChange={(e) => setSignupStaffTenantId(e.target.value)}
                    className="kg-auth-input"
                    required
                    aria-label="Salle pour laquelle tu postules"
                  >
                    <option value="">— Choisis une salle —</option>
                    {staffTenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <textarea
                    placeholder="Message au gérant (optionnel)"
                    value={staffMessage}
                    onChange={(e) => setStaffMessage(e.target.value)}
                    className="kg-auth-input"
                    rows={3}
                    aria-label="Message au gérant"
                  />
                </>
              )}
            </>
          )}
          {mode !== "reset" && (
            <input
              type="email"
              required
              placeholder="email@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="kg-auth-input"
              autoComplete="email"
            />
          )}
          {mode !== "reset" && (
            <input
              type="password"
              required={mode !== "signup-staff" && mode !== "signup"}
              minLength={6}
              placeholder="Mot de passe (6+ caractères)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="kg-auth-input"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
          )}
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
            {loading
              ? "…"
              : mode === "signin"
                ? "Se connecter"
                : mode === "signup"
                  ? "Créer le compte"
                  : mode === "signup-staff"
                    ? "Envoyer ma candidature"
                    : "Envoyer le lien de réinitialisation"}
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
          ) : mode === "signup" ? (
            <>
              Déjà inscrit ?
              <button type="button" onClick={() => setMode("signin")}>
                Connexion
              </button>
            </>
          ) : mode === "signup-staff" ? (
            <>
              Tu veux juste jouer ?
              <button type="button" onClick={() => setMode("signup")}>
                Inscription client
              </button>
            </>
          ) : (
            // mode === "reset"
            <>
              Tu as retrouvé ton mot de passe ?
              <button type="button" onClick={() => setMode("signin")}>
                Connexion
              </button>
            </>
          )}
        </div>
        {/* CHANTIER 1B.4 — lien mot de passe oublié (mode signin uniquement). */}
        {mode === "signin" && (
          <div className="kg-auth-forgot">
            <button type="button" onClick={() => setMode("reset")}>
              Mot de passe oublié ?
            </button>
          </div>
        )}
        {/* CHANTIER 1B.5 — bascule vers candidature staff (mode signup uniquement). */}
        {mode === "signup" && (
          <div className="kg-auth-forgot">
            <button type="button" onClick={() => setMode("signup-staff")}>
              👔 Tu veux travailler dans une salle ? Candidature staff
            </button>
          </div>
        )}
        <div className="kg-auth-back">
          <Link to="/">← Retour à l&apos;accueil</Link>
        </div>
      </section>
    </main>
  );
}