import { useEffect, useRef } from "react";
import { useState } from "react";

/**
 * Modale de confirmation à double saisie — Kingston GameZone (CHANTIER 3).
 *
 * Pattern identique à ConfirmModal + champ texte obligatoire.
 * L'utilisateur doit taper exactement `confirmWord` (par défaut "SUPPRIMER",
 * insensible à la casse) pour activer le bouton de validation.
 *
 * Pourquoi ce composant existe :
 *  - C.1 (auto-suppression /client) et C.3 (admin anonymisation /platform)
 *    partagent exactement le même pattern : action irréversible + saisie d'un
 *    mot-clé. Plutôt que dupliquer le JSX dans 2 fichiers, on factorise ici.
 *  - Réutilisable pour toute future action irréversible (purge hard-delete
 *    compte en dette #29, reset DB salle, etc.).
 *
 * Sécurité :
 *  - `open=false` → ne rend rien.
 *  - ESC ferme (= annule, comme ConfirmModal).
 *  - Click sur l'overlay ferme (= annule).
 *  - Bouton de validation DÉSACTIVÉ tant que la saisie ne match pas
 *    `confirmWord` (côté TS, pas juste cosmétique).
 *  - À l'ouverture, focus auto sur l'input.
 */
export interface DoubleConfirmModalProps {
  open: boolean;
  title: string;
  /** Mot à taper pour valider (défaut "SUPPRIMER"). Insensible à la casse. */
  confirmWord?: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style "danger" : bouton de confirmation rouge au lieu de violet. */
  danger?: boolean;
  /** Si fourni, le bouton est désactivé pendant l'appel. */
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DoubleConfirmModal({
  open,
  title,
  confirmWord = "SUPPRIMER",
  body,
  confirmLabel = "Confirmer",
  cancelLabel = "Annuler",
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: DoubleConfirmModalProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset à la fermeture + focus à l'ouverture.
  useEffect(() => {
    if (open) {
      setText("");
      // Petit délai pour laisser le composant rendre avant focus (évite
      // les warnings React StrictMode sur ref pas encore attachée).
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  // ESC → annule.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  // Pas de rendu si fermé.
  if (!open) return null;

  const trimmed = text.trim();
  const matches = trimmed.toUpperCase() === confirmWord.toUpperCase();
  const canConfirm = matches && !loading;

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
        aria-labelledby="kg-double-confirm-title"
      >
        <h3 id="kg-double-confirm-title" className="kg-platform-modal-title">
          {title}
        </h3>
        {body && <div className="kg-confirm-modal-body">{body}</div>}
        <label
          htmlFor="kg-double-confirm-input"
          className="kg-delete-account-confirm-label"
        >
          Tape {confirmWord} pour confirmer
        </label>
        <input
          ref={inputRef}
          id="kg-double-confirm-input"
          type="text"
          className="kg-delete-account-confirm-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={confirmWord}
          autoComplete="off"
          spellCheck={false}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canConfirm) {
              e.preventDefault();
              onConfirm();
            }
          }}
        />
        <p className="kg-delete-account-confirm-hint">
          Astuce : tu peux aussi appuyer sur Entrée une fois {confirmWord} tapé.
        </p>
        <div className="kg-platform-modal-actions">
          <button
            type="button"
            onClick={onCancel}
            className="kg-platform-button kg-platform-button--ghost"
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              danger
                ? "kg-platform-button kg-platform-button--danger"
                : "kg-platform-button"
            }
            disabled={!canConfirm}
            aria-disabled={!canConfirm}
          >
            {loading ? "Suppression…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}