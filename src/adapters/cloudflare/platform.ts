import { DurableObject } from 'cloudflare:workers';
import { routeRealtimeRequest, type RealtimeEnv } from '../../../party/server';
import { runBudgetCommand } from '../../server/budget';
import { LEGACY_TTL_MS, RETENTION_MS, retentionOfId, uuidOfId } from '../../lib/retention';
import type { BlobStore, BudgetCommand, Platform } from '../../platform/types';

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
    async get(id) {
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
