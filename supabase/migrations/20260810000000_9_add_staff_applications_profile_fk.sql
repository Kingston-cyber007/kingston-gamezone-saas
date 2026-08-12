-- Migration : ajout FK explicite staff_applications.user_id → public.profiles(id)
-- Date : 2026-08-10
-- Contexte : dette #27 (regen types Supabase). La requête PostgREST
--   supabase.from('staff_applications').select('..., profiles:profiles!inner(...)')
--   est typée correctement par supabase-js UNIQUEMENT si une Relationships[]
--   existe dans le type auto-généré. Or la FK existante pointe vers
--   auth.users(id), que le client TS ignore (schema auth hors scan).
--   Ajout d'une seconde FK vers public.profiles(id), qui elle apparaît
--   dans Relationships[] et rend la jointure typable sans `as any`.
--
-- ON DELETE RESTRICT (pas CASCADE) : si auth.admin.deleteUser() (dette #29)
--   supprime un user, son profil est supprimé via handle_new_user ON DELETE
--   CASCADE. RESTRICT empêche alors le hard-delete tant qu'une candidature
--   existe — force dette #29 à traiter explicitement la traçabilité admin
--   (reviewer_id, reviewed_at, rejection_reason) avant suppression.
--   Coût nul aujourd'hui (dette #29 non construite), sécurité future max.
--
-- Pas de grant à modifier : la FK est une contrainte schéma, pas une
-- fonction RPC.

ALTER TABLE public.staff_applications
  ADD CONSTRAINT staff_applications_user_id_profile_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE RESTRICT;
