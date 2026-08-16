# CHANTIER 3 — Suppression de compte (FEAT-1 + FEAT-2)

> **Statut du fichier** : reconstruit le 16/08/2026 depuis la migration
> `20260808220000_7_delete_own_account.sql` + Edge Functions `delete-own-account`
> et `restore-account-admin`. Les sections **⚠️ à compléter** demandent le
> contexte métier/UI de Yannick.

## Cadre
- **FEAT-1** : un utilisateur supprime son propre compte (`/client`).
- **FEAT-2** : un `platform_admin` supprime un compte tiers (`/platform`).
- **V1 (2026-08-08) : ANNULÉE** — anonymisation immédiate, jamais commitée ni
  pushée (réécrite en place, vérifié : untracked, aucun historique).
- **V2 (2026-08-09) : RETENUE** — stratégie C hybride (soft-delete réversible).

## Décisions actées (V2 — stratégie C)

1. **Clic (FEAT-1 ou FEAT-2) → `soft_delete_profile()`** :
   - `profiles.deleted_at = now()`
   - `profiles.scheduled_purge_at = now() + 30j`
   - `auth.users.banned_until = scheduled_purge_at` (posé par la Edge Function
     via service_role — **délégation explicite** : le helper SQL ne touche PAS
     auth.users, commentaire migration l.126)
   - **PII INTACTES** pendant les 30j → annulation admin propre possible.
2. **Pendant 30j** : sign-in bloqué (banned_until) ; annulation = admin-only via
   `restore_deleted_profile()` (`/platform`).
3. **À T+30j** : cron pg_cron quotidien (`purge-expired-profiles-daily`, 03:00
   UTC) → `purge_expired_profiles(100)` :
   - anonymise les PII (nom='Utilisateur supprimé', display_name='Utilisateur
     supprimé', email/telephone/sexe/age/prenom=NULL)
   - pose `anonymized_at = now()`
   - **hard-delete de auth.users différé** (dette future, pas justifié en V1
     par le volume ; réévaluer si > 100 comptes stagnants).
4. **`banned_until` scopée sur 30j (et PAS '100 years')** :
   - permet restauration admin propre (UPDATE banned_until = NULL)
   - cohérent avec la fenêtre d'annulation RGPD
   - pas de "banni à vie" accidentel nécessitant un Dashboard manuel.
5. **`anonymized_at` = 'infinity'** à la purge (via trigger
   `close_anonymized_account` : NULL → NOT NULL → `auth.users.banned_until =
   'infinity'`) : un compte anonymisé ne ressuscite JAMAIS (par conception).
   Réactivation éventuelle = UPDATE service_role manuel conscient.
6. **Anti-footgun** : `count_platform_admins()` (ne compte que les profiles
   ACTIFS, deleted_at IS NULL) AVANT soft_delete ; 409 si dernier
   platform_admin s'auto-supprime.
7. **Rollback de sécurité** : si l'UPDATE `banned_until` échoue → tentative de
   rollback du soft_delete ; si le rollback échoue LUI-MÊME → log CRITICAL +
   500 code `rollback_failed` (état incohérent à vérifier manuellement).

## Objets DB créés (migration)
| Objet | Type | Détail |
|-------|------|--------|
| `profiles.deleted_at / anonymized_at / scheduled_purge_at` | colonnes | timestamptz NULL, COMMENTs explicites anti-rollback destructif |
| `idx_profiles_scheduled_purge` | index partiel | WHERE scheduled_purge_at IS NOT NULL |
| `soft_delete_profile(uuid)` | RPC SECURITY DEFINER | idempotent, PII intactes, GRANT service_role |
| `purge_expired_profiles(integer=100)` | RPC SECURITY DEFINER | batch + SKIP LOCKED, anonymise PII, GRANT service_role |
| `restore_deleted_profile(uuid)` | RPC SECURITY DEFINER | atomique (profiles + auth.users), refuse si déjà anonymisé, GRANT service_role |
| `check_platform_admin(uuid)` | RPC SECURITY DEFINER | user_tenant_roles OU auth.users.app_metadata |
| `count_platform_admins()` | RPC SECURITY DEFINER | profiles actifs seulement, GRANT authenticated + service_role |
| pg_cron + job `purge-expired-profiles-daily` | extension + job | 03:00 UTC, `SELECT public.purge_expired_profiles(100)` |
| `close_anonymized_account()` + trigger | RPC + trigger | AFTER UPDATE, banned_until='infinity' à la purge |

## Edge Function B.1 — delete-own-account (JWT REQUIRED)
- Mode **self** (défaut) : target = caller.id (body vide OK).
- Mode **third-party** (FEAT-2) : `body.target_user_id` → `check_platform_admin`
  requis (403 sinon) + anti-footgun si target==caller (409 `last_admin` si
  count<=1).
- Flux : JWT → parse body → check_platform_admin → soft_delete_profile →
  `auth.admin.updateUserById(ban_duration = computeBanDuration(scheduled_purge_at))`
  (`"y"` non supporté par supabase-js → conversion heures+minutes).
- Réponse 200 : `{ deleted_at, scheduled_purge_at, already_deleted, mode }`.

## Edge Function B.2 — restore-account-admin (JWT REQUIRED)
- **Admin-only** : `check_platform_admin(caller.id)` requis (403 sinon).
- **Body obligatoire** `{ target_user_id }` — PAS de fallback self (à la
  différence de delete-own-account).
- `restore_deleted_profile` atomique (une transaction SQL) → pas d'état
  partiel à rollback.
- Exception SQL (jamais supprimé / déjà anonymisé) → 422 `not_restorable`.
  Un profil passé par la purge **ne ressuscite jamais**.
- Réponse 200 : `{ target_user_id, restored_at, was_anonymized }`.

## RLS / interaction avec le reste
- RLS "Users can view their own profile" reste effective même soft-deleted —
  mais banned_until empêche le re-login.
- `prevent_underage_reservation` continue de lire `profiles.is_minor`
  (GENERATED) : pendant 30j age intact → inchangé ; après purge age=NULL →
  is_minor=false automatiquement.
- staff_applications : pas d'impact (statut figé après review).

## Dettes liées
- Hard-delete complet auth.users post-purge (via pg_net + Edge Function
  `auth.admin.deleteUser`) — dette à documenter, pas justifiée en V1.
- Magic link self-service pour annulation (self-restore) — déjà notée chantier 3.
- FK `user_tenant_roles.user_id → profiles(id)` ON DELETE RESTRICT force la
  traçabilité avant hard-delete (dette #29).

## ⚠️ À compléter (Yannick)
- UI du flow de suppression côté `/client` (confirm modale `DoubleConfirmModal`,
  étapes, messages d'erreur).
- UI `/platform` : liste des comptes soft-deleted + bouton restaurer.
- Confirmation RGPD exacte : délai 30j choisi vs obligation légale locale
  (Congo ?), documentation à afficher à l'utilisateur.
- Positionnement Phase Actuelle / Phase Future.

## Liens
- Migration : `supabase/migrations/20260808220000_7_delete_own_account.sql`
- Edge : `supabase/functions/delete-own-account/index.ts`,
  `supabase/functions/restore-account-admin/index.ts`
- Commit client : `71d8dfd feat(client): suppression de compte + DoubleConfirmModal (chantier 3)`
