const PREFIX = 'pw=';
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const MAX_CHARS = 1024;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function withRoomKey(url: string, password: string): string {
  return `${url.split('#')[0]}#${PREFIX}${toBase64Url(new TextEncoder().encode(password))}`;
}

export function parseRoomKey(hash: string): string | null {
  const value = hash.replace(/^#/, '');
  if (!value.startsWith(PREFIX)) return null;
  const encoded = value.slice(PREFIX.length);
  if (!encoded || encoded.length > MAX_CHARS || !B64URL_RE.test(encoded) || encoded.length % 4 === 1) return null;
  try {
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    const password = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    return password || null;
  } catch {
    return null;
  }
}

/** The password a room link carries after `#`, which never reaches the server; the fragment is removed from the address bar. */
export function takeRoomKeyFromHash(): string | null {
  if (typeof location === 'undefined') return null;
  const password = parseRoomKey(location.hash);
  if (password) {
    try { history.replaceState(history.state, '', location.pathname + location.search); } catch {}
  }
  return password;
}
