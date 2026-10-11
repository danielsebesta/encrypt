const ALLOWED_FETCH_HOSTS = new Set([
  'dl.encrypt.click',
  'qu.ax',
  'x0.at',
  'tmpfile.link',
  'temp.sh',
  'sxcu.net',
  'freeimage.host',
  'catbox.moe',
  'litterbox.catbox.moe',
  'send.skylerszijjarto.com',
  'send.hostnetwork.xyz',
  'send.adminforge.de',
  'send.cyberjake.xyz',
  'send.turingpoint.de',
  'send.codespace.cz',
  'send.mni.li',
  'upload.nolog.cz',
  'send.monks.tools',
  'send.vis.ee',
  'send.aurorabilisim.com',
  'send.artemislena.eu',
  'fileupload.ggc-project.de',
  'send.kokomo.cloud',
  'drop.chapril.org',
  'send.canine.tools',
  'send.aslaets.be',
  'send.blablalinux.be',
  'dropnito.online',
  'send.jeugdhulp.be',
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

