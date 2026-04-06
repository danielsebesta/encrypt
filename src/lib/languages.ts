export const languages = {
  en: { name: 'English', flag: '🇬🇧' },
  cs: { name: 'Čeština', flag: '🇨🇿' },
  de: { name: 'Deutsch', flag: '🇩🇪' },
  es: { name: 'Español', flag: '🇪🇸' },
  fr: { name: 'Français', flag: '🇫🇷' },
  sk: { name: 'Slovenčina', flag: '🇸🇰' },
  pl: { name: 'Polski', flag: '🇵🇱' },
} as const;

export type Locale = keyof typeof languages;
export const defaultLocale: Locale = 'en';
export const locales = Object.keys(languages) as Locale[];
