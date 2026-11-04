import { envString } from '../platform/env';

/** Upstream product name — navbar, footer brand, crypto protocol labels. */
export const PRODUCT_NAME = 'encrypt.click';
export const PRODUCT_ORIGIN = 'https://encrypt.click';

const MAX_NAME = 64;
// The name is spliced into HTML and script contexts raw, so quotes, backslashes, backticks and markup are out.
const NAME_RE = /^[^\x00-\x1f<>"'\\`&]{1,64}$/;

function cleanName(raw: string): string {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value || value === PRODUCT_NAME || !NAME_RE.test(value) || value.length > MAX_NAME) return PRODUCT_NAME;
  return value;
}

/** Display brand for UI copy. Unset → encrypt.click (no white-label). */
export function siteName(): string {
  return cleanName(envString('SITE_NAME'));
}

export function isWhitelabeled(): boolean {
  return siteName() !== PRODUCT_NAME;
}

/** Public origin for canonical/og links. Prefers PUBLIC_URL. */
export function siteOrigin(fallback = PRODUCT_ORIGIN): string {
  const raw = envString('PUBLIC_URL');
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* ignore */
    }
  }
  const domain = envString('DOMAIN');
  if (domain && /^[A-Za-z0-9.-]+$/.test(domain)) return `https://${domain}`;
  return fallback;
}

export function siteHost(fallback = 'encrypt.click'): string {
  try {
    return new URL(siteOrigin(`https://${fallback}`)).hostname;
  } catch {
    return fallback;
  }
}

/** Security contact shown in disclosure copy. */
export function siteContact(): string {
  const email = envString('SITE_CONTACT_EMAIL').trim();
  if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 128) return email;
  const host = siteHost();
  if (isWhitelabeled() && host !== 'encrypt.click') return `security@${host}`;
  return 'mail@encrypt.click';
}

function shortenerHost(): string | null {
  const raw = envString('SHORTENER_URL');
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

// `l.encrypt.click` must match as a whole host label, not inside another name like `portal.encrypt.click`.
const SHORTENER_HOST_RE = /(?<![A-Za-z0-9@._-])l\.encrypt\.click/g;

/** Rewrite user-facing brand mentions. Leaves `encrypt.click/` and `encrypt.click:` protocol labels alone when used via brandHtml. */
export function brandText(input: string): string {
  const name = siteName();
  if (name === PRODUCT_NAME) return input;
  const host = siteHost();
  const contact = siteContact();
  const shortHost = shortenerHost() ?? host;
  let out = input;
  out = out.replaceAll('https://encrypt.click', siteOrigin());
  out = out.replaceAll(SHORTENER_HOST_RE, shortHost);
  out = out.replaceAll('mail@encrypt.click', contact);
  out = out.replaceAll('encrypt.click/u', `${host}/u`);
  out = out.replaceAll("encrypt.click's", `${name}'s`);
  out = out.replaceAll('Encrypt.click', name);
  out = out.replaceAll('encrypt.click', name);
  return out;
}

const PRODUCT_MARK = '\uE000PRODUCT\uE001';
const PROTO_MARK = '\uE000PROTO\uE001';

/**
 * Brand prerendered HTML/JSON while keeping the product name in the nav/footer
 * and leaving crypto / storage protocol labels (`encrypt.click/` and `encrypt.click:`) intact.
 */
export function brandHtml(input: string): string {
  if (!isWhitelabeled()) return input;
  const host = siteHost();
  const shortHost = shortenerHost() ?? host;
  let out = input;
  // Keep the product name in the nav/footer brand mark.
  out = out.replaceAll(`>${PRODUCT_NAME}<`, `>${PRODUCT_MARK}<`);
  // Rewrites that must run before protocol-label protection (those use encrypt.click/).
  out = out.replaceAll(PRODUCT_ORIGIN, siteOrigin());
  out = out.replaceAll('encrypt.click/u', `${host}/u`);
  out = out.replaceAll(SHORTENER_HOST_RE, shortHost);
  // Leave crypto / storage labels intact (encrypt.click/chat/…, encrypt.click:alias:…).
  out = out.replaceAll(/encrypt\.click([/:])/g, `${PROTO_MARK}$1`);
  out = brandText(out);
  out = out.replaceAll(PRODUCT_MARK, PRODUCT_NAME);
  out = out.replaceAll(PROTO_MARK, PRODUCT_NAME);
  return out;
}

function brandableType(type: string | null): 'html' | 'text' | null {
  if (!type) return null;
  const lower = type.toLowerCase();
  if (lower.includes('text/html')) return 'html';
  // PWA manifest only — never rewrite API JSON or build-integrity.json.
  if (lower.includes('application/manifest') || lower.includes('webmanifest')) return 'text';
  return null;
}

function weakEtag(body: string): string {
  let hash = 2166136261;
  for (let i = 0; i < body.length; i++) hash = Math.imul(hash ^ body.charCodeAt(i), 16777619);
  return `W/"wl-${(hash >>> 0).toString(16)}"`;
}

/** Rewrite brandable response bodies when SITE_NAME is set. No-op otherwise. */
export async function applySiteBrand(response: Response): Promise<Response> {
  if (!isWhitelabeled()) return response;
  if (response.status === 304 || response.status === 204) return response;
  const kind = brandableType(response.headers.get('content-type'));
  if (!kind || response.headers.get('content-range')) return response;
  const text = await response.text();
  const branded = kind === 'html' ? brandHtml(text) : brandText(text);
  if (branded === text) return new Response(text, { status: response.status, statusText: response.statusText, headers: response.headers });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('ETag', weakEtag(branded));
  headers.set('Cache-Control', 'private, no-cache');
  return new Response(branded, { status: response.status, statusText: response.statusText, headers });
}
