import { DurableObject } from 'cloudflare:workers';
import { routeRealtimeRequest, type RealtimeEnv } from '../../../party/server';
import { runBudgetCommand } from '../../server/budget';
import { LEGACY_TTL_MS, RETENTION_MS, retentionOfId, uuidOfId } from '../../lib/retention';
import type { BlobMeta, BlobStore, BudgetCommand, Platform, StoredBlob } from '../../platform/types';

export type CloudflareEnv = RealtimeEnv & {
  SECURITY_BUDGET: DurableObjectNamespace<SecurityBudget>;
  BUCKET: R2Bucket;
  [name: string]: unknown;
};

/** One Durable Object per budget scope, so its commands run one at a time against its own SQLite. */
export class SecurityBudget extends DurableObject {
  run(command: BudgetCommand): unknown {
    return runBudgetCommand(this.ctx.storage.sql, command);
  }
}

// One key prefix per retention class, so a lifecycle rule per prefix deletes each class for free.
const objectKey = (id: string) => `t${retentionOfId(id)}/${uuidOfId(id)}`;
const partKey = (id: string, index: number) => `${objectKey(id)}/p/${index}`;
const metaKey = (id: string) => `${objectKey(id)}/meta`;

type MultipartMeta = BlobMeta & { parts: number; complete: boolean; uploaded: number };

async function readMeta(bucket: R2Bucket, id: string): Promise<MultipartMeta | null> {
  const object = await bucket.get(metaKey(id));
  if (!object) return null;
  try {
    const parsed = JSON.parse(await object.text()) as MultipartMeta;
    if (!parsed || !Number.isSafeInteger(parsed.parts) || parsed.parts < 2) return null;
    return parsed;
  } catch {
    return null;
  }
}

function concatParts(bucket: R2Bucket, id: string, parts: number): ReadableStream<Uint8Array> {
  let index = 0;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        if (!reader) {
          if (index >= parts) { controller.close(); return; }
          const object = await bucket.get(partKey(id, index));
          index++;
          if (!object?.body) {
            controller.error(new Error('Missing upload part'));
            return;
          }
          reader = object.body.getReader();
        }
        const { value, done } = await reader.read();
        if (done) {
          reader.releaseLock();
          reader = null;
          continue;
        }
        controller.enqueue(value);
        return;
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason).catch(() => {});
    },
  });
}

function r2Blobs(bucket: R2Bucket): BlobStore {
  return {
    async put(id, body, size, meta) {
      const fixed = new FixedLengthStream(size);
      const piped = body.pipeTo(fixed.writable);
      await Promise.all([
        bucket.put(objectKey(id), fixed.readable, {
          httpMetadata: { contentType: 'application/octet-stream', contentDisposition: 'attachment; filename="encrypted.bin"' },
          customMetadata: { expires: String(meta.expires), burn: meta.burn ? '1' : '0' },
        }),
        piped,
      ]);
    },
    async beginMultipart(id, parts, meta) {
      if (!Number.isSafeInteger(parts) || parts < 2 || parts > 512) throw new Error('Invalid part count');
      const record: MultipartMeta = { expires: meta.expires, burn: meta.burn, parts, complete: false, uploaded: Date.now() };
      await bucket.put(metaKey(id), JSON.stringify(record), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { expires: String(meta.expires), burn: meta.burn ? '1' : '0', parts: String(parts), complete: '0' },
      });
    },
    async putPart(id, index, body, size) {
      const record = await readMeta(bucket, id);
      if (!record || record.complete || !Number.isSafeInteger(index) || index < 0 || index >= record.parts) throw new Error('Invalid part');
      const fixed = new FixedLengthStream(size);
      const piped = body.pipeTo(fixed.writable);
      await Promise.all([
        bucket.put(partKey(id, index), fixed.readable, {
          httpMetadata: { contentType: 'application/octet-stream' },
          customMetadata: { expires: String(record.expires), burn: record.burn ? '1' : '0' },
        }),
        piped,
      ]);
    },
    async completeMultipart(id) {
      const record = await readMeta(bucket, id);
      if (!record || record.complete) throw new Error('Invalid multipart upload');
      for (let i = 0; i < record.parts; i++) {
        if (!await bucket.head(partKey(id, i))) throw new Error('Incomplete multipart upload');
      }
      const next: MultipartMeta = { ...record, complete: true };
      await bucket.put(metaKey(id), JSON.stringify(next), {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { expires: String(next.expires), burn: next.burn ? '1' : '0', parts: String(next.parts), complete: '1' },
      });
    },
    async get(id) {
      const multipart = await readMeta(bucket, id);
      if (multipart) {
        const ttl = RETENTION_MS[retentionOfId(id)];
        const expires = Math.min(multipart.expires, multipart.uploaded + ttl);
        if (Date.now() >= expires || !multipart.complete) return null;
        let size = 0;
        for (let i = 0; i < multipart.parts; i++) {
          const head = await bucket.head(partKey(id, i));
          if (!head) return null;
          size += head.size;
        }
        return {
          body: concatParts(bucket, id, multipart.parts),
          size,
          uploaded: multipart.uploaded,
          expires,
          burn: multipart.burn,
        } satisfies StoredBlob;
      }

      // Uploads from before retention classes sit under their bare UUID until the legacy rule removes them.
      const object = await bucket.get(objectKey(id)) ?? (id === uuidOfId(id) ? await bucket.get(id) : null);
      if (!object) return null;
      const uploaded = object.uploaded.getTime();
      const stored = Number(object.customMetadata?.expires);
      const ttl = object.key === id ? LEGACY_TTL_MS : RETENTION_MS[retentionOfId(id)];
      const expires = Number.isFinite(stored) && stored > 0 ? Math.min(stored, uploaded + ttl) : uploaded + ttl;
      // Lifecycle rules can lag a day behind; an expired object is gone as far as anyone can tell.
      if (Date.now() >= expires) {
        await object.body.cancel();
        return null;
      }
      return { body: object.body, size: object.size, uploaded, expires, burn: object.customMetadata?.burn === '1' };
    },
    async delete(id) {
      const multipart = await readMeta(bucket, id);
      if (multipart) {
        const keys = [metaKey(id), ...Array.from({ length: multipart.parts }, (_, i) => partKey(id, i))];
        await bucket.delete(keys);
        return;
      }
      await bucket.delete(objectKey(id));
    },
  };
}

export function cloudflarePlatform(env: CloudflareEnv, ctx?: Pick<ExecutionContext, 'waitUntil'>): Platform {
  const strings: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') strings[name] = value;
  return {
    env: strings,
    clientIp: (request) => request.headers.get('CF-Connecting-IP') ?? '',
    budget: <T>(scope: string, command: BudgetCommand) =>
      Promise.resolve(env.SECURITY_BUDGET.get(env.SECURITY_BUDGET.idFromName(scope)).run(command)) as Promise<T>,
    blobs: r2Blobs(env.BUCKET),
    realtime: async (request) => (await routeRealtimeRequest(request, env)) ?? new Response('Not found', { status: 404 }),
    waitUntil: (work) => {
      const settled = work.catch(() => {});
      if (ctx) ctx.waitUntil(settled);
    },
  };
}
