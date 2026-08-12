// ================================================================
// CHANTIER 3 B.1 — Edge Function Deno : delete-own-account
// ================================================================
// Date : 2026-08-10
// Périmètre : FEAT-1 (auto-suppression) + FEAT-2 (admin suppression tierce).
//
// Décisions actées (cf. memory/chantier3-delete-account.md) :
//  - JWT REQUIRED (verify_jwt = true). On lit l'auth.uid() via supabase.auth.getUser()
//    avec le JWT transmis dans le header Authorization de la requête.
//  - Mode auto-suppression (par défaut) : target = caller.id.
//  - Mode suppression tierce (FEAT-2) : body.target_user_id fourni.
//    → exige check_platform_admin(caller.id) (SECURITY DEFINER).
//    → anti-footgun si target == caller : refuse si caller est le dernier
//      platform_admin (count_platform_admins() = 1).
//  - soft_delete_profile(target) : pose deleted_at + scheduled_purge_at = now() + 30j.
//    PII INTACTES pendant 30j (cf. stratégie C, anonymisation différée via pg_cron).
//  - UPDATE auth.users.banned_until = scheduled_purge_at via service_role.
//    Bloque sign-in côté Supabase Auth pendant exactement la fenêtre 30j.
//    Délégation explicite : la migration soft_delete_profile() ne touche PAS
//    auth.users (commentaire ligne 126 migration 20260808220000).
//  - Si UPDATE banned_until échoue : TENTER rollback du soft_delete
//    (UPDATE profiles.deleted_at=NULL, scheduled_purge_at=NULL). Si le
//    rollback LUI-MÊME échoue : log CRITICAL serveur + réponse 500 avec
//    code "rollback_failed" (état incohérent à vérifier manuellement).
//
// Réponse succès 200 : { deleted_at, scheduled_purge_at, mode: "self" | "admin" }.
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

  // Client "caller" — porte le JWT de l'utilisateur qui appelle la Edge Function.
  // On l'utilise pour getUser() (lecture de l'auth.uid côté serveur).
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  if (!SUPABASE_URL) {
    console.error("[KG delete-own-account] SUPABASE_URL manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }

  // Client "caller" — utilise l'Anon Key + le JWT transmis dans Authorization.
  // supabase-js extrait le user du JWT, pas besoin de le lire à la main.
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

  // Client "service" — service_role. Utilisé pour UPDATE auth.users (interdit
  // aux users normaux, même platform_admin — RLS ne le permet pas).
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) {
    console.error("[KG delete-own-account] SUPABASE_SERVICE_ROLE_KEY manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1. Vérifier le JWT et récupérer le caller.
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      console.warn("[KG delete-own-account] JWT invalide:", userErr?.message);
      return jsonResponse({ error: "JWT invalide ou expiré" }, 401);
    }
    const callerId = userData.user.id;

    // 2. Parse body et déterminer la cible.
    let body: { target_user_id?: string } = {};
    try {
      body = await req.json();
    } catch (_e) {
      // Body vide → auto-suppression par défaut.
      body = {};
    }
    const targetId: string = body.target_user_id ?? callerId;
    const isSelfDelete = targetId === callerId;

    // 3. Vérifier le rôle platform_admin du caller (toujours, pour les 2 modes).
    //    - Mode admin (target != caller) : requis pour autoriser la suppression.
    //    - Mode self : sert juste à l'anti-footgun (vérifier qu'on n'est pas
    //      le dernier admin avant de s'auto-supprimer).
    const { data: callerIsAdmin, error: adminErr } = await serviceClient
      .rpc("check_platform_admin", { _user_id: callerId });
    if (adminErr) {
      console.error("[KG delete-own-account] check_platform_admin error:", adminErr);
      return jsonResponse({ error: "Erreur vérification rôle" }, 500);
    }
    const isCallerAdmin = callerIsAdmin === true;

    if (!isSelfDelete && !isCallerAdmin) {
      return jsonResponse({ error: "Réservé aux platform_admins" }, 403);
    }

    // 4. Anti-footgun : si l'admin s'auto-supprime, bloquer si dernier admin.
    if (isSelfDelete && isCallerAdmin) {
      const { data: adminCount, error: countErr } = await serviceClient
        .rpc("count_platform_admins");
      if (countErr) {
        console.error("[KG delete-own-account] count_platform_admins error:", countErr);
        return jsonResponse({ error: "Erreur anti-footgun" }, 500);
      }
      if (typeof adminCount === "number" && adminCount <= 1) {
        return jsonResponse(
          {
            error: "Impossible : vous êtes le dernier platform_admin.",
            code: "last_admin",
          },
          409,
        );
      }
    }

    // 5. Soft-delete profile (deleted_at + scheduled_purge_at).
    const { data: sdData, error: sdErr } = await serviceClient
      .rpc("soft_delete_profile", { _user_id: targetId });
    if (sdErr) {
      console.error("[KG delete-own-account] soft_delete_profile error:", sdErr);
      return jsonResponse({ error: "Échec soft_delete_profile", detail: sdErr.message }, 500);
    }
    const sdRow = Array.isArray(sdData) ? sdData[0] : null;
    if (!sdRow) {
      return jsonResponse({ error: "soft_delete_profile a renvoyé vide" }, 500);
    }
    const deletedAt: string = sdRow.deleted_at;
    const scheduledPurgeAt: string = sdRow.scheduled_purge_at;
    const alreadyDeleted: boolean = sdRow.already_deleted === true;

    // 6. UPDATE auth.users.banned_until = scheduled_purge_at via service_role.
    const { error: banErr } = await serviceClient.auth.admin.updateUserById(
      targetId,
      { ban_duration: computeBanDuration(scheduledPurgeAt) },
    );
    if (banErr) {
      console.error(
        "[KG delete-own-account] updateUserById (banned_until) error:",
        banErr,
      );

      // 7. ROLLBACK du soft_delete.
      const { error: rbErr } = await serviceClient
        .from("profiles")
        .update({ deleted_at: null, scheduled_purge_at: null })
        .eq("id", targetId);

      if (rbErr) {
        // ROLLBACK LUI-MÊME ÉCHOUÉ — état incohérent.
        console.error(
          `[KG delete-own-account] CRITICAL: rollback failed for target=${targetId}. ` +
            `Profil peut être soft-deleted sans banned_until posé. ` +
            `État à vérifier manuellement. RB error:`,
          rbErr,
        );
        return jsonResponse(
          {
            error: "Suppression partielle : profil marqué supprimé mais sign-in non bloqué. Intervention manuelle requise.",
            code: "rollback_failed",
            target_user_id: targetId,
            rollback_error: rbErr.message,
          },
          500,
        );
      }

      return jsonResponse(
        {
          error: "Échec blocage sign-in. Aucune modification appliquée.",
          detail: banErr.message,
        },
        500,
      );
    }

    return jsonResponse(
      {
        deleted_at: deletedAt,
        scheduled_purge_at: scheduledPurgeAt,
        already_deleted: alreadyDeleted,
        mode: isSelfDelete ? "self" : "admin",
      },
      200,
    );
  } catch (e) {
    console.error("[KG delete-own-account] exception non gérée:", e);
    return jsonResponse(
      { error: "Erreur interne", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});

// Formate la durée de ban entre maintenant et scheduled_purge_at au format
// attendu par `ban_duration` de supabase-js : chaîne avec unités
// (`"ns"`, `"us"`, `"ms"`, `"s"`, `"m"`, `"h"`). NOTE : `"y"` (year) n'est PAS
// supporté — d'où la conversion en heures + minutes.
function computeBanDuration(scheduledPurgeAt: string): string {
  const target = new Date(scheduledPurgeAt).getTime();
  const now = Date.now();
  const diffSeconds = Math.max(0, Math.floor((target - now) / 1000));
  const hours = Math.floor(diffSeconds / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  // Granularité préférée : heures + minutes (évite secondes inutiles).
  // Pour 30 jours = 720h, ce format tient largement.
  return `${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
}
