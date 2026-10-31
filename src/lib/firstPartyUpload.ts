import { mount, unmount } from 'svelte';
import { prependEclkMagic } from './ghost/crypto';
import { xhrRequest, type ByteProgress } from './httpProgress';
import { BLOB_ID_RE, BURN_HEADER, RETENTION_HEADER, type Retention } from './retention';
import { PASS_HEADER } from './uploadPass';

type Dict = Record<string, string>;

const TRANSIENT_RETRIES = 6;

// Kept only in memory: a pass is worth one solved challenge for an hour on this network and nothing after a reload.
let held: { pass: string; expires: number } | null = null;
let challenging: Promise<string | null> | null = null;

/** Edge / budget blips that are worth another try; not application errors. */
export function isTransientUploadStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function heldPass(): string | null {
  if (held && held.expires - 60_000 > Date.now()) return held.pass;
  held = null;
  return null;
}

async function solveChallenge(dict: Dict): Promise<string | null> {
  try {
    const { default: UploadChallenge } = await import('../components/UploadChallenge.svelte');
    return await new Promise<string | null>(resolve => {
      let settled = false;
      const finish = (pass: string | null) => {
        if (settled) return;
        settled = true;
        void unmount(component);
        resolve(pass);
      };
      const component = mount(UploadChallenge, {
        target: document.body,
        props: {
          dict,
          onpass: (pass: string, expires: number) => { held = { pass, expires }; finish(pass); },
          oncancel: () => finish(null),
        },
      });
    });
  } catch {
    return null;
  }
}

function challenge(dict: Dict): Promise<string | null> {
  challenging ??= solveChallenge(dict).finally(() => { challenging = null; });
  return challenging;
}

function hasUploadBody(body: BodyInit | null | undefined): boolean {
  return body != null && body !== '';
}

function retryAfterMs(res: Response, attempt: number): number {
  const header = Number(res.headers.get('Retry-After'));
  const jitter = Math.floor(Math.random() * 250);
  if (Number.isFinite(header) && header >= 0) return Math.min(60_000, Math.max(250, header * 1000)) + jitter;
  return Math.min(30_000, 500 * 2 ** attempt) + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce(
  url: string,
  init: { method: string; body?: BodyInit | null; headers?: Record<string, string> },
  onUploadProgress?: ByteProgress,
): Promise<Response> {
  if (onUploadProgress && hasUploadBody(init.body)) {
    try {
      return await xhrRequest(url, { method: init.method, headers: init.headers, body: init.body }, onUploadProgress);
    } catch {
      // Progress is best-effort; a failed XHR still has to deliver the bytes via fetch.
      return fetch(url, init);
    }
  }
  return fetch(url, init);
}

export async function sendWithUploadPass(
  url: string,
  init: { method: string; body?: BodyInit | null; headers?: Record<string, string> },
  dict: Dict,
  onUploadProgress?: ByteProgress,
): Promise<Response> {
  const send = (pass: string | null, progress?: ByteProgress) => requestOnce(url, {
    ...init,
    headers: { ...init.headers, ...(pass ? { [PASS_HEADER]: pass } : {}) },
  }, progress);

  for (let attempt = 0; ; attempt++) {
    const res = await send(heldPass(), onUploadProgress);
    if (res.status === 428) {
      const reply = await res.clone().json().catch(() => null) as any;
      if (reply?.challenge !== 'pow') return res;
      held = null;
      const pass = await challenge(dict);
      if (!pass) return res;
      continue;
    }
    if (isTransientUploadStatus(res.status) && attempt < TRANSIENT_RETRIES) {
      await sleep(retryAfterMs(res, attempt));
      continue;
    }
    return res;
  }
}

export type UploadOptions = {
  retention?: Retention;
  burn?: boolean;
  onProgress?: ByteProgress;
};

export type FirstPartyUpload = { id: string; url: string; expires: number | null; burn: boolean };

/**
 * Uploads ciphertext to this site's own storage; the download link lives on the same origin. Without options the
 * server keeps its default of one day and any number of downloads.
 */
export async function uploadFirstParty(body: Uint8Array, dict: Dict, options?: UploadOptions): Promise<FirstPartyUpload | null> {
  try {
    const payload = prependEclkMagic(body);
    const res = await sendWithUploadPass('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(options?.retention ? { [RETENTION_HEADER]: options.retention, [BURN_HEADER]: options.burn ? '1' : '0' } : {}),
      },
      body: payload as BodyInit,
    }, dict, options?.onProgress);
    if (!res.ok) return null;
    const data = await res.json().catch(() => null) as any;
    if (!data?.success || typeof data.id !== 'string' || !BLOB_ID_RE.test(data.id)) return null;
    return {
      id: data.id,
      url: `${location.origin}/dl/${data.id}`,
      expires: Number.isSafeInteger(data.expires) ? data.expires : null,
      burn: data.burn === true,
    };
  } catch {
    return null;
  }
}
