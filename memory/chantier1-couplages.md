# CHANTIER 1 — Couplages entre entités

> **Statut du fichier** : reconstruit le 16/08/2026 depuis la migration
> `20260803113500_6_chantier1_fondations.sql` (uniquement la couche SQL).
> Les couplages UI/composants et le raisonnement business derrière chaque
> option tranchée sont **⚠️ à compléter par Yannick**.

## Couplages de schéma (couche SQL, reconstruits)

### 1. `consoles` ↔ `postes`
- **Règle métier** : 1 console = 1 poste. `consoles.poste_id` est `UNIQUE`.
- **Suppression** : `ON DELETE CASCADE` (supprimer le poste supprime la console).
- **Cascade de statut** : trigger `trg_consoles_cascade_status` → fonction
  `cascade_console_status()` (SECURITY DEFINER) :
  - console `en_reparation` → poste `reserved` (sauf si déjà `busy`, on
    n'interrompt pas une session en cours).
  - console redevient `disponible` (et ancien état = `en_reparation`) → poste
    revient à `idle` s'il était `reserved`.
  - énum `poste_status` étendue avec la valeur `reserved` (via DO block, pattern
    ALTER TYPE ADD VALUE transaction séparée).

### 2. `reservations` ↔ `postes` / `auth.users` / `sessions_caisse`
- `client_id → auth.users(id) ON DELETE CASCADE`.
- `poste_id → postes(id) ON DELETE RESTRICT` (on ne supprime pas un poste qui a
  des réservations).
- `session_id → sessions_caisse(id) ON DELETE SET NULL` — **couplage CHANTIER 1D** :
  quand une réservation est honorée, on crée la session caisse et on la lie ici.
- `mode_paiement` réutilise l'enum `payment_method` (cash/airtel_money/mtn_money).
  `cash_on_arrival` volontairement **absent** (YAGNI, futur chantier
  parent-réservation).
- **Trigger B4 `trg_reservations_block_minor`** → `prevent_underage_reservation()` :
  bloque tout INSERT si `profiles.is_minor = true` (CHECK violation + message
  explicite RT.H.5). Le mineur reste libre de venir en salle (paiement cash).

### 3. `staff_applications` ↔ `user_tenant_roles`
- **Option 2 retenue (point E1)** : table séparée, le flux `tenant_invitations`
  reste fonctionnel (les deux coexistents).
- Un candidat a un `auth.users` MAIS **aucun** `user_tenant_roles` tant que la
  candidature n'est pas approuvée.
- **Trigger `trg_staff_applications_grant`** → `grant_staff_role_on_approval()` :
  passage à `approved` → INSERT auto dans `user_tenant_roles`
  (ON CONFLICT DO NOTHING, idempotent) + `reviewed_at := now()`.
  Passage à `rejected` → `reviewed_at := now()` uniquement.
- `UNIQUE (user_id, tenant_id, role)` : une seule candidature par rôle/tenant.
- FK (ajoutées 2026-08-10, `20260810000000` + `20260810000001`) :
  `staff_applications.user_id` et `user_tenant_roles.user_id` → `public.profiles(id)`,
  `ON DELETE RESTRICT` — permet les jointures PostgREST typées (dette #27) et
  force la traçabilité avant hard-delete (dette #29).

### 4. `profiles` ↔ `auth.users` (trigger `handle_new_user`)
- `profiles.id = auth.users.id`, trigger AFTER INSERT sur `auth.users`.
- Mappage des nouveaux champs PII depuis `raw_user_meta_data`
  (`nom`, `prenom`, `sexe`, `age` — uniquement si `^[0-9]+$`, `telephone`,
  `indicatif_pays` défaut `+242`).
- `is_minor` = colonne **générée persistante** `(age IS NOT NULL AND age < 18)`
  — indexable, pas de CHECK dur (cohérent RT.H.5).
- Bootstrap `platform_admin` via la table `platform_admins`
  (plus de littéral, migration `20260726150000_5a1`) + consommation des
  `tenant_invitations` pendantes.

### 5. RLS — qui a accès à quoi
| Table | Policy | Condition |
|-------|--------|-----------|
| `consoles` | SELECT | `has_tenant_access(uid, tenant_id)` |
| `consoles` | ALL | staff / lounge_admin / platform_admin du tenant |
| `reservations` | SELECT | `client_id = uid` OU `has_tenant_access` |
| `reservations` | INSERT | `client_id = uid` (mineurs bloqués par trigger B4) |
| `reservations` | UPDATE | client propriétaire OU staff/lounge/platform |
| `reservations` | DELETE | staff / lounge_admin / platform uniquement |
| `staff_applications` | SELECT | `user_id = uid` OU `has_tenant_access` |
| `staff_applications` | INSERT | `user_id = uid AND status = 'pending'` |
| `staff_applications` | UPDATE | platform_admin OU lounge_admin du tenant |

## Couplages UI / edge (⚠️ à compléter par Yannick)
- `auth.tsx` : modes inscription client/staff (champs PII) + reset mdp.
- Écran d'approbation `/platform` : liste des candidatures, badge count via
  `count_pending_staff_applications(_tenant_id DEFAULT NULL)`.
- Bouton « ⏱ Ajouter » (Salle.tsx) lié à la réservation (chantier 1D).
- Edge `check-email-jetable` : dépendance serveur `mailchecker` (jeu de
  données, pas une logique cliente).

## Liens
- Migration : `supabase/migrations/20260803113500_6_chantier1_fondations.sql`
- Statut global chantier : `memory/chantier1-statut.md`
- Couplages paiement (extension du schéma) : `memory/chantier2-reservation-paiement.md`
