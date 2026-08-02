# Déploiement Supabase — Commandes pour Yannick

**État au 31/07/2026** : 3 migrations prêtes à être pushées côté Yannick (projet `ybqsfyufnpmhlhdtwkon`).

## Pré-requis (déjà fait)

- `supabase` CLI installé v2.110.0 (`npm install -g supabase`)
- `supabase/config.toml` corrigé : `project_id = "ybqsfyufnpmhlhdtwkon"`
- 4 migrations SQL en attente dans `supabase/migrations/` :
  - `20260723171443_cd704e77.sql` (13.4 Ko) — schéma initial
  - `20260724002457_a69c4fa7.sql` (4.2 Ko) — invitations RPC
  - `20260725113348_747fc8f2.sql` (1.8 Ko) — hardening SECURITY DEFINER
  - `20260726150000_5a1_platform_admins.sql` (3.6 Ko) — table platform_admins
  - `20260731150000_5c1_platform_admins_view_profiles.sql` (1.6 Ko) — **NOUVELLE** RT.P.0-profiles

## Commandes à exécuter (dans l'ordre)

```bash
# 1. Authentification (une seule fois)
supabase login

# 2. Lier le projet local au projet Supabase distant
supabase link --project-ref ybqsfyufnpmhlhdtwkon

# 3. Pousser les 5 migrations
supabase db push
```

## Vérification après push

```bash
# Toutes les tables attendues
supabase db remote psql --command "\dt public.*"

# Policies sur profiles (doit inclure "Platform admins can view all profiles")
supabase db remote psql --command "SELECT policyname FROM pg_policies WHERE tablename = 'profiles';"

# Vérifier que la table platform_admins existe avec le seed
supabase db remote psql --command "SELECT * FROM platform_admins;"

# Seed des 5 postes Kingston (si pas déjà fait)
# Copier-coller le contenu de supabase/seed/20260731_bootstrap_postes_kingston.sql
# dans Supabase Dashboard → SQL Editor → New query → Run
```

## Rollback (si besoin)

En cas de problème après push, chaque migration est versionnée et peut être annulée :

```bash
# Voir l'historique des migrations
supabase migration list

# Réappliquer manuellement le CREATE opposé (pas de rollback automatique)
```

## Points d'attention

- **Service role key** : après push, vérifier que `SUPABASE_SERVICE_ROLE_KEY` est bien dans `.dev.vars` (Cloudflare) — la dette #1 documente que cette clé est trackée dans `.env.git` pour dev local, mais doit être en `.dev.vars` pour la prod.
- **Seed** : l'admin fondateur `ykingston007@gmail.com` est créé automatiquement par la migration 5A.1 (cf. ligne 22-24).
- **Ordre des migrations** : important — `5c1_...` dépend de `is_platform_admin()` créée par `747fc8f2`. Pas de souci, l'ordre alphabétique du timestamp est respecté.

## Pourquoi cette doc existe

- `MEMOIRE_CAISSE.md` ligne 75 (RT.H.7) documente l'historique des préparatifs
- Ce `README_DEPLOY.md` est le mode d'emploi **opérationnel** pour Yannick (3 commandes + 4 vérifications)
- Aucune commande ici ne doit être modifiée sans mettre à jour les deux fichiers en parallèle
