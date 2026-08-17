# CHANTIER 2 — Réservation en ligne + paiement CinetPay

> **Statut du fichier** : reconstruit le 16/08/2026 depuis la migration
> `20260812000000_10_chantier2_paiement.sql` + Edge Functions `create-payment-intent`
> et `cinetpay-webhook`. Le 16/08 le refund CinetPay a été diagnostiqué comme
> **fonctionnalité manquante** (section C) et l'index GiST comme **erreur réelle
> d'immutabilité** (Points d'attention). Les sections **⚠️ à compléter** demandent
> le contexte business de Yannick (flow d'annulation UI, choix Phase
> Actuelle/Phase Future).

## Décisions actées (cf. header migration + edge functions)

1. **CinetPay retenu** — Airtel Money + MTN Money + carte bancaire.
   Enum `public.payment_method` étendu avec `'carte'` (préambule migration,
   DO block + EXCEPTION, idempotent).
2. **Montant JAMAIS lu depuis le client** — recalculé serveur via RPC
   `compute_reservation_price` (SECURITY DEFINER, `search_path = ''`) depuis
   `tenant_settings.prices` (JSON, clés textuelles). Fallback
   `custom_price_per_minute * duree_min` si la durée est hors grille.
   Tenant sans settings → RPC retourne 0 → l'Edge refuse l'appel (pas de
   fallback arbitraire). C'est la **source de vérité du prix**.
