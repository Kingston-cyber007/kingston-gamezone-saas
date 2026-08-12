// ================================================================
// CHANTIER 2 B.1 — Edge Function Deno : create-payment-intent
// ================================================================
// Date : 2026-08-12
// Périmètre : crée un "payment intent" CinetPay pour une réservation.
//
// Décisions actées (cf. memory/chantier2-reservation-paiement.md) :
//   - JWT REQUIRED (verify_jwt = true via supabase/config.toml).
//   - Montant JAMAIS lu du client. Recalculé serveur via
//     compute_reservation_price RPC juste avant l'appel CinetPay.
//   - Idempotency key (UUID v4 généré client) — anti double-clic.
//   - Signature webhook vérifiée côté B.2 (cinetpay-webhook), pas ici.
//   - Fees CinetPay absorbés par la salle — pas de ligne "frais" envoyée.
//   - Sandbox d'abord, bascule prod après E.2 validé.
//   - 6 règles de sécurité NON-NÉGOCIABLES (cf. brief) respectées :
//     1. Montant JAMAIS du client → RPC serveur
//     2. Écran de confirmation UI (côté client) avec montant exact
//     3. Vérif signature webhook (B.2, pas ici)
//     4. Idempotency key sur appel paiement
//     5. Double-check montant serveur == montant webhook (B.2)
//     6. JAMAIS de carte brute dans l'app → page hébergée CinetPay
//
// Réponse succès 200 : { payment_url, transaction_id, amount, expires_at }.
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

// URL de l'API CinetPay — sandbox d'abord, bascule prod après E.2 validé.
// Sandbox : https://api-checkout.cinetpay.com/v2/payment
// Prod    : identique (CinetPay route selon les clés API).
const CINETPAY_CHECKOUT_URL = "https://api-checkout.cinetpay.com/v2/payment";

// Canaux de paiement autorisés (synchronisés avec l'enum payment_method étendu).
// Airtel Money, MTN Money, Carte bancaire. Cash exclu (géré côté caisse physique).
const CINETPAY_CHANNELS = "MOBILE_MONEY,CREDIT_CARD";

