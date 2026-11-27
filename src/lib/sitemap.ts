import { siteOrigin } from './siteBrand';
import { tools } from './tools';

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
