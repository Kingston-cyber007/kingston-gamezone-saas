// ================================================================
// CHANTIER 2 B.2 — Edge Function Deno : cinetpay-webhook
// ================================================================
// Date : 2026-08-15
// Périmètre : reçoit les notifications CinetPay (notify_url) et
// synchronise le statut réel du paiement dans payments + reservations.
//
// Décisions actées (cf. memory/chantier2-reservation-paiement.md) :
//   - PUBLIC (verify_jwt = false via supabase/config.toml) : CinetPay
//     appelle cette URL sans JWT utilisateur. Sécurité portée par le
//     HMAC x-token + l'appel /v2/payment/check côté serveur.
//   - CinetPay n'envoie JAMAIS le statut dans le webhook (anti man-in-
//     the-middle). On doit toujours rappeler l'API de vérification de
//     transaction pour connaître le vrai statut.
//   - Montant JAMAIS fiable du webhook seul : on recoupe cpm_amount
//     avec payments.amount stocké serveur (règle non-négociable #5).
//   - Idempotent : CinetPay rappelle plusieurs fois. Si payment déjà
//     'success', on ne réécrit rien (retour 200).
//
// Réponse : TOUJOURS 200 sur une requête traitée (CinetPay considère
// un non-200 comme un échec et réessaie). 400 uniquement si le HMAC
// échoue ou le montant est incohérent (visible dans le log dashboard).
//
// Runtime : Deno (Supabase Edge Functions). supabase-js via npm:.
// ================================================================

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@^2.45.0";

// URL de vérification de transaction CinetPay (v2).
const CINETPAY_CHECK_URL = "https://api-checkout.cinetpay.com/v2/payment/check";

