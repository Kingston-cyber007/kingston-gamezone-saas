// ================================================================
// CHANTIER 3 B.2 — Edge Function Deno : restore-account-admin
// ================================================================
// Date : 2026-08-10
// Périmètre : FEAT-2 (admin restaure un compte soft-deleted pendant la
// fenêtre 30j). Admin-only, pas d'auto-restauration.
//
// Décisions actées (cf. memory/chantier3-delete-account.md) :
//  - JWT REQUIRED (verify_jwt = true).
//  - Admin-only : check_platform_admin(caller.id) requis.
//  - Pas de self-restore : un platform_admin actif n'a jamais deleted_at
//    IS NOT NULL, donc restore_deleted_profile() lèvera de toute façon
//    une exception. Pas besoin de check explicite.
//  - Body obligatoire : { target_user_id }. Pas de fallback self (à la
//    différence de delete-own-account).
//  - restore_deleted_profile(target) est atomique côté SQL (UPDATE profiles
//    + UPDATE auth.users dans la même transaction, SECURITY DEFINER).
//    Pas d'état partiel à rollback.
//  - Si la fonction lève exception (profil jamais supprimé ou déjà
//    anonymisé) → 422 avec code "not_restorable" et message explicite.
//    Un profil passé par le cron purge (anonymized_at IS NOT NULL) ne
//    ressuscite JAMAIS (cf. commentaire migration 20260808220000 PARTIE 4).
//
// Réponse succès 200 : { restored_at, was_anonymized, target_user_id }.
//
// Runtime : Deno (Supabase Edge Functions). supabase-js chargé via npm:.
// ================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Preflight CORS — obligatoire pour les appels cross-origin depuis le browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  if (!SUPABASE_URL) {
    console.error("[KG restore-account-admin] SUPABASE_URL manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }

  // Client "caller" — JWT transmis dans Authorization, lu pour vérifier
  // l'identité et le rôle platform_admin.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResponse({ error: "JWT manquant" }, 401);
  }
  const callerClient: SupabaseClient = createClient(
    SUPABASE_URL,
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );

  // Client "service" — service_role. Utilisé pour appeler
  // restore_deleted_profile() (GRANT EXECUTE limité à service_role).
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) {
    console.error("[KG restore-account-admin] SUPABASE_SERVICE_ROLE_KEY manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1. Vérifier le JWT et récupérer le caller.
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      console.warn("[KG restore-account-admin] JWT invalide:", userErr?.message);
      return jsonResponse({ error: "JWT invalide ou expiré" }, 401);
    }
    const callerId = userData.user.id;

    // 2. Parse body — target_user_id OBLIGATOIRE (pas de self-restore).
    let body: { target_user_id?: string } = {};
    try {
      body = await req.json();
    } catch (_e) {
      body = {};
    }
    const targetId = typeof body.target_user_id === "string"
      ? body.target_user_id.trim()
      : "";
    if (!targetId) {
      return jsonResponse(
        { error: "target_user_id requis (admin-only, pas d'auto-restauration)" },
        400,
      );
    }

    // 3. Vérifier que le caller est platform_admin.
    const { data: callerIsAdmin, error: adminErr } = await serviceClient
      .rpc("check_platform_admin", { _user_id: callerId });
    if (adminErr) {
      console.error("[KG restore-account-admin] check_platform_admin error:", adminErr);
      return jsonResponse({ error: "Erreur vérification rôle" }, 500);
    }
    if (callerIsAdmin !== true) {
      return jsonResponse({ error: "Réservé aux platform_admins" }, 403);
    }

    // 4. Appel restore_deleted_profile(target). SECURITY DEFINER côté SQL,
    //    GRANT EXECUTE limité à service_role → la Edge Function est le seul
    //    point d'entrée légitime. Si la fonction lève exception (profil
    //    jamais supprimé ou déjà anonymisé), on récupère le message via
    //    sdErr.message pour le renvoyer au client.
    const { data: rdData, error: rdErr } = await serviceClient
      .rpc("restore_deleted_profile", { _user_id: targetId });
    if (rdErr) {
      console.error("[KG restore-account-admin] restore_deleted_profile error:", rdErr);
      // Exception SQL attendue : "Profile <uuid> n'est pas restaurable".
      // On distingue 422 (état non éligible à restauration) des 500 (erreur
      // technique inattendue). restore_deleted_profile ne lève QUE l'exception
      // prévue, donc on retourne 422 systématiquement sur erreur ici.
      return jsonResponse(
        {
          error: "Compte non restaurable (déjà anonymisé, jamais supprimé, ou inexistant).",
          code: "not_restorable",
          detail: rdErr.message,
          target_user_id: targetId,
        },
        422,
      );
    }
    const rdRow = Array.isArray(rdData) ? rdData[0] : null;
    if (!rdRow) {
      return jsonResponse({ error: "restore_deleted_profile a renvoyé vide" }, 500);
    }

    return jsonResponse(
      {
        target_user_id: targetId,
        restored_at: rdRow.restored_at,
        was_anonymized: rdRow.was_anonymized === true,
      },
      200,
    );
  } catch (e) {
    console.error("[KG restore-account-admin] exception non gérée:", e);
    return jsonResponse(
      { error: "Erreur interne", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});