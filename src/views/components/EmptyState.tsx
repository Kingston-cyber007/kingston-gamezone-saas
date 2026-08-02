import { Logo } from "./Logo";

/**
 * EmptyState — étape 3D.
 * Composant présentationnel réutilisable pour tous les états "sans contenu"
 * (Salle inactive, liste tickets vide, historique caisse vide, etc.).
 *
 * Identité visuelle :
 * - Watermark Logo SVG size="sm" en arrière-plan, opacité ~8%, pour rappeler
 *   la marque sans dominer la page (cohérent avec 3B — pas de nouveau logo).
 * - Emoji + titre (Oswald) + body optionnel (Inter gris neutre).
 * - Action optionnelle (bouton secondary).
 * - Gradient violet→cyan très subtil sur le fond, hérité de --kg-gradient-soft.
 *
 * Pas d'animation forte par défaut — respecte prefers-reduced-motion via CSS.
 */
export interface EmptyStateProps {
  icon: string;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  variant?: "salle" | "tickets" | "caisse" | "stats";
}

export function EmptyState({ icon, title, body, action, variant }: EmptyStateProps) {
  return (
    <div className="kg-empty" data-variant={variant ?? "default"}>
      <Logo size="sm" className="kg-empty-watermark" aria-hidden="true" />
      <div className="kg-empty-content">
        <div className="kg-empty-icon" aria-hidden="true">{icon}</div>
        <h3 className="kg-empty-title">{title}</h3>
        {body && <p className="kg-empty-body">{body}</p>}
        {action && (
          <button className="kg-empty-action" onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}