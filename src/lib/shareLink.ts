const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_UNIX = 32503680000;

/**
 * What a receive link carries in its fragment. `payload` is the base64url password envelope; the rest is readable
 * before the password is entered: when the upload expires (Unix seconds) and whether it is deleted after one download.
 */
export type ShareLink = {
  payload: string;
  expires?: number;
  burn?: boolean;
};

const unixOk = (value: number) => Number.isSafeInteger(value) && value > 0 && value < MAX_UNIX;

/**
 * Version 1 is the bare payload. Version 2 is `v=2`, the optional `x` (expiry) and `b=1` (one-time download), then
 * `p` (payload) last; it is used only when there is something to say besides the payload.
 */
export function formatShareFragment(link: ShareLink): string {
  if (!B64URL_RE.test(link.payload)) throw new Error('Invalid payload');
  const fields: string[] = [];
  if (link.expires !== undefined) {
    if (!unixOk(link.expires)) throw new Error('Invalid expiry');
    fields.push(`x=${link.expires}`);
  }
  if (link.burn) fields.push('b=1');
  if (!fields.length) return link.payload;
  return ['v=2', ...fields, `p=${link.payload}`].join('&');
}

/** The link in a fragment (without `#`, already percent-decoded), or null when it is not a share link. */
export function parseShareFragment(fragment: string): ShareLink | null {
  if (B64URL_RE.test(fragment)) return { payload: fragment };
  if (!fragment.startsWith('v=2&')) return null;
  const fields = new Map<string, string>();
  for (const part of fragment.split('&')) {
    const at = part.indexOf('=');
    if (at < 1) return null;
    const name = part.slice(0, at);
    if (fields.has(name)) return null;
    fields.set(name, part.slice(at + 1));
  }
  const payload = fields.get('p') ?? '';
  if (!B64URL_RE.test(payload)) return null;
  const link: ShareLink = { payload };
  for (const [name, value] of fields) {
    if (name === 'v' || name === 'p') continue;
    if (name === 'x') {
      if (!/^\d{1,11}$/.test(value) || !unixOk(Number(value))) return null;
      link.expires = Number(value);
    } else if (name === 'b') {
      if (value !== '1') return null;
      link.burn = true;
    }
  }
  return link;
}

