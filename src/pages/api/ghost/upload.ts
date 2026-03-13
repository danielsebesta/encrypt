import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';

export const prerender = false;

const MAX_BYTES = 25 * 1024 * 1024;
const GHOST_LIMIT = 10;

type ServiceResult = { service: string; url: string | null; error?: string };

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

async function uploadImgBB(file: Uint8Array, filename: string): Promise<string> {
  const keys = getImgBBKeys();
  if (keys.length === 0) throw new Error('No ImgBB API key configured');

  let lastErr = '';
  for (const key of keys) {
    try {
      const form = new FormData();
      form.append('key', key);
      form.append('image', new Blob([toBlobPart(file)]), filename);
      const res = await fetch('https://api.imgbb.com/1/upload', {
        method: 'POST',
        body: form,
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
      const data = await res.json() as any;
      if (data?.data?.url) return data.data.url;
      lastErr = 'No URL in response';
    } catch (e: any) { lastErr = e?.message || 'Network error'; }
  }
  throw new Error(`ImgBB: ${lastErr}`);
}

async function uploadSxcu(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  form.append('noembed', 'true');
  const res = await fetch('https://sxcu.net/api/files/create', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`sxcu.net: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.url) throw new Error('sxcu.net: no URL in response');
  return data.url;
}

async function uploadFreeImage(file: Uint8Array, filename: string): Promise<string> {
  const key = (import.meta as any).env?.FREEIMAGE_API_KEY || process.env.FREEIMAGE_API_KEY || '6d207e02198a847aa98d0a2a901485a5';
  const form = new FormData();
  form.append('source', new Blob([toBlobPart(file)]), filename);
  const res = await fetch(`https://freeimage.host/api/1/upload?key=${key}&format=json`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`FreeImage: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.image?.url) throw new Error('FreeImage: no URL in response');
  return data.image.url;
}

async function uploadQuax(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('files[]', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://qu.ax/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`qu.ax: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.files?.[0]?.url) throw new Error('qu.ax: no URL in response');
  return data.files[0].url;
}

async function uploadUguu(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('files[]', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://uguu.se/upload?output=text', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Uguu: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || !text.startsWith('http')) throw new Error('Uguu: invalid response');
  return text;
}

async function uploadFileHosts(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://filehosts.net/api/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`FileHosts: HTTP ${res.status}`);
  const data = await res.json() as any;
  const url = data?.file?.url || data?.url;
  if (!url) throw new Error('FileHosts: no URL in response');
  return url;
}

async function uploadGofile(file: Uint8Array, filename: string): Promise<string> {
  const srvRes = await fetch('https://api.gofile.io/servers');
  if (!srvRes.ok) throw new Error(`Gofile servers: HTTP ${srvRes.status}`);
  const srvData = await srvRes.json() as any;
  const servers = srvData?.data?.servers;
  const server = Array.isArray(servers) ? (typeof servers[0] === 'string' ? servers[0] : servers[0]?.name) : null;
  if (!server) throw new Error('Gofile: no server available');
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch(`https://${server}.gofile.io/uploadFile`, {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Gofile: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.data?.downloadPage) throw new Error('Gofile: no download page in response');
  return data.data.downloadPage;
}

async function uploadTmpfileLink(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://tmpfile.link/api/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`tmpfile.link: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.downloadLinkEncoded) throw new Error('tmpfile.link: no URL in response');
  return data.downloadLinkEncoded;
}

async function uploadFilebin(file: Uint8Array, filename: string): Promise<string> {
  const binId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const url = `https://filebin.net/${binId}/${filename}`;
  const res = await fetch(url, {
    method: 'POST',
    body: toBlobPart(file),
  });
  if (!res.ok) throw new Error(`Filebin: HTTP ${res.status}`);
  return url;
}

async function uploadTempSh(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([toBlobPart(file)]), filename);
  const res = await fetch('https://temp.sh/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`temp.sh: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || !text.startsWith('http')) throw new Error('temp.sh: invalid response');
  return text;
}

const SERVICES: Record<string, (file: Uint8Array, filename: string) => Promise<string>> = {
  imgbb: uploadImgBB,
  sxcu: uploadSxcu,
  freeimage: uploadFreeImage,
  quax: uploadQuax,
  uguu: uploadUguu,
  gofile: uploadGofile,
  tmpfile: uploadTmpfileLink,
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
  { id: 'gofile', name: 'Gofile.io', type: 'file', maxBytes: Infinity, retention: '10 days', tosUrl: 'https://gofile.io/terms' },
  { id: 'tmpfile', name: 'tmpfile.link', type: 'file', maxBytes: 100 * 1024 * 1024, retention: '7 days', tosUrl: 'https://tmpfile.link/terms' },
  { id: 'uguu', name: 'Uguu.se', type: 'file', maxBytes: 128 * 1024 * 1024, retention: '3 hours', tosUrl: 'https://uguu.se/faq' },
  { id: 'sxcu', name: 'sxcu.net', type: 'image', maxBytes: 95 * 1024 * 1024, retention: 'forever', tosUrl: 'https://sxcu.net/tos.html', recommended: true },
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
  try {
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
    const fileEntry = form.get('file');
    const servicesStr = form.get('services') as string | null;
    const isStego = form.get('stego') === 'true';

    if (!fileEntry) {
      return new Response(JSON.stringify({ error: 'File missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const blob = fileEntry instanceof Blob ? fileEntry : new Blob([fileEntry]);
    const arrayBuf = 'arrayBuffer' in blob && typeof blob.arrayBuffer === 'function'
      ? await blob.arrayBuffer()
      : await new Response(blob).arrayBuffer();

    if (arrayBuf.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: `File exceeds ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const buffer = new Uint8Array(arrayBuf);
    const filename = (fileEntry as any).name || (isStego ? 'ghost.png' : 'ghost.bin');

    const requestedServices = servicesStr ? servicesStr.split(',').filter(s => SERVICES[s]) : Object.keys(SERVICES);

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
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
