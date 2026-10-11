import { env } from 'cloudflare:workers';
import { readLimited, mapConcurrent, fetchNoRedirect } from '../../../lib/httpLimits';
import type { APIRoute } from 'astro';
import type { SendInstance } from '../../../lib/nologSend';
import { uploadToSendHttp, proxySendUpload } from '../../../lib/nologSend';

export const prerender = false;

const MAX_BYTES = 50 * 1024 * 1024;

type ServiceResult = { service: string; url: string | null; error?: string; details?: string[]; provider?: string };
type Uploader = (file: Uint8Array, blob: () => Blob, filename: string) => Promise<string>;

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

function postForm(url: string, form: FormData) {
  return fetchNoRedirect(url, { method: 'POST', signal: AbortSignal.timeout(30_000), body: form });
}

const uploadSxcu: Uploader = async (_file, blob, filename) => {
  const form = new FormData();
  form.append('file', blob(), filename);
  form.append('noembed', 'true');
  const res = await postForm('https://sxcu.net/api/files/create', form);
  if (!res.ok) throw new Error(`sxcu.net: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.url) throw new Error('sxcu.net: no URL in response');
  return data.url;
};

const uploadFreeImage: Uploader = async (_file, blob, filename) => {
  const key = (env as Record<string, unknown>).FREEIMAGE_API_KEY;
  if (!key) throw new Error('FreeImage API key missing');
  const form = new FormData();
  form.append('source', blob(), filename);
  const res = await postForm(`https://freeimage.host/api/1/upload?key=${key}&format=json`, form);
  if (!res.ok) throw new Error(`FreeImage: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.image?.url) throw new Error('FreeImage: no URL in response');
  return data.image.url;
};

const uploadQuax: Uploader = async (_file, blob, filename) => {
  const form = new FormData();
  form.append('files[]', blob(), filename);
  const res = await postForm('https://qu.ax/upload', form);
  if (!res.ok) throw new Error(`qu.ax: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.files?.[0]?.url) throw new Error('qu.ax: no URL in response');
  return data.files[0].url;
};

const uploadTmpfileLink: Uploader = async (_file, blob, filename) => {
  const form = new FormData();
  form.append('file', blob(), filename);
  const res = await postForm('https://tmpfile.link/api/upload', form);
  if (!res.ok) throw new Error(`tmpfile.link: HTTP ${res.status}`);
  const data = await res.json() as any;
  if (!data?.downloadLinkEncoded) throw new Error('tmpfile.link: no URL in response');
  return data.downloadLinkEncoded;
};

async function textUpload(label: string, url: string, form: FormData): Promise<string> {
  const res = await postForm(url, form);
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const text = (await res.text()).trim();
  if (!text || !text.startsWith('http')) throw new Error(`${label}: invalid response`);
  return text;
}

const uploadTempSh: Uploader = async (_file, blob, filename) => {
  const form = new FormData();
  form.append('file', blob(), filename);
  return textUpload('temp.sh', 'https://temp.sh/upload', form);
};

const uploadX0at: Uploader = async (_file, blob, filename) => {
  const form = new FormData();
  form.append('file', blob(), filename);
  return textUpload('x0.at', 'https://x0.at/', form);
};

const uploadLitterbox: Uploader = async (_file, blob, filename) => {
  const form = new FormData();
  form.append('reqtype', 'fileupload');
  form.append('time', '72h');
  form.append('fileToUpload', blob(), filename);
  return textUpload('Litterbox', 'https://litterbox.catbox.moe/resources/internals/api.php', form);
};

function eligibleSendInstances(fileSize: number): SendInstance[] {
  return shuffle(SEND_INSTANCES.filter(i => fileSize <= i.maxBytes));
}

const uploadNologSendLegacy: Uploader = async (file, _blob, filename) => {
  const failures: string[] = [];
  const instances = eligibleSendInstances(file.byteLength);

  for (const instance of instances.slice(0, 3)) {
    try {
      return await uploadToSendHttp(instance.baseUrl, file, filename, mimeFromName(filename), undefined, instance.maxExpireSeconds, instance.maxDownloads);
    } catch (e: any) {
      failures.push(`${instance.label}: ${e?.message || 'upload failed'}`);
    }
  }

  throw new Error(`Send network failed (${failures.join(' | ')})`);
};

// The client keeps the Send secret and appends it to the returned URL itself.
async function uploadNologSendProxy(encryptedBytes: Uint8Array, metadataB64: string, authHeader: string): Promise<string> {
  const failures: string[] = [];
  const instances = eligibleSendInstances(encryptedBytes.byteLength);

  for (const instance of instances.slice(0, 3)) {
    try {
      return await proxySendUpload(instance.baseUrl, encryptedBytes, metadataB64, authHeader, undefined, instance.maxExpireSeconds, instance.maxDownloads);
    } catch (e: any) {
      failures.push(`${instance.label}: ${e?.message || 'upload failed'}`);
    }
  }

  throw new Error(`Send network failed (${failures.join(' | ')})`);
}

const SERVICES: Record<string, Uploader> = {
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
    const buffer = await readLimited(request, MAX_BYTES);
    if (buffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: 'File missing' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const params = url.searchParams;
    const servicesStr = params.get('services');
    const isStego = params.get('stego') === 'true';
    const filename = (params.get('filename') || (isStego ? 'ghost.png' : 'ghost.bin')).slice(0, 255);
    const requestedServices = [...new Set(servicesStr ? servicesStr.split(',').filter(s => Object.hasOwn(SERVICES, s)) : Object.keys(SERVICES))];

    const sendMetadataB64 = request.headers.get('X-Send-Metadata');
    const sendAuth = request.headers.get('X-Send-Auth');
    const isSendProxy = !!(sendMetadataB64 && sendAuth);

    // One shared Blob and one upload at a time keep peak memory near a single copy of the file.
    let blob: Blob | undefined;
    const getBlob = () => (blob ??= toBlob(buffer, filename));

    const results: ServiceResult[] = await mapConcurrent(requestedServices, 1, async (service) => {
        try {
          let resultUrl: string;
          if (service === 'nologsend' && isSendProxy) {
            resultUrl = await uploadNologSendProxy(buffer, sendMetadataB64, sendAuth);
          } else {
            resultUrl = await SERVICES[service](buffer, getBlob, filename);
          }
          return { service, url: resultUrl };
        } catch (e: any) {
          const message = e?.message || 'Upload failed';
          const details = typeof message === 'string' && message.startsWith('Send network failed (') && message.endsWith(')')
            ? message.slice('Send network failed ('.length, -1).split(' | ').filter(Boolean)
            : undefined;
          return { service, url: null, error: message, details };
        }
      }
    );

    return new Response(JSON.stringify({ results }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || 'Internal server error' }), {
      status: e?.message === 'Body too large' ? 413 : 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
