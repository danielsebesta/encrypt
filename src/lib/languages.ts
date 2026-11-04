export const languages = {
  en: { name: 'English' },
  cs: { name: 'Čeština' },
  de: { name: 'Deutsch' },
  es: { name: 'Español' },
  fr: { name: 'Français' },
  sk: { name: 'Slovenčina' },
  pl: { name: 'Polski' },
} as const;

export type Locale = keyof typeof languages;
export const defaultLocale: Locale = 'en';
export const locales = Object.keys(languages) as Locale[];
