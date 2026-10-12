const ALLOWED_FETCH_HOSTS = new Set([
  'dl.encrypt.click',
  'upload.nolog.cz',
  'send.codespace.cz',
  'send.adminforge.de',
  'send.mni.li',
  'send.artemislena.eu',
  'send.vis.ee',
  'send.turingpoint.de',
  'drop.chapril.org',
  'send.aslaets.be',
  'send.blablalinux.be',
  'send.jeugdhulp.be',
  'send.cyberjake.xyz',
  'send.monks.tools',
]);

export function parseAllowedFetchUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    if (value.length > 4096 || (parsed.port && parsed.port !== '443') || parsed.protocol !== 'https:') return null;
    if (parsed.username || parsed.password) return null;
    if (!ALLOWED_FETCH_HOSTS.has(parsed.hostname.toLowerCase())) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function fetchAllowedUrl(target: URL, init: RequestInit, maxRedirects = 3): Promise<Response> {
  let current = target;
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetch(current, { ...init, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(res.status)) return res;

    const location = res.headers.get('Location');
    if (!location) return res;
    await res.body?.cancel();
    const next = parseAllowedFetchUrl(new URL(location, current).toString());
    if (!next) throw new Error('Blocked redirect');
    current = next;
  }
  throw new Error('Too many redirects');
}

