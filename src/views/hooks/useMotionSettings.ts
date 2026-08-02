import { useEffect, useState } from "react";
import { useStore } from "../../store/useStore";

export type MotionIntensity = "off" | "subtle" | "normal";

/**
 * useMotionSettings — étape 3E.
 * Source unique de vérité pour la "force" des animations à l'écran.
 *
 * Combine deux choses :
 * - `settings.motionIntensity` : préférence utilisateur (off / subtle / normal)
 * - `prefers-reduced-motion` OS : si le système le force, on rétrograde
 *   automatiquement vers 'off' quoi que l'utilisateur ait choisi.
 *
 * Retourne :
 * - `intensity` : niveau effectif ('off' | 'subtle' | 'normal')
 * - `prefersReduced` : true si le système force reduce-motion
 * - `motionAttr` : valeur à poser sur `<html data-motion="…">` pour piloter le CSS
 *
 * Source unique : appelée une fois dans __root.tsx pour poser l'attribut,
 * réutilisable partout si un composant a besoin de décider localement
 * (ex: ne pas monter un timer si 'off').
 */
export function useMotionSettings() {
  const motionIntensity = useStore((s) => s.settings.motionIntensity);
  const [prefersReduced, setPrefersReduced] = useState(false);

  // Capture prefers-reduced-motion côté OS, avec listener de changement
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const intensity: MotionIntensity = prefersReduced ? "off" : motionIntensity;

  // Valeur d'attribut : 'off' | 'subtle' | 'normal' — pilote le CSS global
  const motionAttr = intensity;

  return { intensity, prefersReduced, motionAttr };
}