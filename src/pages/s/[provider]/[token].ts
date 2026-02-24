import type { APIRoute } from 'astro';

function decodeTarget(token: string): string {
  const b64 = token.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.length / 4) * 4, '=');
  return atob(b64);
}

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const provider = params.provider;
  const token = params.token;

  if (!provider || !token) {
    return new Response('Not found', { status: 404 });
  }

  let shortUrl: string;
  try {
    shortUrl = decodeTarget(token);
  } catch {
    return new Response('Invalid short link.', { status: 400 });
  }

  if (!shortUrl.startsWith('http://') && !shortUrl.startsWith('https://')) {
    return new Response('Invalid short link.', { status: 400 });
  }

  const upstream = await fetch(shortUrl, {
    redirect: 'manual'
  });

  const location = upstream.headers.get('Location');
  if (!location) {
    return new Response('Short link is invalid or expired.', { status: 502 });
  }

  let finalUrl: URL;
  try {
    finalUrl = new URL(location, shortUrl);
  } catch {
    return new Response('Short link target is invalid.', { status: 502 });
  }

  const hostname = finalUrl.hostname.toLowerCase();
  const isEncryptRoot = hostname === 'encrypt.click';
  const isEncryptSub = hostname.endsWith('.encrypt.click');

  if (!isEncryptRoot && !isEncryptSub) {
    return new Response('Short link target is not on encrypt.click.', { status: 400 });
  }

  return Response.redirect(finalUrl.toString(), 302);
};

