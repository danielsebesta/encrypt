import { siteOrigin } from './siteBrand';
import { tools } from './tools';

/** Indexable public paths without locale prefix (leading slash, no trailing slash except home). */
export const SITEMAP_PATHS = [
  '/',
  '/share',
  '/u',
  '/install',
  '/security',
  '/licenses',
  '/chat',
  '/whiteboard',
  '/app',
  ...tools.map((tool) => `/experiments/${tool.slug}`),
] as const;

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

/** Sitemap of the public pages. Language is a visitor setting, not part of the URL, so there is one entry per page. */
export function buildSitemapXml(origin = siteOrigin()): string {
  const base = origin.replace(/\/$/, '');
  const urls = SITEMAP_PATHS.map((path) => `  <url>\n    <loc>${escapeXml(absolute(base, path))}</loc>\n  </url>`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}
