import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Échappe les caractères HTML sensibles pour prévenir l'injection XSS
 * lors d'interpolation dans un template HTML (utilisé par window.open / document.write).
 *
 * Corrige ND1 (audit 2026-08-03) — XSS dans printRapport (Caisse.tsx)
 * et printTicket (Tickets.tsx).
 *
 * Caractères échappés : & < > " '
 *
 * @param s Chaîne à échapper (null/undefined → chaîne vide)
 * @returns Chaîne safe pour interpolation HTML
 */
export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
