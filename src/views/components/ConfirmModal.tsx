import { useEffect, useRef } from "react";

/**
 * Modale de confirmation réutilisable — Kingston GameZone (RT.B V2).
 *
 * Pourquoi ce composant existe : la V1 du dashboard utilisait `window.confirm()`
 * natif qui cassait la charte KG (boîte grise du navigateur). V2 introduit cette
 * modale stylée violet, accessible (ARIA dialog, ESC, focus management) et
 * réutilisable (V3 s'en sert déjà pour la révocation de rôle).
 *
 * Comportement :
 *  - `open=false` → ne rend rien (le composant parent gère l'affichage via state).
 *  - ESC ferme la modale (= annule).
 *  - Click sur l'overlay ferme (= annule).
 *  - Click à l'intérieur de la carte ne ferme PAS.
 *  - À l'ouverture, focus auto sur le bouton de confirmation pour éviter un
 *    piège clavier (l'utilisateur peut valider avec Espace/Entrée).
 */
export interface ConfirmModalProps {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style "danger" : bouton de confirmation rouge au lieu de violet. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // ESC + focus auto
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    // Focus le bouton de confirmation à l'ouverture
    confirmRef.current?.focus();
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="kg-platform-modal-overlay"
      onClick={(e) => {
        // Click sur l'overlay (= hors de la carte) = annuler
        if (e.target === e.currentTarget) onCancel();
      }}
      role="presentation"
    >
      <div
        className="kg-platform-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kg-confirm-modal-title"
      >
        <h3 id="kg-confirm-modal-title" className="kg-platform-modal-title">
          {title}
        </h3>
        {body && <div className="kg-confirm-modal-body">{body}</div>}
        <div className="kg-platform-modal-actions">
          <button
            type="button"
            onClick={onCancel}
            className="kg-platform-button kg-platform-button--ghost"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={
              danger ? "kg-platform-button kg-platform-button--danger" : "kg-platform-button"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
