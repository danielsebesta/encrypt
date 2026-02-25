export const languages = {
  en: { name: 'English', flag: '🇬🇧' },
  cs: { name: 'Čeština', flag: '🇨🇿' },
} as const;

export type Locale = keyof typeof languages;
export const defaultLocale: Locale = 'en';
export const locales = Object.keys(languages) as Locale[];
