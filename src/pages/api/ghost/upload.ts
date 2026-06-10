import type { APIRoute } from 'astro';
import { checkRateLimit } from '../../../lib/rateLimit';
import type { SendInstance } from '../../../lib/nologSend';
import { uploadToSendHttp, proxySendUpload } from '../../../lib/nologSend';

export const prerender = false;

const MAX_BYTES = 50 * 1024 * 1024;
const GHOST_LIMIT = 10;

type ServiceResult = { service: string; url: string | null; error?: string; details?: string[]; provider?: string };

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const DAY = 86400;

// Limits from the public Send instances table.
// Direct hosts (qu.ax, x0.at, tmpfile.link, sxcu.net) have no per-file
// download cap (verified via 200+ sequential GETs).
// send.boblorange.net is removed: it now requires login.
const SEND_INSTANCES: SendInstance[] = [
  { baseUrl: 'https://send.skylerszijjarto.com', label: 'send.skylerszijjarto.com', region: 'other', country: 'US', maxBytes: 250 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 10000 },
  { baseUrl: 'https://send.hostnetwork.xyz', label: 'send.hostnetwork.xyz', region: 'eu', country: 'DE', maxBytes: 2560 * MiB, maxExpireSeconds: 700000, maxDownloads: 999999 },
  { baseUrl: 'https://send.adminforge.de', label: 'send.adminforge.de', region: 'eu', country: 'DE', maxBytes: 8 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 1000 },
  { baseUrl: 'https://send.cyberjake.xyz', label: 'send.cyberjake.xyz', region: 'other', country: 'US', maxBytes: 10 * GiB, maxExpireSeconds: 30 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.turingpoint.de', label: 'send.turingpoint.de', region: 'eu', country: 'DE', maxBytes: 10 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 10 },
  { baseUrl: 'https://send.codespace.cz', label: 'send.codespace.cz', region: 'eu', country: 'CZ', maxBytes: 10 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.mni.li', label: 'send.mni.li', region: 'eu', country: 'NL', maxBytes: 8 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 25 },
  { baseUrl: 'https://upload.nolog.cz', label: 'upload.nolog.cz', region: 'eu', country: 'CZ', maxBytes: 5 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.monks.tools', label: 'send.monks.tools', region: 'other', country: 'US', maxBytes: 5 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 50 },
  { baseUrl: 'https://send.vis.ee', label: 'send.vis.ee', region: 'eu', country: 'NL', maxBytes: 2560 * MiB, maxExpireSeconds: 3 * DAY, maxDownloads: 10 },
  { baseUrl: 'https://send.aurorabilisim.com', label: 'send.aurorabilisim.com', region: 'other', country: 'TR', maxBytes: 2560 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.artemislena.eu', label: 'send.artemislena.eu', region: 'eu', country: 'DE', maxBytes: 2560 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://fileupload.ggc-project.de', label: 'fileupload.ggc-project.de', region: 'eu', country: 'DE', maxBytes: 2560 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.kokomo.cloud', label: 'send.kokomo.cloud', region: 'other', country: 'US', maxBytes: 2560 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://drop.chapril.org', label: 'drop.chapril.org', region: 'eu', country: 'DE', maxBytes: 1 * GiB, maxExpireSeconds: 5 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.canine.tools', label: 'send.canine.tools', region: 'other', country: 'US', maxBytes: 1 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.aslaets.be', label: 'send.aslaets.be', region: 'eu', country: 'DE', maxBytes: 512 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 3 },
  { baseUrl: 'https://send.blablalinux.be', label: 'send.blablalinux.be', region: 'eu', country: 'BE', maxBytes: 512 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 10 },
  { baseUrl: 'https://dropnito.online', label: 'dropnito.online', region: 'eu', country: 'CZ', maxBytes: 150 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.jeugdhulp.be', label: 'send.jeugdhulp.be', region: 'eu', country: 'FR', maxBytes: 50 * MiB, maxExpireSeconds: 10 * DAY, maxDownloads: 25 },
];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function mimeFromName(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function toBlob(buf: Uint8Array, filename?: string): Blob {
  const type = filename ? mimeFromName(filename) : 'application/octet-stream';
  return new Blob([bytesToArrayBuffer(buf)], { type });
}

async function uploadSxcu(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', toBlob(file, filename), filename);
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
  const key = (import.meta as any).env?.FREEIMAGE_API_KEY || process.env.FREEIMAGE_API_KEY;
  if (!key) throw new Error('FreeImage API key missing');
  const form = new FormData();
  form.append('source', toBlob(file, filename), filename);
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
  form.append('files[]', toBlob(file, filename), filename);
  const res = await fetch('https://qu.ax/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`qu.ax: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.files?.[0]?.url) throw new Error('qu.ax: no URL in response');
  return data.files[0].url;
}

async function uploadTmpfileLink(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', toBlob(file, filename), filename);
  const res = await fetch('https://tmpfile.link/api/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`tmpfile.link: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.downloadLinkEncoded) throw new Error('tmpfile.link: no URL in response');
  return data.downloadLinkEncoded;
}

async function uploadTempSh(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', toBlob(file, filename), filename);
  const res = await fetch('https://temp.sh/upload', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`temp.sh: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || !text.startsWith('http')) throw new Error('temp.sh: invalid response');
  return text;
}


async function uploadX0at(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('file', toBlob(file, filename), filename);
  const res = await fetch('https://x0.at/', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`x0.at: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || !text.startsWith('http')) throw new Error('x0.at: invalid response');
  return text;
}

async function uploadLitterbox(file: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '72h');
  form.append('fileToUpload', toBlob(file, filename), filename);
  const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) throw new Error(`Litterbox: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || !text.startsWith('http')) throw new Error('Litterbox: invalid response');
  return text;
}

function eligibleSendInstances(fileSize: number): SendInstance[] {
  return shuffle(SEND_INSTANCES.filter(i => fileSize <= i.maxBytes));
}

async function uploadNologSendLegacy(file: Uint8Array, filename: string): Promise<string> {
  const failures: string[] = [];
  const instances = eligibleSendInstances(file.byteLength);

  for (const instance of instances) {
    try {
      return await uploadToSendHttp(instance.baseUrl, file, filename, mimeFromName(filename), undefined, instance.maxExpireSeconds, instance.maxDownloads);
    } catch (e: any) {
      failures.push(`${instance.label}: ${e?.message || 'upload failed'}`);
    }
  }

  throw new Error(`Send network failed (${failures.join(' | ')})`);
}

async function uploadNologSendProxy(encryptedBytes: Uint8Array, metadataB64: string, authHeader: string, secretB64: string): Promise<string> {
  const failures: string[] = [];
  const instances = eligibleSendInstances(encryptedBytes.byteLength);

  for (const instance of instances) {
    try {
      return await proxySendUpload(instance.baseUrl, encryptedBytes, metadataB64, authHeader, secretB64, undefined, instance.maxExpireSeconds, instance.maxDownloads);
    } catch (e: any) {
      failures.push(`${instance.label}: ${e?.message || 'upload failed'}`);
    }
  }

  throw new Error(`Send network failed (${failures.join(' | ')})`);
}

const SERVICES: Record<string, (file: Uint8Array, filename: string) => Promise<string>> = {
  nologsend: uploadNologSendLegacy,
  sxcu: uploadSxcu,
  freeimage: uploadFreeImage,
  quax: uploadQuax,
  tmpfile: uploadTmpfileLink,
  tempsh: uploadTempSh,
  x0at: uploadX0at,
  litterbox: uploadLitterbox,
};

interface ServiceInfo {
  id: string;
  name: string;
  type: 'image' | 'file';
  maxBytes: number;
  tosUrl: string | null;
  recommended?: boolean;
}

const SERVICE_INFO: ServiceInfo[] = [
  { id: 'nologsend', name: 'Send network', type: 'file', maxBytes: 5 * 1024 * 1024 * 1024, tosUrl: 'https://upload.nolog.cz/', recommended: true },
  { id: 'quax', name: 'qu.ax', type: 'file', maxBytes: 256 * 1024 * 1024, tosUrl: 'https://qu.ax/tos' },
  { id: 'tempsh', name: 'temp.sh', type: 'file', maxBytes: 4 * 1024 * 1024 * 1024, tosUrl: null },
  { id: 'tmpfile', name: 'tmpfile.link', type: 'file', maxBytes: 100 * 1024 * 1024, tosUrl: 'https://tmpfile.link/terms' },
  { id: 'sxcu', name: 'sxcu.net', type: 'image', maxBytes: 95 * 1024 * 1024, tosUrl: 'https://sxcu.net/tos.html' },
  { id: 'freeimage', name: 'FreeImage.host', type: 'image', maxBytes: 64 * 1024 * 1024, tosUrl: 'https://freeimage.host/tos' },
  { id: 'x0at', name: 'x0.at', type: 'file', maxBytes: 512 * 1024 * 1024, tosUrl: 'https://x0.at' },
  { id: 'litterbox', name: 'Litterbox', type: 'file', maxBytes: 1024 * 1024 * 1024, tosUrl: 'https://catbox.moe/faq.php' },
];

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify({ services: SERVICE_INFO }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
};

export const POST: APIRoute = async ({ request, url }) => {
  try {
    const { ok, resetIn } = await checkRateLimit('ghost', request, GHOST_LIMIT);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(resetIn) }
      });
    }

    const arrayBuf = await request.arrayBuffer();
    if (!arrayBuf || arrayBuf.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'File missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const buffer = new Uint8Array(arrayBuf);

    if (buffer.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: `File exceeds ${Math.round(MAX_BYTES / (1024 * 1024))} MB limit (got ${(buffer.byteLength / (1024 * 1024)).toFixed(1)} MB)` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const params = url.searchParams;
    const servicesStr = params.get('services');
    const isStego = params.get('stego') === 'true';
    const filename = params.get('filename') || (isStego ? 'ghost.png' : 'ghost.bin');
    const requestedServices = servicesStr ? servicesStr.split(',').filter(s => SERVICES[s]) : Object.keys(SERVICES);

    const sendMetadataB64 = request.headers.get('X-Send-Metadata');
    const sendAuth = request.headers.get('X-Send-Auth');
    const sendSecret = request.headers.get('X-Send-Secret');
    const isSendProxy = !!(sendMetadataB64 && sendAuth && sendSecret);

    const results: ServiceResult[] = await Promise.all(
      requestedServices.map(async (service) => {
        try {
          let resultUrl: string;
          if (service === 'nologsend' && isSendProxy) {
            resultUrl = await uploadNologSendProxy(buffer, sendMetadataB64, sendAuth, sendSecret);
          } else {
            resultUrl = await SERVICES[service](buffer, filename);
          }
          return { service, url: resultUrl };
        } catch (e: any) {
          const message = e?.message || 'Upload failed';
          const details = typeof message === 'string' && message.startsWith('Send network failed (') && message.endsWith(')')
            ? message.slice('Send network failed ('.length, -1).split(' | ').filter(Boolean)
            : undefined;
          return { service, url: null, error: message, details };
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