3. **ReservationPicker = composant dédié** (pas de réutilisation de SessionModal).
4. **Durée min 30 min** — CHECK constraint en base (`>= 30 AND <= 1440`),
   renforcée en A.4 (décision #4) ET re-vérifiée dans la RPC.
5. **Vérification conflit dispo temps réel AVANT paiement** — trigger
   `check_reservation_overlap` (A.5) : tstzrange `[)`, ignore les statuts
   `annulee`/`honoree`/`reportee`, ignore soi-même en UPDATE. Refuse en
   `exclusion_violation` (409 côté API).
6. **Console `en_reparation` → poste indisponible** (trigger déjà en place
   depuis CHANTIER 1 — pas de re-création).
7. **Politique report/annulation symétrique stricte >1h / <1h**.
8. **Idempotency key sur appel paiement** (anti double-clic).
9. **Refund intégral CinetPay si annulation >1h, 0 si <1h**.
10. **Fees CinetPay absorbés par la salle** — pas de ligne « frais » côté UI.
11. **Granularité : `tenant_settings.prices` JSON** `{30,60,90,120,...}` déjà en
    place (migration `20260723171443` ligne 205) ; fallback custom_price_per_minute.
12. **On ÉTEND les tables existantes** (`reservations`, `consoles`, triggers de
    CHANTIER 1) — on ne recrée rien.

## 6 règles de sécurité NON-NÉGOCIABLES (B.1, create-payment-intent)

1. Montant JAMAIS du client → RPC serveur.
2. Écran de confirmation UI avec montant exact (côté client).
3. Vérif signature webhook (B.2).
4. Idempotency key sur appel paiement.
5. Double-check montant serveur == montant webhook (B.2).
6. JAMAIS de carte brute dans l'app → page hébergée CinetPay.

## Edge Function B.1 — create-payment-intent (JWT REQUIRED)

- `verify_jwt = true` (config.toml). `auth.uid()` lu via `supabase.auth.getUser()`.
- Inputs : `tenant_id`, `poste_id`, `date_heure`, `duree_min` (30-1440),
  `jeu`?, `console`?, `payment_method` (airtel_money|mtn_money|carte),
  `idempotency_key` (UUID v4, regex validée).
- Flux : JWT → validation → idempotency lookup (`UNIQUE user_id+key+endpoint`) →
  RPC prix → INSERT `reservations` statut `en_attente` (triggers overlap/mineur
  refusent le cas échéant) → appel CinetPay `/v2/payment` → INSERT `payments`
  (pending) + `idempotency_keys` → réponse 200.
- Rollback : si CinetPay échoue (non-201), DELETE de la réservation créée. Si
  INSERT payment échoue, on NE rollback PAS la réservation (retry possible).
- Sandbox d'abord, bascule prod après E.2 validé.
- 503 si credentials CinetPay absents (`CINETPAY_API_KEY`/`CINETPAY_SITE_ID`).
- Idempotency hit (clé non expirée) → retourne `payment_url` mis en cache,
  `replayed: true`.

## Edge Function B.2 — cinetpay-webhook (PUBLIC)

- `verify_jwt = false` : CinetPay appelle sans JWT. Sécurité = **HMAC x-token**
  (concaténation des 16 champs dans l'ordre officiel CinetPay, HMAC-SHA256,
  comparaison à temps constant) + rappel `/v2/payment/check`.
- **CinetPay n'envoie JAMAIS le statut dans le webhook** (anti MITM) → on
  appelle toujours l'API de vérification pour connaître le vrai statut.
- Recoupe montant : `cpm_amount` vs `payments.amount` stocké serveur
  (règle #5). Mismatch → 400 + log CRITICAL (paiement potentiellement altéré).
- Idempotent : payment déjà `success` → 200 sans réécriture.
- Transaction inconnue localement (HMAC valide) → log + 200 (pas de retries).
- Réponse : TOUJOURS 200 sur requête traitée (non-200 → CinetPay réessaie).
  400 uniquement si HMAC échoue ou montant incohérent.
- `ACCEPTED` → payments.status='success' + reservation.statut='confirmee' +
  montant_paye + transaction_id. Sinon → payments.status='failed' +
  reservation.statut='annulee'.

## Objets DB créés (migration A.1 → A.5)

| Objet | Type | Détail |
|-------|------|--------|
| `compute_reservation_price(uuid, integer)` | RPC SECURITY DEFINER | `search_path=''`, revoke PUBLIC, grant authenticated+service_role. `<30` et `>1440` → exception |
| `idempotency_keys` | table | `UNIQUE(user_id, key, endpoint)`, expire 1h, RLS FORCE (service_role seul) |
| `payments` | table | provider='cinetpay', `transaction_id UNIQUE`, status pending/success/failed/refunded, `amount>0` serveur-only, refund_amount<=amount, RLS lecture seule authenticated |
| CHECK `reservations_duree_min_check` | contrainte | étendue à `>= 30` (idempotente, DO block) |
| `check_reservation_overlap()` + trigger | RPC + trigger | BEFORE INSERT OR UPDATE OF poste_id,date_heure,duree_min,statut, WHEN statut IN ('en_attente','confirmee') |

## C — Refund CinetPay : MÉCANIQUE MANQUANTE (code à écrire, pas un doc)

> **Diagnostic 16/08/2026** : la politique (#9) est actée mais aucun code ne la
> réalise. Aucun appel CinetPay de refund dans `supabase/functions/`, aucun flow
> d'annulation côté client (rien dans `src/` ne passe une réservation en
> `annulee`). `payments.refunded` + `refund_amount` + `refund_reason` existent
> en base mais rien ne les alimente.

### C.1 — Nouvelle Edge Function `cinetpay-refund` (JWT REQUIRED, service_role)

- Déclenchée APRÈS vérification serveur de la fenêtre >1h/<1h (jamais sur la
  confiance du client).
- Conditions (sinon refus 409) :
  - `payments.status = 'success'` (un paiement non confirmé n'est pas
    remboursable) ;
  - annulation à `> 1h` de `reservations.date_heure` → refund intégral :
    `refund_amount = amount`, `refund_reason = 'client_cancelled_>1h'` ;
  - annulation à `< 1h` → **aucun appel CinetPay**, seul
    `reservations.statut = 'annulee'`.
- Appel CinetPay API checkout `/v2/refund` (`transaction_id`, `amount`,
  `description`, `notify_url`). Succès → `payments.status = 'refunded'` +
  `refund_amount` + `refund_reason`, `reservations.statut = 'annulee'`.
- Idempotent : refund déjà enregistré → 200 sans ré-émission.
- Échec CinetPay (réponse ≠ 2xx) → log CRITICAL + 502, PAS de flip de statut
  sans confirmation API (retry manuel).

### C.2 — Déclencheur côté flow d'annulation (UI + point d'entrée unique)

- Le flow d'annulation client n'existe pas encore (à construire) : point
  d'entrée unique qui (1) vérifie la fenêtre >1h/<1h, (2) appelle C.1 si
  `> 1h`, (3) sinon met directement `reservations.statut = 'annulee'`.
- Dépendance : `CINETPAY_API_KEY`/`CINETPAY_SITE_ID` déjà injectées (même
  blocage AE-1 que B.1).

## Points d'attention

- **Index GiST** sur `tstzrange` — **DÉPLOYÉ 17/08/2026** via wrapper
  `make_reservation_range()` (PL/pgSQL IMMUTABLE). L'expression directe
  `tstzrange(date_heure, date_heure + make_interval(...), '[)')` échouait en
  `CREATE INDEX` avec `42P17: functions in index expression must be marked
  IMMUTABLE` — Postgres ré-analyse le corps des fonctions `LANGUAGE sql` et
  rejette des expressions qu'il juge non-immutables (même si les opérateurs
  le sont). Les fonctions `LANGUAGE plpgsql` ne sont PAS inlinées → Postgres
  fait confiance à la déclaration `IMMUTABLE`. La fonction wrapper résout le
  problème. Migration : `20260817100000_18_progressive_index_test.sql`.
  Nettoyage artefacts debug (table `_debug_gist`, index `idx_test_gist_simple`) :
  `20260817110000_19_cleanup_debug_artifacts.sql`.
- **Post-push à vérifier** : l'enum `payment_method` inclut bien 'carte'.
- **AE-1 bloquant** : credentials CinetPay non injectés (webhooks → 503).

## ⚠️ À compléter (Yannick)

- Annulation/report < 1h : flow UI exact (qui fait quoi, quelle confirmation) —
  le refund >1h est, lui, tranché (#9) et cadré en section C.
- Positionnement Phase Actuelle / Phase Future du chantier 2.

## Liens
- Migration : `supabase/migrations/20260812000000_10_chantier2_paiement.sql`
- Edge : `supabase/functions/create-payment-intent/index.ts`,
  `supabase/functions/cinetpay-webhook/index.ts`
- Chantier 1 (schéma de base) : `memory/chantier1-statut.md`
