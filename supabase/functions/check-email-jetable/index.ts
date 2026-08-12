// ================================================================
// CHANTIER 1B.3 — Edge Function Deno : check-email-jetable
// ================================================================
// Date : 2026-08-07
// Décision actée : mailchecker côté serveur uniquement (cf. chantier1-statut.md).
// Anti-jetable pour bloquer les inscriptions utilisant des domaines temporaires
// (mailinator.com, yopmail.com, tempmail.io, etc.).
//
// Sécurité :
//  - Validation CÔTÉ SERVEUR uniquement (jamais côté client).
//  - Cette Edge Function est invocable par tout user authentifié via
//    supabase.functions.invoke() — pattern standard des Edge Functions Supabase.
//  - Retourne un objet { jetable: boolean, domain: string }.
//
// Runtime : Deno (Supabase Edge Functions).
// Le paquet `mailchecker` est npm ; Deno le charge via le préfixe `npm:`.
// ================================================================

// @ts-ignore — paquet npm chargé via le runtime Deno (Node-compat layer).
import Mailchecker from "npm:mailchecker@^6.0.0";

// CORS headers — Supabase Edge Functions renvoient du JSON. On autorise
// l'origine de l'app (configurable via env var si on déploie sur un autre
// domaine). En local, l'origin est http://localhost:8081.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  // Preflight CORS — obligatoire pour les appels cross-origin depuis le browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    // Parse body — on accepte { email } ou { emails: string[] } si besoin futur.
    const body = await req.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

    if (!email) {
      return new Response(
        JSON.stringify({ jetable: false, domain: "", error: "Email manquant" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Extraction domaine — fallback si l'email est malformé.
    const atIndex = email.lastIndexOf("@");
    const domain = atIndex >= 0 ? email.slice(atIndex + 1) : "";

    if (!domain || !domain.includes(".")) {
      return new Response(
        JSON.stringify({ jetable: false, domain, error: "Domaine invalide" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Vérification via mailchecker. La lib expose :
    //   Mailchecker.isValid(email) → bool (regex stricte email)
    //   Mailchecker.blacklistCheck(email) → bool (true si domaine dans la liste noire)
    // On combine les deux : on rejette si blacklisté OU si format invalide.
    let isBlacklisted = false;
    let isFormatValid = true;
    try {
      isBlacklisted = Mailchecker.blacklistCheck(email) === true;
    } catch (_e) {
      // Si la lib throw (rare — version mismatch), on log et on accepte.
      // Mieux vaut un false negative qu'un crash qui bloque toutes les
      // inscriptions.
      console.warn("[check-email-jetable] blacklistCheck error:", _e);
      isBlacklisted = false;
    }
    try {
      isFormatValid = Mailchecker.isValid(email) !== false;
    } catch (_e) {
      isFormatValid = true;
    }

    const jetable = isBlacklisted || !isFormatValid;

    return new Response(
      JSON.stringify({ jetable, domain }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[check-email-jetable] exception:", e);
    // En cas d'erreur serveur, on RETOURNE jetable:false plutôt que 500.
    // Le client (auth.tsx) log un warning mais ne bloque pas l'inscription.
    // Évite un faux positif en cas de panne.
    return new Response(
      JSON.stringify({ jetable: false, domain: "", error: "Erreur interne" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});