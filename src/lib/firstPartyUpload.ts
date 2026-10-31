import { mount, unmount } from 'svelte';
import { prependEclkMagic } from './ghost/crypto';
import { BLOB_ID_RE, BURN_HEADER, RETENTION_HEADER, type Retention } from './retention';
import { PASS_HEADER } from './uploadPass';

type Dict = Record<string, string>;

// Kept only in memory: a pass is worth one solved challenge for an hour on this network and nothing after a reload.
let held: { pass: string; expires: number } | null = null;
let challenging: Promise<string | null> | null = null;

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

export async function sendWithUploadPass(url: string, init: { method: string; body: Uint8Array; headers?: Record<string, string> }, dict: Dict): Promise<Response> {
  const send = (pass: string | null) => fetch(url, { ...init, body: init.body as BodyInit, headers: { ...init.headers, ...(pass ? { [PASS_HEADER]: pass } : {}) } });
  const res = await send(heldPass());
  if (res.status !== 428) return res;
  const reply = await res.clone().json().catch(() => null) as any;
  if (reply?.challenge !== 'pow') return res;
  held = null;
  const pass = await challenge(dict);
  return pass ? send(pass) : res;
}

export type UploadOptions = { retention: Retention; burn: boolean };
export type FirstPartyUpload = { id: string; url: string; expires: number | null; burn: boolean };

/**
 * Uploads ciphertext to this site's own storage; the download link lives on the same origin. Without options the
 * server keeps its default of one day and any number of downloads.
 */
export async function uploadFirstParty(body: Uint8Array, dict: Dict, options?: UploadOptions): Promise<FirstPartyUpload | null> {
  try {
    const res = await sendWithUploadPass('/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(options ? { [RETENTION_HEADER]: options.retention, [BURN_HEADER]: options.burn ? '1' : '0' } : {}),
      },
      body: prependEclkMagic(body),
    }, dict);
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
