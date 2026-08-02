import { useEffect, useState } from "react";
import { Logo } from "./Logo";

/**
 * Splash screen Kingston GameZone — étape 3C, harmonisé en RT.B.7.
 * - Monté comme `pendingComponent` sur le routeur racine (`__root.tsx`).
 * - Respecte `prefers-reduced-motion` : aucune animation, particules désactivées.
 * - Disparaît dès que la première décision de routing est prise (transitoire par design).
 */
export function SplashScreen() {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <div className="kg-splash min-h-screen w-full flex items-center justify-center bg-[radial-gradient(ellipse_at_top,#1a0f2e,#0a0614)] overflow-hidden relative">
      {/* Particules décoratives (emoji GameZone) — uniquement si reduce-motion=false */}
      {!reduceMotion && (
        <div className="kg-splash-particles absolute inset-0 pointer-events-none">
          {["🎮", "⭐", "🏆", "⚡", "👾", "🎯", "💥", "🕹️"].map((emoji, i) => (
            <span
              key={i}
              className="kg-splash-particle"
              style={{
                left: `${(i * 13 + 7) % 95}%`,
                animationDelay: `${i * 0.8}s`,
                animationDuration: `${8 + (i % 4) * 3}s`,
              }}
            >
              {emoji}
            </span>
          ))}
        </div>
      )}

      {/* Logo centré + tagline — z-10 pour passer au-dessus des particules */}
      <div className="kg-splash-logo relative z-10 flex flex-col items-center gap-4">
        <Logo size="lg" className="h-32 sm:h-40" />
        <p className="text-sm text-gray-400 tracking-widest uppercase">
          Plateforme SaaS multi-salles
        </p>
      </div>
    </div>
  );
}
