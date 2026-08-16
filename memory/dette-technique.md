# Dette technique — Kingston GameZone

> **Statut du fichier** : reconstruit le 16/08/2026 depuis MEMOIRE_CAISSE.md,
> SECURITY.md et les commentaires de migration. Le dossier `memory/` avait été
> référencé (notamment ici depuis SECURITY.md l.150/157/174) mais jamais créé.
> Les entrées sont consolidées depuis les sources disponibles ; les numéros non
> retrouvés dans les sources sont **⚠️ à compléter par Yannick**.

## Dettes actives

| # | Dette | Action requise | Statut |
|---|-------|----------------|--------|
| **#1** | Rotation `SUPABASE_SERVICE_ROLE_KEY` (exposée historiquement dans `.env` tracké — cf. A.1) | Rotation côté Supabase Dashboard, puis maj `.env`/`.dev.vars` | 🔴 **Action Yannick** |
| **#4** | Système de licences / abonnement | Chantier 3-4 sessions | 📋 Backlog |
| **#5** | `is_platform_admin` OR-é dans toutes les RLS → accès cross-tenant total si admin compromis | Décision produit **phase C** | 🟡 À re-trancher |
| **#23** | `loyalty_points` — UI non consommée | Backlog | 📋 Backlog |
| **#25** | Pas d'`audit_log` (traçabilité platform_admin) | Chantier dédié | 🟡 À planifier |
| **#26** | Cookie httpOnly custom (chantier séparé) — JWT en `localStorage` (documenté SECURITY.md §2.1) | Chantier dédié | 📋 Chantier séparé |
| **#29** | Hard-delete complet `auth.users` post-purge (CH.3) via `auth.admin.deleteUser` | Pas justifié en V1 (volume). Réévaluer si > 100 comptes anonymisés stagnants | 📋 Dette future |
| **#32** | Staff voit/accède au `billing_status` de sa salle | Chantier à part | 📋 Ouvert |

## Dettes fermées (historique)

| # | Dette | Fermée par | Date |
|---|-------|-----------|------|
| #1 (volet tracking) | `.env` tracké dans git | A.1 — `git rm --cached` + `.gitignore` (reste la rotation clé côté Dashboard) | 02/08/2026 |
| #2 | Table `platform_admins` non appliquée | 5A.1 pushé en remote (vérifié 02/08) | 02/08/2026 |
| #3 | Collision d'ID Zustand (`'s'+Date.now()`) | RT.P.0-fix — `crypto.randomUUID()` | 31/07/2026 |
| #9 | Purge shadcn/ui + deps mortes | A.2a (47 fichiers `src/components/ui/*` supprimés) | 02/08/2026 |
| #11 | `profiles` illisibles par platform_admin | 5c1 policy `Platform admins can view all profiles` pushée | 02/08/2026 |
| #14 | ToastContainer global (race + espaces muets) | RT.T.0 — store Zustand dédié | 31/07/2026 |
| #24 | `tenant_settings` jamais consommée par l'UI | RT.P.0-tenantcfg — section « Réglages par salle » /platform | 31/07/2026 |
| #27 | Jointures PostgREST non typables (FK vers auth.users hors scan) | FKs explicites vers `profiles(id)` ON DELETE RESTRICT (20260810000000 + 20260810000001) | 10/08/2026 |
| #30 | Fixtures RTE legacy sans profil (orphelins) | Seed `20260810133905` + la FK de #27 a rempli son rôle (signal structurel) | 10/08/2026 |

## Autres dettes documentées (sources diverses)

- **ND2 / Fix #9 Phase B** : chiffrement PII AES-GCM jour-J (secure-storage.ts) —
  note d'intention, protections documentées (n'arrête PAS un XSS actif).
- **RGBA résiduel** : 35+ occurrences `rgba(124, 58, 237, ...)` dans theme.css
  (borders/glows/shadows non-texte) — documenté mais non migré (RT.G.3 ne
  migre que les `color:` texte).
- **`@lovable.dev/cloud-auth-js`** : dépendance devenue inutilisée après RT.H.2
  (OAuth Supabase natif) — laissée pour éviter divergence package.json/node_modules.
- **Index GiST** `idx_reservations_poste_range` désactivé (2e push chantier 2
  échouait) — à réintroduire dans une migration dédiée après diagnostic.
- **`packageManager: "pnpm@9"`** non résolu en version exacte (pnpm local
  11.8.0) → warning pnpm. À corriger (`pnpm@9.x.x` ou `corepack use`).
- **`--kg-violet` #7c3aed 3.36:1** : acceptable pour accents, sous AA pour
  texte normal — RT.G.3 l'a éclairci en #a78bfa (dette fermée).

## ⚠️ À compléter (Yannick)
- Numéros de dettes manquants dans cette consolidation (le registre historique
  complet n'a pas été retrouvé dans les sources — uniquement #1→#32 référencés
  par fragments).
- Dette d'intégration « tables orphelines » (`tenant_settings`, `postes`,
  `sessions_caisse` non consommées côté front) — reportée étape 6 (offline-first).
- Page `/legal` / consentement RGPD (recommandation SECURITY.md §5.1).

## Liens
- SECURITY.md §5.2/5.3/6 (dettes de sécurité + procédure de signalement)
- MEMOIRE_CAISSE.md (journal : dettes fermées par session)
- `memory/audit-2026-08-03.md` (dettes ND1-ND11)
