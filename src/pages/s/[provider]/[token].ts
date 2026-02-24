import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async ({ params, url }) => {
  const provider = params.provider;
  const token = params.token;

  const home = new URL('/', url).toString();

  if (!provider || !token) {
    return Response.redirect(home, 302);
  }

  const candidates: string[] = [];

  if (provider === 'tini') {
    candidates.push(`https://tini.fyi/${token}`);
  } else if (provider === 'urlvanish') {
    candidates.push(`https://urlvanish.com/${token}`);
  } else if (provider === '1url') {
    candidates.push(`https://1url.cz/${token}`);
  } else if (provider === 'choto') {
    candidates.push(`https://choto.co/${token}`);
  } else if (provider === 'nolog') {
    candidates.push(`https://nolog.link/${token}`);
  } else if (provider === 'isgd') {
    candidates.push(`https://is.gd/${token}`);
  }

  if (candidates.length === 0) {
    return Response.redirect(home, 302);
  }

  for (const shortUrl of candidates) {
    try {
      const upstream = await fetch(shortUrl, { redirect: 'manual' });
      const location = upstream.headers.get('Location');
      if (!location) continue;

      const candidate = new URL(location, shortUrl);
      const hostname = candidate.hostname.toLowerCase();
      const isEncryptRoot = hostname === 'encrypt.click';
      const isEncryptSub = hostname.endsWith('.encrypt.click');
      if (!isEncryptRoot && !isEncryptSub) continue;

      // Only ever redirect to encrypt.click URLs
      return Response.redirect(candidate.toString(), 302);
    } catch {
      // try next candidate
    }
  }

  // On any failure, fall back to homepage
  return Response.redirect(home, 302);
};

