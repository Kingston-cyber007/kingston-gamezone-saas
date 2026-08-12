# Kingston GameZone — Politique de sécurité

**Statut** : 🟢 documenté le 03/08/2026 (audit global exhaustif)
**Périmètre** : Application SaaS multi-tenant Kingstone GameZone (TanStack Start + Supabase).
**Public visé** : développeurs reprenant le projet, auditeurs sécurité, contributeurs externes.

Ce document décrit **ce qui est protégé, contre qui, et ce qui ne l'est PAS**. Il sert aussi de référence pour les arbitrages sécurité/UX/productivité.

---

## 1. Modèle de menace

L'application traite :
- Des **sessions de caisse** (montants, postes, boissons, mode de paiement).
- Des **tickets nominatifs** (nom, prénom, âge — données potentiellement de **mineurs**).
- Des **réglages métier** (tarifs, sons personnalisés, préférences UX).
- Des **données plateforme** (tenants, invitations, admins plateforme).

Les attaquants considérés sont :

| Profil | Capacité | Menace principale |
|---|---|---|
| **Visiteur anonyme** | Accès public au domaine | Pas d'auth → pas de donnée (cf. §2) |
| **Utilisateur authentifié sans rôle** | Accès aux routes `_authenticated` | Bloqué par guards `beforeLoad` (cf. §2) |
| **Staff / Lounge admin** | Accès `/app/*` | Accès légitime à sa salle uniquement (RLS) |
| **Platform admin** | Accès `/platform/*` | Accès cross-tenant (dette #5 acceptée, à re-trancher phase C) |
| **Extension navigateur hostile** | Lit `localStorage` après installation | Minimisation PII (cf. §3) |
| **DevTools occasionnel** | Lit `localStorage` via console | Anonymisation 7 jours (cf. §3) |
| **XSS actif** | Exécute du JS dans l'app | `escapeHtml` systématique (Fix #1) |
| **Attaquant physique** | Accès au filesystem du device | Hors périmètre technique (recommandation OS-level) |

Ce qui **n'est pas** considéré :
- Attaquant avec accès root sur le serveur Supabase (sécurité gérée par Supabase).
- Compromission de la chaîne d'approvisionnement npm (surveillé, pas bloqué).
- Ingénierie sociale sur le gérant (formation utilisateur, hors périmètre code).

---

## 2. Authentification et autorisation

### 2.1 Authentification
- **Supabase Auth** (email/password).
- Pas de cookie httpOnly custom (recommandation dette #1 chantier séparé).
- Le token JWT est en `localStorage` (cf. §3 — surface d'attaque documentée).

### 2.2 Autorisation (RBAC)

Toutes les routes `_authenticated/*` ont un `beforeLoad` qui :
1. Vérifie la présence d'un user Supabase.
2. Charge ses rôles via `user_tenant_roles`.
3. Redirige vers `/` ou `/auth` si rôle manquant.

Statut par espace (état 2026-08-03) :

| Espace | Route | Guard `beforeLoad` | Statut |
|---|---|---|---|
| Public | `/` | Anti-loop (RT.H.8) | ✅ |
| Auth | `/auth` | Aucun (géré en runtime) | ✅ |
| App (staff) | `/app/*` | `staff` ou `lounge_admin` | ✅ (RT.P.0-ppfix) |
| Client | `/client/*` | `client` | ✅ (Fix #3, ND3) |
| Platform | `/platform/*` | `platform_admin` fail-closed | ✅ (RT.H.8) |

### 2.3 Row-Level Security (Supabase)

Toutes les tables Supabase ont une policy RLS active :
- `sessions_caisse` : lecture/écriture via `has_tenant_access(auth.uid(), tenant_id)`.
- `tickets` : idem.
- `postes` : idem.
- `platform_admins` : lecture par `platform_admin` uniquement.
- `tenants` : SELECT/UPDATE par `platform_admin`, INSERT par trigger.
- `profiles` : SELECT par `platform_admin` (cf. migration `5c1_*`).

**Accepté mais à re-trancher** : `is_platform_admin` est OR-é dans toutes les RLS (dette #5). Cela donne à un platform_admin compromis un accès cross-tenant total. Phase C.

---

## 3. Protection des données client (PII)

### 3.1 Données concernées

Les champs suivants contiennent des **données personnelles** :

| Source | Champs PII |
|---|---|
| `Session.clientName` | Nom libre saisi par le gérant (ex. "M. Kimbangu") |
| `Ticket.nom`, `Ticket.prenom` | Identité du client |
| `Ticket.age` | Peut être un mineur (< 16 ans — géré par RT.H.5) |
| `Ticket.code` | Identifiant unique à 7 caractères |

### 3.2 Anonymisation par rétention temporelle

**Fix #9 — Phase A (03/08/2026)** : `useStore.ts` (côté Zustand) applique une anonymisation à chaque boot.

- **Fenêtre de rétention** : `PII_RETENTION_MS = 7 * 24 * 60 * 60 * 1000` (aligné sur `TICKET_VALID_MS`).
- **Tickets** : si `Date.now() - ticket.dateExpiration > 7 jours`, `nom` et `prenom` sont remplacés par `''`.
- **Sessions** : si `Date.now() - session.ts > 7 jours`, `clientName` est remplacé par `null`.
- **Agrégats conservés** : montants, dates, codes, modes de paiement (non-PII, utiles aux KPI).

**Effet** :
- L'app reste pleinement fonctionnelle le jour J (noms consultables).
- Au-delà de 7 jours, l'historique reste consultable mais anonymisé.
- La surface PII dans `localStorage` décroît avec le temps (max 7 jours de PII).

### 3.3 Limites HONNÊTES de cette protection

Cette anonymisation **NE protège PAS** contre :
- Un **XSS actif** (cf. Fix #1 — `escapeHtml` est la vraie défense). Si un attaquant exécute du JS dans l'app, il lit la RAM où les noms sont encore en clair (≤ 7 jours).
- Un **accès root au device** : l'attaquant lit l'IndexedDB et le localStorage directement.
- Une **extension navigateur hostile** qui exfiltre via `chrome.storage` ou autre canal.

Elle **protège** contre :
- Un DevTools occasionnel (`F12 → Application → Local Storage`).
- Une fuite partielle (backup profil navigateur partagé, screenshot partiel).

### 3.4 Chiffrement honnête (Phase B — Fix #9, à venir)

**Note d'intention** (pas encore implémenté) : un chiffrement AES-GCM via Web Crypto API sera appliqué au reliquat PII jour-J non couvert par la rétention 7 jours. La clé sera stockée dans IndexedDB.

**Honnêteté radicale** : ce chiffrement NE protège PAS contre un XSS actif (l'attaquant peut appeler `decryptPII()` comme l'app). Il protège uniquement contre DevTools/extension occasionnelle. Cette limite sera documentée dans le code du module `secure-storage.ts` pour éviter une fausse impression de sécurité.

---

## 4. Validation des entrées

### 4.1 Côté client (défensif)

- **Formulaires `/platform`** : helpers de validation explicites (Fix #4) — email regex, slug regex, bornes numériques.
- **Import JSON (Reglages)** : type guards sur `Session`, `Ticket`, `Poste` (Fix #7) — whitelist `paymentMethod`, `Number.isFinite` sur montants.
- **Merge Zustand** : type guards en entrée (Fix #8) — localStorage corrompu n'injecte plus de NaN.
- **HTML construit** : `escapeHtml()` sur toutes les interpolations `${...}` (Fix #1) — anti-XSS sur `printRapport()`, `printTicket()`.

### 4.2 Côté serveur (autoritaire)

- **Supabase RLS** : politique de moindre privilège (cf. §2.3).
- **Types stricts** : `Database['public']['Tables']` (auto-générés par `supabase gen types`).
- Pas de validation Zod/Valibot côté client (règle 5 NOUVEAU_DEPART : pas de nouvelle dépendance sans accord).

---

## 5. Conformité et dette résiduelle

### 5.1 RGPD (UE)

Données traitées : identité, âge, montant. **Pas de finalité publicitaire**. **Pas de transfert tiers**. Conservation limitée à 7 jours en local.

⚠️ **Action recommandée** : ajouter une page `/legal` ou un consentement explicite à la première saisie d'un ticket client (juridique, pas technique — chantier dédié).

### 5.2 Dettes de sécurité connues

Voir `memory/dette-technique.md` (projet) :
- **#1** — `SUPABASE_SERVICE_ROLE_KEY` rotation (action Yannick côté Dashboard).
- **#5** — `is_platform_admin` OR-é partout (re-tranchage phase C).
- **#25** — Pas d'`audit_log` (chantier dédié — traçabilité platform_admin).

### 5.3 Nouvelles dettes de l'audit 2026-08-03

Voir `memory/audit-2026-08-03.md` :
- **ND1** — XSS `document.write` ✅ résolu par Fix #1.
- **ND2** — PII en clair localStorage 🟡 en cours (Phase A faite, Phase B à venir).
- **ND3** — `/client` sans `beforeLoad` ✅ résolu par Fix #3.
- **ND4** — `requireSupabaseAuth` mort ✅ résolu par Fix #5 (YAGNI strict).
- **ND5** — Validation faible `/platform` ✅ résolu par Fix #4.
- **ND6** — Casts `as any` orphelins ✅ résolu par Fix #6.
- **ND7** — `merge` Zustand sans validation ✅ résolu par Fix #8.
- **ND8** — `handleImportFile` faible ✅ résolu par Fix #7.

---

## 6. Procédure de signalement

Si tu découvres une faille de sécurité :
1. **Ne PAS** ouvrir d'issue publique GitHub.
2. Contacter Yannick directement (mail interne — défini hors de ce repo).
3. Documenter dans `memory/dette-technique.md` sous une entrée datée.

---

**Pourquoi ce document** : la sécurité d'une app multi-tenant avec PII ne tient pas à une seule mesure, mais à la **combinaison explicite** de plusieurs. Documenter ce qui est protégé ET ce qui ne l'est pas évite les angles morts — pour les développeurs reprenant le projet et pour les auditeurs.

**How to apply** : Avant toute feature touchant aux données utilisateur, vérifier qu'on ne dégrade pas une des protections ci-dessus. Avant tout commit public, s'assurer que la dette #1 (rotation clé) est fermée côté Dashboard.
