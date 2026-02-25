import { languages, defaultLocale, locales, type Locale } from './languages';

import en from '../locales/en.json';
import cs from '../locales/cs.json';

const dictionaries: Record<string, Record<string, string>> = { en, cs };

export { languages, defaultLocale, locales, type Locale };

export function getTranslations(locale: string | undefined): Record<string, string> {
  const l = (locale && locale in dictionaries ? locale : defaultLocale) as Locale;
  return dictionaries[l];
}

export function t(dict: Record<string, string>, key: string): string {
  return dict[key] ?? dictionaries[defaultLocale]?.[key] ?? key;
}

export function getLocalePath(currentPath: string, targetLocale: Locale): string {
  let cleanPath = currentPath;
  for (const l of locales) {
    if (l === defaultLocale) continue;
    if (cleanPath.startsWith(`/${l}/`)) {
      cleanPath = cleanPath.slice(l.length + 1) || '/';
      break;
    }
    if (cleanPath === `/${l}`) {
      cleanPath = '/';
      break;
    }
  }
  if (targetLocale === defaultLocale) return cleanPath;
  return cleanPath === '/' ? `/${targetLocale}/` : `/${targetLocale}${cleanPath}`;
}
