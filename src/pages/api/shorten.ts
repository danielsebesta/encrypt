import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../lib/rateLimit';

const NOLOG_API = 'https://nolog.link/';
const ONEURL_API = 'https://1url.cz/';
const URLVANISH_API = 'https://www.urlvanish.com/create.php';
const ISGD_API = 'https://is.gd/create.php';
const TINI_API = 'https://tini.fyi/api/v1/url/create';
const TINI_BASE = 'https://tini.fyi/';
const CHOTO_API = 'https://backend.choto.co/api/v1/links';
const SHORTEN_LIMIT = 30;

type Provider = 'nolog' | '1url' | 'urlvanish' | 'tini' | 'choto' | 'isgd';

export const prerender = false;

async function shortenNolog(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(NOLOG_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'encrypt.click/1' },
    body: JSON.stringify({ url: urlToShorten, alias: '' }),
    signal
  });
  const text = await res.text();
  if (!res.ok) return null;
  try {
    const data = JSON.parse(text) as { shorturl?: string };
    const s = typeof data?.shorturl === 'string' ? data.shorturl : '';
    return s ? (s.startsWith('http') ? s : `https://${s}`) : null;
  } catch {
    return null;
  }
}

async function shorten1url(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const body = new URLSearchParams({
    url: urlToShorten,
    url2c0de: '2url',
    homepage: '',
    url2code: '1',
    zkratka: ''
  }).toString();
  const res = await fetch(ONEURL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'text/html', 'User-Agent': 'encrypt.click/1' },
    body,
    signal
  });
  const html = await res.text();
  if (!res.ok) return null;
  const m = html.match(/href="(https:\/\/1url\.cz\/[A-Za-z0-9]+)"/);
  return m ? m[1] : null;
}

async function shortenUrlVanish(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const body = new URLSearchParams({
    url: urlToShorten,
    shorten: ''
  }).toString();

  const res = await fetch(URLVANISH_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html',
      'User-Agent': 'encrypt.click/1',
      'Referer': 'https://www.urlvanish.com/'
    },
    body,
    signal
  });

  const html = await res.text();
  if (!res.ok) return null;

  const normalize = (u: string): string => {
    const withScheme = u.startsWith('http') ? u : `https://${u}`;
    return withScheme.replace('https://www.urlvanish.com/', 'https://urlvanish.com/');
  };

  // Prefer the explicit result code element if present
  const codeMatch = html.match(/<code class="short-url-text">([^<]+)<\/code>/);
  if (codeMatch && codeMatch[1]) {
    const s = codeMatch[1].trim();
    return s ? normalize(s) : null;
  }

  // Fallback: look for a short URL pattern (with or without www)
  const urlMatch = html.match(/https:\/\/(?:www\.)?urlvanish\.com\/[A-Za-z0-9]+/);
  return urlMatch ? normalize(urlMatch[0]) : null;
}

async function shortenTini(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(TINI_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'encrypt.click/1',
      'Referer': 'https://app.tini.fyi/'
    },
    body: JSON.stringify({
      destination: urlToShorten,
      alias: ''
    }),
    signal
  });

  const text = await res.text();
  if (!res.ok) return null;

  try {
    const data = JSON.parse(text) as {
      status?: string;
      data?: { shortCode?: string | null; destination?: string | null } | null;
    };
    if (data.status !== 'success') return null;
    const code = data.data?.shortCode;
    if (typeof code === 'string' && code.trim().length > 0) {
      return `${TINI_BASE}${code.trim()}`;
    }
    return null;
  } catch {
    return null;
  }
}

async function shortenChoto(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const res = await fetch(CHOTO_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'encrypt.click/1',
      'Referer': 'https://choto.co/',
      'Origin': 'https://choto.co',
      'timezone': 'Europe/Prague'
    },
    body: JSON.stringify({ link: urlToShorten }),
    signal
  });

  const text = await res.text();
  if (!res.ok) return null;

  try {
    const data = JSON.parse(text) as {
      status?: boolean;
      status_code?: number;
      data?: {
        link?: {
          short_link?: string | null;
        } | null;
      } | null;
    };
    if (!data.status || data.status_code !== 200) return null;
    const short = data.data?.link?.short_link;
    if (typeof short === 'string' && short.trim().length > 0) {
      return short.trim();
    }
    return null;
  } catch {
    return null;
  }
}

