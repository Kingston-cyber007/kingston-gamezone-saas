# CHANTIER 1 — Fondations (statut)

> **Statut du fichier** : reconstruit le 16/08/2026 depuis le code source, les
> commentaires de migration et MEMOIRE_CAISSE.md. Le dossier `memory/` avait été
> référencé mais jamais créé (trou de gouvernance, cf. MEMOIRE_CAISSE.md).
> Les sections marquées **⚠️ à compléter** demandent le contexte métier de
> Yannick (elles n'ont pas pu être reconstituées depuis le seul code).

## Objectif du chantier
Pose des fondations multi-tenant : inscription client/staff, candidature staff
avec approbation /platform, statut de console, et base des réservations.

## Décisions actées

| # | Décision | Source | Statut |
|---|----------|--------|--------|
| 1 | `mailchecker` = dépendance **serveur** (Edge Function `check-email-jetable`), données de jeu MAIS logique de vérification jamais côté client | `20260803113500` header l.5 | actée |
| 2 | `staff_applications` = **table séparée** (option 2, tranchée au point E1) ; le flux `tenant_invitations` existant continue de fonctionner | `20260803113500` header l.6 | actée |
| 3 | `profiles.age` : **PAS de CHECK `>= 18`** en base ; `is_minor` est **calculée** (cohérent avec RT.H.5) | `20260803113500` header l.7 | actée |
| 4 | Mode de paiement `cash_on_arrival` : **PAS ajouté** (YAGNI ; réservé à une future réservation parent) | `20260803113500` header l.8 | actée |
| 5 | `consoles.statut = 'en_reparation'` → `postes.statut = 'reserved'` via **trigger en cascade** | `20260803113500` header l.9 | actée |
| 6 | **UNE seule migration** A→B→C→D (rollback atomique), pas de plusieurs petites migrations | `20260803113500` header l.10 | actée |
| 7 | Vérification via fonctions `chantier1_status()` / `chantier1_triggers()` | `20260803113500` | ⚠️ à compléter |

**⚠️ à compléter (Yannick)** : le raisonnement business complet derrière les
décisions 1-5 (contexte d'arbitrage, alternatives écartées). Seules les
conclusions sont dans le header SQL.

## Sections du chantier

| Section | Contenu | Statut |
|---------|---------|--------|
| A | Schéma DB multi-tenant (tenants, profiles, user_tenant_roles, staff_applications, reservations, consoles, postes, payments, tenant_invitations, platform_admins) | ✅ acté — migration `20260803113500_6_chantier1_fondations.sql` |
| B | Inscription client/staff + reset mot de passe côté client (`auth.tsx`) | ✅ acté (commit `3dfd59c`) |
| B.3 | Vérification email jetable (Edge `check-email-jetable`, `npm:mailchecker@^6.0.0`, serveur uniquement) | ✅ acté |
| C | Candidature staff + écran d'approbation /platform | ✅ acté (commit `3dfd59c`) |
| D | Extension de ticket (« ⏱ Ajouter » lié à la réservation) | ⚠️ à compléter — statut réel non vérifié dans cette reconstruction |
| E | Cookie httpOnly | ⚠️ à compléter — lié à dette #26 |

**⚠️ à compléter (Yannick)** : statut réel de D et E (livré / partiel / reporté).

## Détails techniques retenus (reconstruits depuis le code)

- La FK `staff_applications.user_id → public.profiles(id)` (ON DELETE RESTRICT)
  a été ajoutée le 2026-08-10 (`20260810000000`) pour permettre la jointure
  PostgREST typée sans `as any` (dette #27).
- La FK `user_tenant_roles.user_id → public.profiles(id)` (ON DELETE RESTRICT)
  ajoutée le même jour (`20260810000001`) — RESTRICT (pas CASCADE) pour forcer
  le traitement explicite de la traçabilité (dette #29) avant tout hard-delete.
- Seed des fixtures client (`20260810133905`) : réparation profils manquants
  + rôle `client` pour `client@kingstongamezone.com` sur le tenant Kingston
  GameZone (contexte dette #30 — fixtures RTE legacy).

## Journal chantier 1

- **03/08/2026** : chantier ouvert (MEMOIRE_CAISSE.md). Audit ND1-ND11 de
  sécurité effectué le même jour (cf. `memory/audit-2026-08-03.md`).
- **08/08 → 12/08** : session codée sans commit intermédiaire (trou de
  gouvernance, réconcilié par commit `7d6724d`).

## Liens
- Migration source : `supabase/migrations/20260803113500_6_chantier1_fondations.sql`
- Décisions détaillées couplages : `memory/chantier1-couplages.md`
- Dettes liées : `memory/dette-technique.md` (#26, #27, #29, #30)
