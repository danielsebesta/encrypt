import { readLimited, fetchNoRedirect, MAX_TRANSFER_BYTES, SLOW_TRANSFER_TIMEOUT_MS } from '../../../lib/httpLimits';
import type { APIRoute } from 'astro';
import type { SendInstance } from '../../../lib/nologSend';
import { proxySendUpload } from '../../../lib/nologSend';

export const prerender = false;

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;
const DAY = 86400;

// Limits from each instance's /config, verified with real uploads. Expiry is capped at 7 days; instances that allow
// fewer than 20 downloads are left out because every opened link uses one.
const SEND_INSTANCES: SendInstance[] = [
  { baseUrl: 'https://upload.nolog.cz', label: 'upload.nolog.cz', region: 'eu', country: 'CZ', maxBytes: 5 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 500 },
  { baseUrl: 'https://send.codespace.cz', label: 'send.codespace.cz', region: 'eu', country: 'CZ', maxBytes: 10 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.adminforge.de', label: 'send.adminforge.de', region: 'eu', country: 'DE', maxBytes: 8 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 1000 },
  { baseUrl: 'https://send.mni.li', label: 'send.mni.li', region: 'eu', country: 'NL', maxBytes: 8 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 25 },
  { baseUrl: 'https://send.artemislena.eu', label: 'send.artemislena.eu', region: 'eu', country: 'DE', maxBytes: 2560 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.vis.ee', label: 'send.vis.ee', region: 'eu', country: 'NL', maxBytes: 2560 * MiB, maxExpireSeconds: 3 * DAY, maxDownloads: 20 },
  { baseUrl: 'https://drop.chapril.org', label: 'drop.chapril.org', region: 'eu', country: 'DE', maxBytes: 819 * MiB, maxExpireSeconds: 5 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.jeugdhulp.be', label: 'send.jeugdhulp.be', region: 'eu', country: 'FR', maxBytes: 70 * MiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.cyberjake.xyz', label: 'send.cyberjake.xyz', region: 'other', country: 'US', maxBytes: 10 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
  { baseUrl: 'https://send.monks.tools', label: 'send.monks.tools', region: 'other', country: 'US', maxBytes: 5 * GiB, maxExpireSeconds: 7 * DAY, maxDownloads: 100 },
];

const MAX_ATTEMPTS = 4;
const FAILURE_COOLDOWN_MS = 10 * 60 * 1000;
const recentFailures = new Map<string, number>();

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function failedRecently(instance: SendInstance): boolean {
  const failedAt = recentFailures.get(instance.baseUrl);
  return failedAt !== undefined && Date.now() - failedAt < FAILURE_COOLDOWN_MS;
}

// EU first, then the rest; instances that failed recently go last.
function orderedSendInstances(fileSize: number): SendInstance[] {
  const eligible = SEND_INSTANCES.filter(i => fileSize <= i.maxBytes);
  const ordered = [...shuffle(eligible.filter(i => i.region === 'eu')), ...shuffle(eligible.filter(i => i.region !== 'eu'))];
  return [...ordered.filter(i => !failedRecently(i)), ...ordered.filter(failedRecently)];
}

async function isReachable(instance: SendInstance): Promise<boolean> {
  try {
    const res = await fetchNoRedirect(`${instance.baseUrl}/config`, { signal: AbortSignal.timeout(5_000) });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

// The client keeps the Send secret and appends it to the returned URL itself.
// A pinned instance is the one the sender agreed to, so there is no failover to others.
async function uploadToSendNetwork(encryptedBytes: Uint8Array, metadataB64: string, authHeader: string, pinned?: SendInstance): Promise<string> {
  const failures: string[] = [];
  const candidates = pinned
    ? [pinned].filter(i => encryptedBytes.byteLength <= i.maxBytes)
    : orderedSendInstances(encryptedBytes.byteLength).slice(0, MAX_ATTEMPTS);

  for (const instance of candidates) {
    try {
      const url = await proxySendUpload(instance.baseUrl, encryptedBytes, metadataB64, authHeader, undefined, instance.maxExpireSeconds, instance.maxDownloads);
      recentFailures.delete(instance.baseUrl);
      return url;
    } catch (e: any) {
      recentFailures.set(instance.baseUrl, Date.now());
      failures.push(`${instance.label}: ${e?.message || 'upload failed'}`);
    }
  }

  throw new Error(`Send network failed (${failures.join(' | ')})`);
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Picks a reachable instance up front so the sender can see where the file will go.
export const GET: APIRoute = async ({ url }) => {
  const size = Number(url.searchParams.get('size'));
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_TRANSFER_BYTES) return json({ error: 'Invalid size' }, 400);
  const excluded = new Set((url.searchParams.get('exclude') || '').split(','));

  for (const instance of orderedSendInstances(size).filter(i => !excluded.has(i.label)).slice(0, MAX_ATTEMPTS)) {
    if (await isReachable(instance)) return json({ instance: { host: instance.label, country: instance.country } }, 200);
    recentFailures.set(instance.baseUrl, Date.now());
  }
  return json({ error: 'No Send instance available' }, 503);
};

export const POST: APIRoute = async ({ request }) => {
  const sendMetadataB64 = request.headers.get('X-Send-Metadata');
  const sendAuth = request.headers.get('X-Send-Auth');
  if (!sendMetadataB64 || !sendAuth) return json({ error: 'Missing Send headers' }, 400);
  const requestedInstance = request.headers.get('X-Send-Instance');
  const pinned = requestedInstance ? SEND_INSTANCES.find(i => i.label === requestedInstance) : undefined;
  if (requestedInstance && !pinned) return json({ error: 'Unknown Send instance' }, 400);

  try {
    const buffer = await readLimited(request, MAX_TRANSFER_BYTES, SLOW_TRANSFER_TIMEOUT_MS);
    if (buffer.byteLength === 0) return json({ error: 'File missing' }, 400);

    try {
      const url = await uploadToSendNetwork(buffer, sendMetadataB64, sendAuth, pinned);
      return json({ results: [{ service: 'nologsend', url }] }, 200);
    } catch (e: any) {
      const message = e?.message || 'Upload failed';
      const details = message.startsWith('Send network failed (') && message.endsWith(')')
        ? message.slice('Send network failed ('.length, -1).split(' | ').filter(Boolean)
        : undefined;
      return json({ results: [{ service: 'nologsend', url: null, error: message, details }] }, 200);
    }
  } catch (e: any) {
    return json({ error: e?.message || 'Internal server error' }, e?.message === 'Body too large' ? 413 : 502);
  }
};