async function shortenIsgd(urlToShorten: string, signal: AbortSignal): Promise<string | null> {
  const body = new URLSearchParams({
    url: urlToShorten,
    format: 'json'
  }).toString();

  const res = await fetch(`${ISGD_API}?${body}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'encrypt.click/1'
    },
    signal
  });

  const text = await res.text();
  if (!res.ok) return null;

  try {
    const data = JSON.parse(text) as {
      shorturl?: string | null;
      errorcode?: number;
      errormessage?: string;
    };
    if (data.errorcode) return null;
    const short = data.shorturl;
    if (typeof short === 'string' && short.trim().length > 0) {
      return short.trim();
    }
    return null;
  } catch {
    return null;
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  const { ok, remaining, resetIn } = await checkRateLimit('shorten', request, SHORTEN_LIMIT);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(resetIn), 'X-RateLimit-Remaining': '0' }
    });
  }

  if (request.headers.get('Content-Type')?.includes('application/json') !== true) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: { url?: string; provider?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const targetUrl = typeof body?.url === 'string' ? body.url.trim() : '';
  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing url' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const isEncryptClickRoot = hostname === 'encrypt.click';
  const isEncryptClickSub = hostname.endsWith('.encrypt.click');

  if (!isLocal && !isEncryptClickRoot && !isEncryptClickSub) {
    return new Response(JSON.stringify({ error: 'URL must be on encrypt.click' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const urlToShorten = isLocal ? `https://encrypt.click${parsed.pathname}${parsed.hash}` : targetUrl;

  const requested = body?.provider;
  const provider: Provider =
    requested === '1url' || requested === 'urlvanish' || requested === 'tini' || requested === 'choto' || requested === 'isgd'
      ? requested
      : 'nolog';

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let shorturl: string | null;
  try {
    if (provider === '1url') {
      shorturl = await shorten1url(urlToShorten, controller.signal);
    } else if (provider === 'urlvanish') {
      shorturl = await shortenUrlVanish(urlToShorten, controller.signal);
    } else if (provider === 'tini') {
      shorturl = await shortenTini(urlToShorten, controller.signal);
    } else if (provider === 'choto') {
      shorturl = await shortenChoto(urlToShorten, controller.signal);
    } else if (provider === 'isgd') {
      shorturl = await shortenIsgd(urlToShorten, controller.signal);
    } else {
      shorturl = await shortenNolog(urlToShorten, controller.signal);
    }
  } catch {
    shorturl = null;
  }
  clearTimeout(timeout);

  if (!shorturl) {
    let message = 'Shortening failed. The external shortener may be temporarily unavailable.';

    if (provider === 'choto') {
      message =
        'choto.co could not shorten this link. Their service may reject URLs this long. Try a different shortener or, if this keeps happening, report the issue on the encrypt.click GitHub repository.';
    }

    return new Response(JSON.stringify({ error: message }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let token: string | null = null;
  try {
    const u = new URL(shorturl);
    const code = u.pathname.replace(/^\/+/, '');
    if (provider === 'tini' && u.hostname === 'tini.fyi') {
      token = code;
    } else if (provider === 'urlvanish' && u.hostname.endsWith('urlvanish.com')) {
      token = code;
    } else if (provider === '1url' && u.hostname === '1url.cz') {
      token = code;
    } else if (provider === 'choto' && u.hostname === 'choto.co') {
      token = code;
    } else if (provider === 'isgd' && u.hostname === 'is.gd') {
      token = code;
    } else if (provider === 'nolog' && u.hostname.endsWith('nolog.link')) {
      token = code;
    }
  } catch {
    token = null;
  }

  if (!token) {
    return new Response(JSON.stringify({ error: 'Shortener returned an unexpected URL format.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const wrapped = `${url.origin}/s/${provider}/${token}`;

  return new Response(JSON.stringify({ shorturl: wrapped }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': String(remaining - 1) }
  });
};
