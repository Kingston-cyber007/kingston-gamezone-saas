import { useMemo } from "react";
import { Logo } from "./Logo";
import { useStore } from "../../store/useStore";
import { useSession, useUserAccess } from "@/lib/session";

/**
 * PowerCutOverlay — étape 3D.
 * Overlay global qui fige visuellement l'espace `app/*` (PC de la caisse)
 * quand une coupure électricité est active.
 *
 * Décisions actées :
 * - Couvre UNIQUEMENT `_authenticated/app/*` (monté dans app/route.tsx).
 *   Pas `/`, pas `/auth`, pas `/platform/*`, pas `/client/*` — un admin
 *   SaaS doit pouvoir continuer à intervenir à distance.
 * - Bouton "Reprise manuelle" visible uniquement pour lounge_admin
 *   ou platform_admin. Pour les autres (staff), l'overlay reste
 *   affichée jusqu'à ce qu'un gérant le désactive ou que l'app recharge.
 * - Reprise = `setPowerCut(false)` + reprise poste par poste de tous
 *   les postes en pause (`paused: true`), en recréant `endsAt = now + remainingMs`.
 * - Pas de synchro Supabase : local Zustand uniquement (règle 1 — pas
 *   d'anticipation sur l'étape 6 offline-first).
 */
export function PowerCutOverlay() {
  const { powerCutActive, setPowerCut, postes, updatePoste } = useStore();
  const { user } = useSession();
  const { isPlatformAdmin, staffTenants } = useUserAccess(user);

  const canManage = useMemo(() => {
    if (isPlatformAdmin) return true;
    // staff avec au moins un tenant => considéré comme gérant de sa salle
    return staffTenants.length > 0;
  }, [isPlatformAdmin, staffTenants.length]);

  const pausedCount = postes.filter((p) => p.status === "busy" && p.paused).length;

  if (!powerCutActive) return null;

  function handleResume() {
    const now = Date.now();
    postes
      .filter((p) => p.status === "busy" && p.paused)
      .forEach((p) => {
        updatePoste(p.id, {
          paused: false,
          endsAt: now + (p.remainingMs ?? 0),
          remainingMs: null,
        });
      });
    setPowerCut(false);
  }

  return (
    <div className="kg-powercut" role="alertdialog" aria-live="assertive" aria-label="Coupure électricité active">
      <div className="kg-powercut-inner">
        <div className="kg-powercut-pulse">
          <Logo size="lg" className="kg-powercut-logo" />
        </div>
        <h1 className="kg-powercut-title">⚡ Coupure électricité</h1>
        <p className="kg-powercut-sub">
          L'application reprendra automatiquement à la reconnexion.
        </p>
        <p className="kg-powercut-meta">
          {pausedCount > 0
            ? `${pausedCount} session${pausedCount > 1 ? "s" : ""} en pause — temps sauvegardé${pausedCount > 1 ? "s" : ""} sur les tickets clients.`
            : "Aucune session active au moment de la coupure."}
        </p>
        <p className="kg-powercut-tagline">Plateforme SaaS multi-salles</p>
        {canManage && (
          <button
            className="kg-powercut-resume"
            onClick={handleResume}
            title="Reprise manuelle (gérant uniquement)"
          >
            ✓ Reprise manuelle
          </button>
        )}
      </div>
    </div>
  );
}