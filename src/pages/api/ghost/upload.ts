import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';

export const prerender = false;

const MAX_BYTES = 25 * 1024 * 1024;
const GHOST_LIMIT = 10;

type ServiceResult = { service: string; url: string | null; error?: string };

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function toBlobPart(buf: Uint8Array): BlobPart {
  return new Uint8Array(buf).buffer as ArrayBuffer;
}

function getImgBBKeys(): string[] {
  const keys: string[] = [];
  const envKeys = (import.meta as any).env?.IMGBB_API_KEYS || process.env.IMGBB_API_KEYS;
  if (envKeys) {
    keys.push(...envKeys.split(',').map((k: string) => k.trim()).filter(Boolean));
  }
  const singleKey = (import.meta as any).env?.IMGBB_API_KEY || process.env.IMGBB_API_KEY;
  if (singleKey) keys.push(singleKey);
  return keys;
}

async function uploadImgBB(file: Uint8Array, filename: string): Promise<string | null> {
  const keys = getImgBBKeys();
  if (keys.length === 0) return null;
  
  for (const key of keys) {
    try {
      const form = new FormData();
      form.append('key', key);
      form.append('image', new Blob([toBlobPart(file)]), filename);
      const res = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: form,
        headers: { 'User-Agent': randomUA() }
      });
      if (res.ok) {
        const data = await res.json() as any;
        if (data?.data?.url) return data.data.url;
      }
    } catch {}
  }
  return null;
}

async function uploadSxcu(file: Uint8Array, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  form.append('noembed', 'true');
  const res = await fetch('https://sxcu.net/api/files/create', {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data?.url || null;
}

async function uploadFreeImage(file: Uint8Array, filename: string): Promise<string | null> {
  const key = (import.meta as any).env?.FREEIMAGE_API_KEY || process.env.FREEIMAGE_API_KEY || '6d207e02198a847aa98d0a2a901485a5';
  const form = new FormData();
  form.append('source', new Blob([toBlobPart(file)]), filename);
  const res = await fetch(`https://freeimage.host/api/1/upload?key=${key}&format=json`, {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data?.image?.url || null;
}

async function uploadQuax(file: Uint8Array, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append('files[]', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://qu.ax/upload', {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data?.files?.[0]?.url || null;
}

async function uploadUguu(file: Uint8Array, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append('files[]', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://uguu.se/upload?output=text', {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  return (await res.text()).trim() || null;
}

async function uploadFileHosts(file: Uint8Array, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://filehosts.net/api/upload', {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data?.file?.url || data?.url || null;
}

async function uploadGofile(file: Uint8Array, filename: string): Promise<string | null> {
  const srvRes = await fetch('https://api.gofile.io/servers', {
    headers: { 'User-Agent': randomUA() }
  });
  if (!srvRes.ok) return null;
  const srvData = await srvRes.json() as any;
  const server = srvData?.data?.servers?.[0]?.name;
  if (!server) return null;
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch(`https://${server}.gofile.io/uploadFile`, {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data?.data?.downloadPage || null;
}

async function uploadTmpfileLink(file: Uint8Array, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://tmpfile.link/api/upload', {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  return data?.downloadLinkEncoded || null;
}

async function uploadFilebin(file: Uint8Array, filename: string): Promise<string | null> {
  const binId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const url = `https://filebin.net/${binId}/${filename}`;
  await fetch(url, {
    method: 'POST',
    body: toBlobPart(file),
    headers: { 'User-Agent': randomUA() }
  });
  return url;
}

async function uploadTempSh(file: Uint8Array, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://temp.sh/upload', {
    method: 'POST',
    body: form,
    headers: { 'User-Agent': randomUA() }
  });
  if (!res.ok) return null;
  return (await res.text()).trim() || null;
}

const SERVICES: Record<string, (file: Uint8Array, filename: string) => Promise<string | null>> = {
  imgbb: uploadImgBB,
  sxcu: uploadSxcu,
  freeimage: uploadFreeImage,
  quax: uploadQuax,
  uguu: uploadUguu,
  filehosts: uploadFileHosts,
  gofile: uploadGofile,
  tmpfile: uploadTmpfileLink,
  filebin: uploadFilebin,
  tempsh: uploadTempSh,
};

interface ServiceInfo {
  id: string;
  name: string;
  type: 'image' | 'file';
  maxBytes: number;
  retention: string;
  tosUrl: string | null;
  recommended?: boolean;
}

const SERVICE_INFO: ServiceInfo[] = [
  { id: 'quax', name: 'qu.ax', type: 'file', maxBytes: 256 * 1024 * 1024, retention: '30 days', tosUrl: 'https://qu.ax/tos', recommended: true },
  { id: 'tempsh', name: 'temp.sh', type: 'file', maxBytes: 4 * 1024 * 1024 * 1024, retention: '3 days', tosUrl: null },
  { id: 'filehosts', name: 'FileHosts.net', type: 'file', maxBytes: 15 * 1024 * 1024 * 1024, retention: 'unknown', tosUrl: 'https://filehosts.net/' },
  { id: 'filebin', name: 'Filebin.net', type: 'file', maxBytes: Infinity, retention: '6 days', tosUrl: 'https://filebin.net/terms' },
  { id: 'gofile', name: 'Gofile.io', type: 'file', maxBytes: Infinity, retention: '10 days*', tosUrl: 'https://gofile.io/terms' },
  { id: 'tmpfile', name: 'tmpfile.link', type: 'file', maxBytes: 100 * 1024 * 1024, retention: '7 days', tosUrl: 'https://tmpfile.link/terms' },
  { id: 'uguu', name: 'Uguu.se', type: 'file', maxBytes: 128 * 1024 * 1024, retention: '3 hours', tosUrl: 'https://uguu.se/faq' },
  { id: 'sxcu', name: 'sxcu.net', type: 'image', maxBytes: Infinity, retention: 'forever', tosUrl: 'https://sxcu.net/tos.html', recommended: true },
  { id: 'freeimage', name: 'FreeImage.host', type: 'image', maxBytes: 64 * 1024 * 1024, retention: 'forever', tosUrl: 'https://freeimage.host/tos' },
  { id: 'imgbb', name: 'ImgBB', type: 'image', maxBytes: 32 * 1024 * 1024, retention: '6 months', tosUrl: 'https://imgbb.com/tos' },
];

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ services: SERVICE_INFO }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const POST: APIRoute = async ({ request }) => {
  const { ok, resetIn } = await checkRateLimit('ghost', request, GHOST_LIMIT);
  if (!ok) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(resetIn) }
    });
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return new Response(JSON.stringify({ error: 'Expected multipart/form-data' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const form = await request.formData();
  const file = form.get('file') as File | null;
  const servicesStr = form.get('services') as string | null;
  const isStego = form.get('stego') === 'true';

  if (!file || file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: `File missing or exceeds ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const requestedServices = servicesStr ? servicesStr.split(',').filter(s => SERVICES[s]) : Object.keys(SERVICES);
  const buffer = new Uint8Array(await file.arrayBuffer());
  const filename = file.name || (isStego ? 'ghost.png' : 'ghost.bin');

  const results: ServiceResult[] = await Promise.all(
    requestedServices.map(async (service) => {
      try {
        const url = await SERVICES[service](buffer, filename);
        return { service, url };
      } catch (e: any) {
        return { service, url: null, error: e?.message || 'Upload failed' };
      }
    })
  );

  return new Response(JSON.stringify({ results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};
