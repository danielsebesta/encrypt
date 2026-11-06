import type { APIRoute } from 'astro';
import { buildSitemapXml } from '../lib/sitemap';

export const prerender = true;

/** Same document as /sitemap.xml — some SEO tools look for /sitemap. */
export const GET: APIRoute = () =>
  new Response(buildSitemapXml(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
