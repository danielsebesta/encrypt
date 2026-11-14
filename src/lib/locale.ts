import { defaultLocale, locales, type Locale } from './languages';

export const LANG_COOKIE = 'ec-lang';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const CHOICE_PREFIX = '/_lang/';

const isLocale = (value: string): value is Locale => (locales as string[]).includes(value);

/** Locale encoded in the first path segment, or null for the unprefixed default. */
export function localeInPath(pathname: string): Locale | null {
  const first = pathname.split('/')[1] ?? '';
  return isLocale(first) ? first : null;
}

/** Best supported locale for an Accept-Language header, by q-value, matching on the primary subtag. */
export function pickLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const ranked = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { base: tag.trim().toLowerCase().split('-')[0], weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((item) => item.base && item.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const item of ranked) if (isLocale(item.base)) return item.base;
  return defaultLocale;
}

export function localeFromCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === LANG_COOKIE && value && isLocale(value)) return value;
  }
  return null;
}

function langCookie(locale: Locale): string {
  return `${LANG_COOKIE}=${locale}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax; Secure; HttpOnly`;
}

/** True for navigations to HTML pages. Assets, APIs and realtime sockets are never redirected. */
function isPageRequest(request: Request, pathname: string): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (pathname.startsWith('/api/') || pathname.startsWith('/parties/') || pathname.startsWith('/_astro/')) return false;
  if (/\.[a-z0-9]+$/i.test(pathname)) return false;
  const accept = request.headers.get('Accept') ?? '';
  return accept.includes('text/html') || accept === '*/*' || accept === '';
}

/** Link target that records a language choice and continues to `to`, with or without JavaScript. */
export function languageChoiceHref(locale: Locale, to: string): string {
  return `${CHOICE_PREFIX}${locale}?to=${encodeURIComponent(to)}`;
}

// The URL parser drops tabs and newlines, so `/\t/evil.tld` only turns protocol-relative after parsing; compare origins on the parsed result.
export function sameOriginTarget(to: string | null, origin: string): string {
  const home = new URL('/', origin).href;
  if (!to || !to.startsWith('/')) return home;
  try {
    const target = new URL(to, origin);
    return target.origin === origin ? new URL(target.pathname + target.search, origin).href : home;
  } catch {
    return home;
  }
}

/**
 * Server-side language handling. The language is never part of a URL:
 * - `/_lang/<code>?to=<path>` stores the choice in a cookie and continues to the same-origin path;
 * - a page requested under a language prefix (`/cs/chat`) is permanently redirected to the same path without it;
 * - a page without a prefix is answered in the cookie language, or the browser language on the first visit, by
 *   rendering the prefixed page for that request (see `localizedRequest`). The address bar and shared links stay clean.
 */
export function localeResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith(CHOICE_PREFIX)) {
    const code = path.slice(CHOICE_PREFIX.length).replace(/\/$/, '');
    if (!isLocale(code)) return new Response('Not found', { status: 404 });
    return new Response(null, {
      status: 303,
      headers: { Location: sameOriginTarget(url.searchParams.get('to'), url.origin), 'Set-Cookie': langCookie(code), 'Cache-Control': 'no-store' },
    });
  }

  const prefixed = localeInPath(path);
  if (!prefixed || !isPageRequest(request, path)) return null;
  const rest = path.slice(prefixed.length + 1) || '/';
  return new Response(null, {
    status: 301,
    headers: { Location: new URL(rest + url.search, url.origin).href, 'Cache-Control': 'public, max-age=3600' },
  });
}

/** True when the answer to this unprefixed page request depends on the visitor's language settings. */
export function varyByLanguage(request: Request): boolean {
  const path = new URL(request.url).pathname;
  return !localeInPath(path) && isPageRequest(request, path);
}

/** The request to render for an unprefixed page: the prefixed page of the visitor's language, or null for English. */
export function localizedRequest(request: Request): Request | null {
  const url = new URL(request.url);
  if (!varyByLanguage(request)) return null;
  const chosen = localeFromCookie(request.headers.get('Cookie')) ?? pickLocale(request.headers.get('Accept-Language'));
  if (chosen === defaultLocale) return null;
  url.pathname = `/${chosen}${url.pathname === '/' ? '/' : url.pathname}`;
  return new Request(url, request);
}
