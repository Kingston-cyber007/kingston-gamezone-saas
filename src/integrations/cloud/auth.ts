// Wrapper d'auth OAuth — RT.H.2 — bascule vers @supabase/supabase-js natif.
// On garde la même surface d'API `cloud.auth.signInWithOAuth` pour ne rien
// casser côté consommateurs (auth.tsx). Le nom "cloud" reste car il décrit
// le rôle d'orchestrateur d'identité, pas le branding éditeur.
//
// ND6 — Fix #6 (03/08/2026) : suppression de `@lovable.dev/cloud-auth-js`
// du `package.json` (dépendance morte — non importée). Le shim utilise
// directement `supabase.auth.signInWithOAuth`.

import { supabase } from "../supabase/client";

type SignInOptions = {
  redirect_uri?: string;
  extraParams?: Record<string, string>;
};

export const cloud = {
  auth: {
    signInWithOAuth: async (
      provider: "google" | "apple" | "microsoft" | "lovable",
      opts?: SignInOptions,
    ) => {
      if (provider === "lovable") {
        return {
          error: new Error(
            "Le provider 'lovable' n'est pas supporté hors de l'éditeur Lovable. Utilise Google.",
          ),
        };
      }

      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider as "google" | "apple",
        options: {
          redirectTo: opts?.redirect_uri ?? window.location.origin,
          queryParams: opts?.extraParams,
        },
      });

      if (error) {
        return { error, redirected: false };
      }

      // Supabase redirige automatiquement vers le provider ; `data.url` est l'URL à ouvrir.
      if (data?.url) {
        window.location.href = data.url;
        return { redirected: true };
      }

      return { redirected: false };
    },
  },
};

