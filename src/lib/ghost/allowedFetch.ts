const ALLOWED_FETCH_HOSTS = new Set([
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