Deno.serve(async (req: Request) => {
  // Preflight CORS — obligatoire pour les appels cross-origin depuis le browser.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // ----------------------------------------------------------------
  // 1. Configuration : URL + clés service (service_role pour INSERT)
  // ----------------------------------------------------------------
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  if (!SUPABASE_URL) {
    console.error("[KG create-payment-intent] SUPABASE_URL manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }

  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SERVICE_ROLE_KEY) {
    console.error("[KG create-payment-intent] SUPABASE_SERVICE_ROLE_KEY manquant");
    return jsonResponse({ error: "Configuration serveur incomplète" }, 500);
  }

  // CinetPay — credentials lues via Deno.env (jamais hardcodées).
  // AE-1 (Yannick) : fournir CINETPAY_API_KEY + CINETPAY_SITE_ID.
  const CINETPAY_API_KEY = Deno.env.get("CINETPAY_API_KEY");
  const CINETPAY_SITE_ID = Deno.env.get("CINETPAY_SITE_ID");
  if (!CINETPAY_API_KEY || !CINETPAY_SITE_ID) {
    console.error(
      "[KG create-payment-intent] CINETPAY_API_KEY ou CINETPAY_SITE_ID manquant",
    );
    return jsonResponse(
      {
        error:
          "CinetPay non configuré. AE-1 manquant : credentials sandbox à fournir.",
        code: "cinetpay_not_configured",
      },
      503,
    );
  }

  // ----------------------------------------------------------------
  // 2. Client "caller" — porte le JWT de l'utilisateur.
  //    Utilisé pour getUser() → auth.uid() côté serveur.
  // ----------------------------------------------------------------
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

  // Client "service" — service_role. Utilisé pour INSERT dans
  // idempotency_keys et payments (RLS bloque authenticated).
  const serviceClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // ----------------------------------------------------------------
    // 3. Vérifier JWT et récupérer le caller.
    // ----------------------------------------------------------------
    const { data: userData, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !userData?.user?.id) {
      console.warn("[KG create-payment-intent] JWT invalide:", userErr?.message);
      return jsonResponse({ error: "JWT invalide ou expiré" }, 401);
    }
    const callerId = userData.user.id;

    // ----------------------------------------------------------------
    // 4. Parse body et valider les inputs.
    //    Champs attendus :
    //      - tenant_id       : uuid (le tenant de la salle)
    //      - poste_id        : uuid
    //      - date_heure      : ISO 8601 timestamptz
    //      - duree_min       : integer (>= 30, vérifié côté RPC)
    //      - jeu             : string (optionnel)
    //      - console         : string (optionnel, ex: "PS5")
    //      - payment_method  : 'airtel_money' | 'mtn_money' | 'carte'
    //      - idempotency_key : uuid (généré client, anti double-clic)
    // ----------------------------------------------------------------
    let body: {
      tenant_id?: string;
      poste_id?: string;
      date_heure?: string;
      duree_min?: number;
      jeu?: string;
      console?: string;
      payment_method?: "airtel_money" | "mtn_money" | "carte";
      idempotency_key?: string;
    } = {};
    try {
      body = await req.json();
    } catch (_e) {
      return jsonResponse({ error: "Body JSON invalide" }, 400);
    }

    const {
      tenant_id,
      poste_id,
      date_heure,
      duree_min,
      jeu,
      console: consoleType,
      payment_method,
      idempotency_key,
    } = body;

    // Validation minimale côté Edge (la RPC re-valide côté DB).
    if (!tenant_id || !poste_id || !date_heure || !duree_min || !payment_method || !idempotency_key) {
      return jsonResponse(
        {
          error: "Champs requis manquants",
          required: ["tenant_id", "poste_id", "date_heure", "duree_min", "payment_method", "idempotency_key"],
        },
        400,
      );
    }
    if (!["airtel_money", "mtn_money", "carte"].includes(payment_method)) {
      return jsonResponse(
        { error: "payment_method invalide. Attendus : airtel_money, mtn_money, carte" },
        400,
      );
    }
    if (typeof duree_min !== "number" || duree_min < 30 || duree_min > 1440) {
      return jsonResponse(
        { error: "duree_min doit être entre 30 et 1440 minutes" },
        400,
      );
    }

    // Validation format UUID v4 pour idempotency_key (anti-injection).
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidV4Regex.test(idempotency_key)) {
      return jsonResponse(
        { error: "idempotency_key doit être un UUID v4" },
        400,
      );
    }

    // ----------------------------------------------------------------
    // 5. Vérifier idempotency : si la clé existe DÉJÀ pour ce user+endpoint,
    //    retourner le payment_url mis en cache (anti double-clic).
    // ----------------------------------------------------------------
    const { data: existingKey, error: idemErr } = await serviceClient
      .from("idempotency_keys")
      .select("payment_url, reservation_id, expires_at")
      .eq("user_id", callerId)
      .eq("key", idempotency_key)
      .eq("endpoint", "create-payment-intent")
      .maybeSingle();

    if (idemErr) {
      console.error("[KG create-payment-intent] idempotency lookup error:", idemErr);
      return jsonResponse({ error: "Erreur vérification idempotency" }, 500);
    }
    if (existingKey) {
      // Vérifier expiration.
      if (new Date(existingKey.expires_at) > new Date()) {
        console.info(
          `[KG create-payment-intent] Idempotency hit pour user=${callerId}, key=${idempotency_key}`,
        );
        return jsonResponse(
          {
            payment_url: existingKey.payment_url,
            reservation_id: existingKey.reservation_id,
            replayed: true,
          },
          200,
        );
      }
      // Clé expirée → on continue (nouvelle tentative autorisée).
    }

    // ----------------------------------------------------------------
    // 6. RECALCUL SERVEUR DU PRIX (règle non-négociable #1).
    //    Le client n'envoie JAMAIS de montant. La RPC lit tenant_settings.prices
    //    et custom_price_per_minute pour calculer le prix exact.
    // ----------------------------------------------------------------
    const { data: priceData, error: priceErr } = await serviceClient.rpc(
      "compute_reservation_price",
      { _tenant_id: tenant_id, _duree_min: duree_min },
    );

    if (priceErr) {
      console.error("[KG create-payment-intent] compute_reservation_price error:", priceErr);
      return jsonResponse(
        { error: "Erreur calcul prix serveur", detail: priceErr.message },
        500,
      );
    }
    const amount: number = priceData as number;
    if (typeof amount !== "number" || amount <= 0) {
      console.error(
        `[KG create-payment-intent] Prix invalide pour tenant=${tenant_id}, duree=${duree_min}: ${amount}`,
      );
      return jsonResponse(
        {
          error: "Prix non calculable (tenant_settings absent ou prix = 0).",
          code: "price_unavailable",
        },
        422,
      );
    }

    // ----------------------------------------------------------------
    // 7. Créer la réservation en status 'en_attente' (avant paiement).
    //    Le trigger check_reservation_overlap (A.5) refuse si conflit.
    //    Le trigger prevent_underage_reservation refuse si mineur.
    // ----------------------------------------------------------------
    const { data: reservationData, error: resErr } = await serviceClient
      .from("reservations")
      .insert({
        client_id: callerId,
        tenant_id,
        poste_id,
        date_heure,
        duree_min,
        jeu: jeu ?? null,
        console: consoleType ?? null,
        montant_prevu: amount,
        statut: "en_attente",
        mode_paiement: payment_method,
      })
      .select("id")
      .single();

    if (resErr) {
      console.error("[KG create-payment-intent] INSERT reservation error:", resErr);
      // Le trigger overlap renvoie exclusion_violation, le trigger mineur check_violation.
      const isOverlap = resErr.code === "exclusion_violation";
      const isMinor = resErr.code === "check_violation" && resErr.message.includes("mineur");
      return jsonResponse(
        {
          error: isOverlap
            ? "Créneau déjà réservé. Choisissez un autre horaire."
            : isMinor
            ? "Réservation en ligne interdite aux mineurs (< 18 ans). Passage en salle avec paiement cash uniquement."
            : "Échec création réservation",
          detail: resErr.message,
          code: isOverlap ? "slot_conflict" : isMinor ? "underage" : "reservation_insert_failed",
        },
        isOverlap ? 409 : isMinor ? 403 : 500,
      );
    }
    const reservationId: string = reservationData.id;

    // ----------------------------------------------------------------
    // 8. Appeler l'API CinetPay pour générer le payment_url.
    //    Format de la requête (v2 API CinetPay) :
    //      apikey, site_id, transaction_id (uuid), amount, currency=XOF,
    //      description, return_url, notify_url, channels, metadata (json string).
    // ----------------------------------------------------------------
    // Générer un transaction_id CinetPay (UUID v4 distinct de l'idempotency_key).
    const cinetpayTransactionId = crypto.randomUUID();

    const notifyUrl = `${SUPABASE_URL}/functions/v1/cinetpay-webhook`;

    const cinetpayPayload = {
      apikey: CINETPAY_API_KEY,
      site_id: CINETPAY_SITE_ID,
      transaction_id: cinetpayTransactionId,
      amount: amount,
      currency: "XOF",
      description: `Réservation gaming lounge - ${duree_min} min`,
      return_url: `${req.headers.get("origin") ?? "https://kingstongamezone.com"}/client/mes-reservations?status=success`,
      notify_url: notifyUrl,
      channels: CINETPAY_CHANNELS,
      metadata: JSON.stringify({
        reservation_id: reservationId,
        tenant_id,
        caller_id: callerId,
        payment_method,
      }),
    };

    const cinetpayRes = await fetch(CINETPAY_CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cinetpayPayload),
    });

    const cinetpayData = await cinetpayRes.json();

    // CinetPay renvoie { code: 201, message: "OK", data: { payment_url, payment_token } } en cas de succès.
    if (cinetpayRes.status !== 201 || cinetpayData?.code !== 201 || !cinetpayData?.data?.payment_url) {
      console.error(
        "[KG create-payment-intent] CinetPay API error:",
        cinetpayRes.status,
        cinetpayData,
      );
      // Rollback : supprimer la réservation créée (état 'en_attente' sans paiement).
      await serviceClient.from("reservations").delete().eq("id", reservationId);
      return jsonResponse(
        {
          error: "Échec génération URL paiement CinetPay",
          detail: cinetpayData?.message ?? "Unknown error",
          code: "cinetpay_api_error",
        },
        502,
      );
    }

    const paymentUrl: string = cinetpayData.data.payment_url;

    // ----------------------------------------------------------------
    // 9. Insérer le payment (status=pending) et la idempotency_key.
    //    Le webhook B.2 mettra à jour payment.status='success' + reservation.statut='confirmee'.
    // ----------------------------------------------------------------
    const { error: payErr } = await serviceClient.from("payments").insert({
      tenant_id,
      reservation_id: reservationId,
      client_id: callerId,
      provider: "cinetpay",
      transaction_id: cinetpayTransactionId,
      payment_url: paymentUrl,
      status: "pending",
      amount: amount,
      payment_method,
      metadata: {
        cinetpay_payment_token: cinetpayData.data.payment_token ?? null,
        channels: CINETPAY_CHANNELS,
      },
    });

    if (payErr) {
      console.error("[KG create-payment-intent] INSERT payment error:", payErr);
      // On ne rollback PAS la réservation — l'utilisateur peut retenter.
      return jsonResponse(
        { error: "Échec enregistrement payment", detail: payErr.message },
        500,
      );
    }

    const { error: idemInsErr } = await serviceClient.from("idempotency_keys").insert({
      user_id: callerId,
      key: idempotency_key,
      endpoint: "create-payment-intent",
      payment_url: paymentUrl,
      reservation_id: reservationId,
    });

    if (idemInsErr && idemInsErr.code !== "23505") {
      // 23505 = unique_violation (race condition : 2 requêtes simultanées). OK, on continue.
      console.error("[KG create-payment-intent] INSERT idempotency_key error:", idemInsErr);
    }

    // ----------------------------------------------------------------
    // 10. Réponse succès : l'UI redirige le client vers payment_url.
    // ----------------------------------------------------------------
    return jsonResponse(
      {
        payment_url: paymentUrl,
        transaction_id: cinetpayTransactionId,
        amount: amount,
        currency: "XOF",
        reservation_id: reservationId,
        replayed: false,
      },
      200,
    );
  } catch (e) {
    console.error("[KG create-payment-intent] exception non gérée:", e);
    return jsonResponse(
      { error: "Erreur interne", detail: e instanceof Error ? e.message : String(e) },
      500,
    );
  }
});
