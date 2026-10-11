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

/**
 * Server-side language handling for one request:
 * - `/_lang/<code>?to=<path>` stores the choice in a cookie and continues to the same-origin path;
 * - an unprefixed page is redirected to the cookie language, or to the browser language on the first visit;
 * - a prefixed page is served as linked, so shared links keep their language.
 */
export function localeResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith(CHOICE_PREFIX)) {
    const code = path.slice(CHOICE_PREFIX.length).replace(/\/$/, '');
    if (!isLocale(code)) return new Response('Not found', { status: 404 });
    const to = url.searchParams.get('to') ?? '/';
    const safe = to.startsWith('/') && !to.startsWith('//') && !to.includes('\\') ? to : '/';
    return new Response(null, {
      status: 303,
      headers: { Location: new URL(safe, url.origin).href, 'Set-Cookie': langCookie(code), 'Cache-Control': 'no-store' },
    });
  }

  if (!isPageRequest(request, path) || localeInPath(path)) return null;
  const chosen = localeFromCookie(request.headers.get('Cookie')) ?? pickLocale(request.headers.get('Accept-Language'));
  if (chosen === defaultLocale) return null;
  const target = `/${chosen}${path === '/' ? '/' : path}${url.search}`;
  return new Response(null, {
    status: 302,
    headers: { Location: new URL(target, url.origin).href, Vary: 'Accept-Language, Cookie', 'Cache-Control': 'private, no-store' },
  });
}
