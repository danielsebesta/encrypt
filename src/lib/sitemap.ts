import { locales, type Locale } from './languages';
import { siteOrigin } from './siteBrand';
import { tools } from './tools';

/** Indexable public paths without locale prefix (leading slash, no trailing slash except home). */
export const SITEMAP_PATHS = [
  '/',
  '/share',
  '/u',
  '/security',
  '/chat',
  '/whiteboard',
  '/app',
  ...tools.map((tool) => `/tools/${tool.slug}`),
] as const;

function localePath(locale: Locale, path: string): string {
  if (locale === 'en') return path === '/' ? '/' : path;
  if (path === '/') return `/${locale}/`;
  return `/${locale}${path}`;
}

function absolute(origin: string, path: string): string {
  return new URL(path, `${origin}/`).href;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** Sitemap URL set with hreflang alternates for every public page × locale. */
export function buildSitemapXml(origin = siteOrigin()): string {
  const base = origin.replace(/\/$/, '');
  const urls: string[] = [];

  for (const path of SITEMAP_PATHS) {
    const loc = absolute(base, localePath('en', path));
    const alternates = locales
      .map((locale) => {
        const href = absolute(base, localePath(locale, path));
        return `    <xhtml:link rel="alternate" hreflang="${locale}" href="${escapeXml(href)}"/>`;
      })
      .concat([`    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(loc)}"/>`])
      .join('\n');

    // One <url> entry per locale so each localized URL is a primary loc.
    for (const locale of locales) {
      const pageLoc = absolute(base, localePath(locale, path));
      urls.push(
        [
          '  <url>',
          `    <loc>${escapeXml(pageLoc)}</loc>`,
          alternates,
          '  </url>',
        ].join('\n'),
      );
    }
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
