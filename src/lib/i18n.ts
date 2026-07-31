import { languages, defaultLocale, locales, type Locale } from './languages';

import en from '../locales/en.json';
import cs from '../locales/cs.json';
import de from '../locales/de.json';
import es from '../locales/es.json';
import fr from '../locales/fr.json';
import sk from '../locales/sk.json';
import pl from '../locales/pl.json';

const dictionaries: Record<string, Record<string, string>> = { en, cs, de, es, fr, sk, pl };

export { languages, defaultLocale, locales, type Locale };

export function getTranslations(locale: string | undefined): Record<string, string> {
  const l = (locale && locale in dictionaries ? locale : defaultLocale) as Locale;
  return dictionaries[l];
}

export function t(dict: Record<string, string>, key: string): string {
  return dict[key] ?? dictionaries[defaultLocale]?.[key] ?? key;
}

/** Slim dict for client islands: keep only keys under the given prefixes (plus exact keys). */
export function pickDict(
  dict: Record<string, string>,
  prefixes: string[],
  extraKeys: string[] = [],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(dict)) {
    if (prefixes.some((prefix) => key === prefix || key.startsWith(`${prefix}.`))) {
      out[key] = dict[key];
    }
  }
  for (const key of extraKeys) {
    if (key in dict) out[key] = dict[key];
  }
  return out;
}

/** Client-facing messages for a tool page (tool strings + shared help chrome + common). */
export function toolClientDict(dict: Record<string, string>, toolPrefix: string): Record<string, string> {
  return pickDict(dict, [toolPrefix, 'tools.help', 'common']);
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