// Statut CinetPay pour un paiement accepté.
const CINETPAY_STATUS_ACCEPTED = "ACCEPTED";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // CinetPay ping la notify_url en GET pour vérifier sa disponibilité.
  // La doc exige que l'URL réponde 200 OK en GET ET POST.
  if (req.method === "GET") {
    return new Response("ok", { status: 200 });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  if (!SUPABASE_URL) {
    console.error("[KG cinetpay-webhook] SUPABASE_URL manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) {
    console.error("[KG cinetpay-webhook] SUPABASE_SERVICE_ROLE_KEY manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }
  const CINETPAY_SECRET_KEY = Deno.env.get("CINETPAY_SECRET_KEY");
  if (!CINETPAY_SECRET_KEY) {
    console.error("[KG cinetpay-webhook] CINETPAY_SECRET_KEY manquant");
    return jsonResponse(
      { error: "CinetPay non configuré. AE-1 manquant : CINETPAY_SECRET_KEY." },
      503,
    );
  }
  const CINETPAY_API_KEY = Deno.env.get("CINETPAY_API_KEY");
  const CINETPAY_SITE_ID = Deno.env.get("CINETPAY_SITE_ID");
  if (!CINETPAY_API_KEY || !CINETPAY_SITE_ID) {
    console.error("[KG cinetpay-webhook] CINETPAY_API_KEY ou CINETPAY_SITE_ID manquant");
    return jsonResponse(
      { error: "CinetPay non configuré. AE-1 manquant : credentials sandbox." },
      503,
    );
  }

  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ----------------------------------------------------------------
    // 1. Parse le corps form-urlencoded (format CinetPay, PAS JSON).
    // ----------------------------------------------------------------
    const rawBody = await req.text();
    const params = new URLSearchParams(rawBody);

    const cpmTransId = params.get("cpm_trans_id") ?? "";
    const cpmSiteId = params.get("cpm_site_id") ?? "";
    const cpmAmount = params.get("cpm_amount") ?? "";
    const cpmCurrency = params.get("cpm_currency") ?? "";
    const cpmCustom = params.get("cpm_custom") ?? "";

    if (!cpmTransId || !cpmSiteId) {
      console.warn("[KG cinetpay-webhook] cpm_trans_id ou cpm_site_id manquant");
      return jsonResponse({ error: "Payload incomplet" }, 400);
    }

    // ----------------------------------------------------------------
    // 2. Vérification HMAC x-token (doc officielle /api/1.0-en/checkout/hmac).
    //    Concaténation des 16 champs POST dans l'ordre officiel, puis
    //    HMAC-SHA256 avec la clé secrète marchand.
    // ----------------------------------------------------------------
    const dataToSign = [
      params.get("cpm_site_id") ?? "",
      params.get("cpm_trans_id") ?? "",
      params.get("cpm_trans_date") ?? "",
      params.get("cpm_amount") ?? "",
      params.get("cpm_currency") ?? "",
      params.get("signature") ?? "",
      params.get("payment_method") ?? "",
      params.get("cel_phone_num") ?? "",
      params.get("cpm_phone_prefixe") ?? "",
      params.get("cpm_language") ?? "",
      params.get("cpm_version") ?? "",
      params.get("cpm_payment_config") ?? "",
      params.get("cpm_page_action") ?? "",
      params.get("cpm_custom") ?? "",
      params.get("cpm_designation") ?? "",
      params.get("cpm_error_message") ?? "",
    ].join("");

    const receivedToken = req.headers.get("x-token") ?? "";
    if (!receivedToken) {
      console.warn("[KG cinetpay-webhook] Header x-token manquant");
      return jsonResponse({ error: "Token manquant" }, 401);
    }

    const keyBytes = new TextEncoder().encode(CINETPAY_SECRET_KEY);
    const dataBytes = new TextEncoder().encode(dataToSign);
    const hmacKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign("HMAC", hmacKey, dataBytes);
    const expectedToken = bytesToHex(new Uint8Array(signature));

    if (!timingSafeEqual(receivedToken, expectedToken)) {
      console.warn(
        `[KG cinetpay-webhook] HMAC invalide. trans=${cpmTransId}, site=${cpmSiteId}`,
      );
      return jsonResponse({ error: "Signature invalide" }, 401);
    }

    // ----------------------------------------------------------------
    // 3. Localiser le payment par transaction_id (celui généré par
    //    create-payment-intent et envoyé à CinetPay).
    // ----------------------------------------------------------------
    const { data: payment, error: payLookupErr } = await serviceClient
      .from("payments")
      .select("id, reservation_id, amount, status, metadata")
      .eq("transaction_id", cpmTransId)
      .maybeSingle();

    if (payLookupErr) {
      console.error("[KG cinetpay-webhook] lookup payment error:", payLookupErr);
      return jsonResponse({ error: "Erreur interne lookup" }, 500);
    }

    if (!payment) {
      // Transaction inconnue localement : HMAC valide (c'est bien CinetPay)
      // mais aucun payment correspondant. Cas d'edge : paiement pour une
      // réservation supprimée, ou initié depuis un autre site_id. On logge
      // et on renvoie 200 pour ne pas déclencher les retries CinetPay.
      console.warn(
        `[KG cinetpay-webhook] Transaction inconnue localement: trans=${cpmTransId}, site=${cpmSiteId}`,
      );
      return jsonResponse({ accepted: true }, 200);
    }

    // Idempotence : si déjà success, ne rien réécrire (CinetPay rappelle).
    if (payment.status === "success") {
      return jsonResponse({ accepted: true, already_success: true }, 200);
    }

    // ----------------------------------------------------------------
    // 4. Recoupe du montant (règle non-négociable #5).
    //    Le webhook seul ne fait pas foi : le montant DOIT matcher
    //    payments.amount stocké serveur par create-payment-intent.
    // ----------------------------------------------------------------
    const webhookAmount = Number(cpmAmount);
    if (!Number.isFinite(webhookAmount) || webhookAmount !== payment.amount) {
      console.error(
        `[KG cinetpay-webhook] CRITICAL: amount mismatch. trans=${cpmTransId}, ` +
          `webhook=${cpmAmount} (${cpmCurrency}), db=${payment.amount}. ` +
          `Paiement potentiellement altéré.`,
      );
      return jsonResponse({ error: "Montant incohérent" }, 400);
    }

    // ----------------------------------------------------------------
    // 5. Rappel de l'API de vérification de transaction (source de vérité).
    //    Le webhook ne transporte PAS le statut — on le récupère ici.
    // ----------------------------------------------------------------
    const checkResponse = await fetch(CINETPAY_CHECK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apikey: CINETPAY_API_KEY,
        site_id: CINETPAY_SITE_ID,
        transaction_id: cpmTransId,
      }),
    });

    let checkData: { code?: unknown; message?: unknown; data?: Record<string, unknown> } = {};
    try {
      checkData = await checkResponse.json();
    } catch (_e) {
      checkData = {};
    }

    if (!checkResponse.ok) {
      console.error(
        `[KG cinetpay-webhook] /payment/check HTTP ${checkResponse.status}:`,
        checkData,
      );
      return jsonResponse({ error: "Échec vérification transaction" }, 502);
    }

    // Structure CinetPay /v2/payment/check : { code, message, data: { status, ... } }
    const remoteStatus: string = String(
      (checkData?.data as Record<string, unknown> | undefined)?.status ?? "",
    ).toUpperCase();

    if (!remoteStatus) {
      console.error("[KG cinetpay-webhook] /payment/check sans status:", checkData);
      return jsonResponse({ error: "Vérification transaction sans statut" }, 502);
    }

    const isAccepted = remoteStatus === CINETPAY_STATUS_ACCEPTED;

    // ----------------------------------------------------------------
    // 6. Mise à jour payments + reservations (service_role).
    // ----------------------------------------------------------------
    if (isAccepted) {
      const { error: payUpdErr } = await serviceClient
        .from("payments")
        .update({
          status: "success",
          metadata: {
            ...(payment.metadata as Record<string, unknown> | null),
            cinetpay_check: checkData,
            cinetpay_status: remoteStatus,
            notified_at: new Date().toISOString(),
          },
        })
        .eq("id", payment.id);

      if (payUpdErr) {
        console.error("[KG cinetpay-webhook] UPDATE payment success error:", payUpdErr);
        return jsonResponse({ error: "Erreur mise à jour payment" }, 500);
      }

      const { error: resUpdErr } = await serviceClient
        .from("reservations")
        .update({
          statut: "confirmee",
          montant_paye: payment.amount,
          transaction_id: cpmTransId,
        })
        .eq("id", payment.reservation_id);

      if (resUpdErr) {
        console.error("[KG cinetpay-webhook] UPDATE reservation success error:", resUpdErr);
        return jsonResponse({ error: "Erreur mise à jour réservation" }, 500);
      }

      console.info(
        `[KG cinetpay-webhook] Paiement confirmé: trans=${cpmTransId}, reservation=${payment.reservation_id}, montant=${payment.amount}`,
      );
      return jsonResponse({ accepted: true, status: "success" }, 200);
    }

    // Statut remote non-ACCEPTED : paiement échoué / expiré / annulé.
    const { error: payFailErr } = await serviceClient
      .from("payments")
      .update({
        status: "failed",
        metadata: {
          ...(payment.metadata as Record<string, unknown> | null),
          cinetpay_check: checkData,
          cinetpay_status: remoteStatus,
          notified_at: new Date().toISOString(),
        },
      })
      .eq("id", payment.id);

    if (payFailErr) {
      console.error("[KG cinetpay-webhook] UPDATE payment failed error:", payFailErr);
      return jsonResponse({ error: "Erreur mise à jour payment" }, 500);
    }

    const { error: resFailErr } = await serviceClient
      .from("reservations")
      .update({ statut: "annulee" })
      .eq("id", payment.reservation_id);

    if (resFailErr) {
      console.error("[KG cinetpay-webhook] UPDATE reservation failed error:", resFailErr);
      return jsonResponse({ error: "Erreur mise à jour réservation" }, 500);
    }

    console.info(
      `[KG cinetpay-webhook] Paiement échoué: trans=${cpmTransId}, statut=${remoteStatus}`,
    );
    return jsonResponse({ accepted: true, status: "failed" }, 200);
  } catch (e) {
    console.error("[KG cinetpay-webhook] exception non gérée:", e);
    return jsonResponse(
      { error: "Erreur interne", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});

// Conversion hex basse-latence (le token attendu est en minuscules).
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

// Comparaison à temps constant (anti timing-attack) sur des hex lowercase.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
