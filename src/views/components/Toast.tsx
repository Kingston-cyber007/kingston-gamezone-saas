import { create } from 'zustand';
import { useEffect } from 'react';

/**
 * Toast container + store — Kingston GameZone (RT.T.0).
 *
 * Pourquoi un store Zustand au lieu d'une variable de module globale `let addToast` :
 *  - La version précédente enregistrait `add` via `useEffect(() => { addToast = add }, [add])`
 *    → race condition React 19 StrictMode (mount → unmount → mount) qui remettait
 *    `addToast = null` entre deux frames et faisait échouer silencieusement `showToast`
 *    avec `TypeError: Cannot read properties of null`.
 *  - Le store Zustand est synchrone, accessible depuis n'importe quel module sans
 *    `useEffect`, et survivant aux démontages/remontages de conteneurs.
 *  - Bonus : `<ToastContainer />` peut maintenant être monté UNE seule fois dans
 *    `__root.tsx` (au lieu de 2 fois dans `/app` et `/platform` + jamais dans `/client`),
 *    ce qui supprime la dette UX #14 et évite le double-mount lors d'une navigation
 *    inter-espaces.
 *
 * API publique inchangée : `showToast(msg, icon?, color?)` reste appelable partout
 * sans hook React. Le composant `ToastContainer` se contente de `useToasts()`
 * pour s'abonner au store.
 */

interface ToastItem {
  // RT.P.0-fix — id passé de `number` à `string` (UUID v4) pour éviter toute
  // collision entre toasts concurrents (cf. dette #3 collision d'ID documentée).
  id: string;
  msg: string;
  icon: string;
  color?: string;
}

interface ToastStore {
  toasts: ToastItem[];
  push: (msg: string, icon?: string, color?: string) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (msg, icon = '✅', color) => {
    // RT.P.0-fix — utilisation de crypto.randomUUID() (avec fallback)
    // pour éviter toute collision d'ID entre toasts concurrents.
    const id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    set((s) => ({ toasts: [...s.toasts, { id, msg, icon, color }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/**
 * Fonction d'affichage — appelable depuis n'importe où (composant, hook,
 * callback Supabase realtime, etc.) sans hook React. Délègue au store Zustand.
 */
export function showToast(msg: string, icon = '✅', color?: string) {
  useToastStore.getState().push(msg, icon, color);
}

/** Hook interne — réservé à `<ToastContainer>`. Pas d'usage hors composant. */
function useToasts() {
  return useToastStore((s) => s.toasts);
}

/**
 * Conteneur visuel — à monter UNE seule fois en haut de l'arbre (cf. `__root.tsx`).
 * Auto-fermeture 3s gérée par le store, pas par le composant.
 * Respecte `role="status"` + `aria-live="polite"` pour les lecteurs d'écran.
 */
export function ToastContainer() {
  const toasts = useToasts();

  // Effet de bord : si le store change entre deux navigations inter-espaces,
  // on s'assure que les anciens timers `setTimeout` du store ne fuitent pas.
  // Zustand gère déjà la fermeture via `dismiss`, mais ce useEffect documente
  // l'intention pour les futurs lecteurs.
  useEffect(() => {
    // No-op intentionnel — la fermeture est pilotée par le store.
  }, [toasts.length]);

  return (
    <div
      className="kg-toast-container"
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="kg-toast"
          style={t.color ? { ['--toast-accent' as string]: t.color } : undefined}
        >
          <span className="kg-toast-icon" aria-hidden="true">{t.icon}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}