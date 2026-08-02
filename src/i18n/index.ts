import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fr } from './fr';
import { en } from './en';
import { ln } from './ln';

export type Locale = 'fr' | 'en' | 'ln';

export const LOCALES: { value: Locale; label: string; flag: string }[] = [
  { value: 'fr', label: 'Français', flag: '🇫🇷' },
  { value: 'en', label: 'English', flag: '🇬🇧' },
  { value: 'ln', label: 'Lingala', flag: '🇨🇬' },
];

type TranslationDict = Record<string, string>;

// All locales — missing keys fall back to French
const locales: Record<Locale, Partial<TranslationDict>> = { fr, en, ln };

interface I18nState {
  locale: Locale;
  setLocale: (l: Locale) => void;
}

export const useI18n = create<I18nState>()(
  persist(
    (set) => ({
      locale: 'fr',
      setLocale: (locale) => set({ locale }),
    }),
    { name: 'kg_locale' }
  )
);

/**
 * Returns a translation function scoped to the current locale.
 * Falls back to French when the key is absent in the active locale.
 * Falls back to `fallback` (or the key itself) as last resort.
 *
 * Usage:
 *   const t = useT();
 *   <span>{t('nav_salle')}</span>
 */
export function useT() {
  const { locale } = useI18n();
  return function t(key: string, fallback?: string): string {
    const dict = locales[locale] as TranslationDict;
    const baseFr = locales['fr'] as TranslationDict;
    return dict[key] ?? baseFr[key] ?? fallback ?? key;
  };
}
