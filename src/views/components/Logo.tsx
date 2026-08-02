import kgLogoPng from "@/assets/logo.png?url";

type LogoSize = "sm" | "lg";

/**
 * Composant Logo — Kingston GameZone (étape 3B)
 * - size="lg" : vrai PNG du logo complet (page /auth, landing /exports, splash futur 3C, écrans vides)
 * - size="sm" : monogramme "KG" en SVG inline, dégradé violet→cyan (topbars authentifiées : app, client, platform)
 *
 * Le SVG "sm" est inline (pas de fichier externe) pour :
 *  - éviter un round-trip HTTP supplémentaire
 *  - permettre le sizing via className (le SVG n'impose pas de width/height fixes)
 *  - rester cohérent avec le favicon Fav-C prévu (monogramme KG dégradé violet→cyan)
 *
 * Le PNG "lg" impose quant à lui ses proportions natives ; le sizing passe par className.
 */
export function Logo({ size = "lg", className = "" }: { size?: LogoSize; className?: string }) {
  if (size === "lg") {
    // Le PNG complet. La classe `object-contain` préserve les proportions.
    return (
      <img
        src={kgLogoPng}
        alt="Kingston GameZone"
        className={`object-contain drop-shadow-[0_0_20px_rgba(124,58,237,0.35)] ${className}`}
      />
    );
  }

  // Monogramme "KG" en SVG — viewBox 0 0 36 36, scalable via className.
  // Dégradé violet→cyan (même angle 135° que --kg-gradient).
  // Couleurs alignées avec src/views/theme.css (palette KG : violet/cyan).
  return (
    <svg
      viewBox="0 0 36 36"
      role="img"
      aria-label="Kingston GameZone"
      className={className}
    >
      <defs>
        <linearGradient id="kg-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="36" height="36" rx="8" fill="url(#kg-gradient)" />
      <text
        x="18"
        y="18"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Oswald, sans-serif"
        fontWeight={700}
        fontSize="18"
        fill="#ffffff"
        letterSpacing="0.5"
      >
        KG
      </text>
    </svg>
  );
}