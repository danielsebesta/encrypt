import { DurableObject } from 'cloudflare:workers';
import { routeRealtimeRequest, type RealtimeEnv } from '../../../party/server';
import { runBudgetCommand } from '../../server/budget';
import type { BlobStore, BudgetCommand, Platform } from '../../platform/types';

export type CloudflareEnv = RealtimeEnv & {
  SECURITY_BUDGET: DurableObjectNamespace<SecurityBudget>;
  BUCKET: R2Bucket;
  MODELS?: R2Bucket;
  [name: string]: unknown;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** One Durable Object per budget scope, so its commands run one at a time against its own SQLite. */
export class SecurityBudget extends DurableObject {
  run(command: BudgetCommand): unknown {
    return runBudgetCommand(this.ctx.storage.sql, command);
  }
}

function r2Blobs(bucket: R2Bucket): BlobStore {
  return {
    async put(id, body, size) {
      const fixed = new FixedLengthStream(size);
      const piped = body.pipeTo(fixed.writable);
      await Promise.all([
        bucket.put(id, fixed.readable, { httpMetadata: { contentType: 'application/octet-stream', contentDisposition: 'attachment; filename="encrypted.bin"' } }),
        piped,
      ]);
    },
    async get(id) {
      const object = await bucket.get(id);
      if (!object) return null;
      // The lifecycle rule can lag a day behind; an expired object is gone as far as anyone can tell.
      if (Date.now() - object.uploaded.getTime() > DAY_MS) {
        await object.body.cancel();
        return null;
      }
      return { body: object.body, size: object.size, uploaded: object.uploaded.getTime() };
    },
    async delete(id) {
      await bucket.delete(id);
    },
  };
}

export function cloudflarePlatform(env: CloudflareEnv): Platform {
  const strings: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) if (typeof value === 'string') strings[name] = value;
  return {
    env: strings,
    clientIp: (request) => request.headers.get('CF-Connecting-IP') ?? '',
    budget: <T>(scope: string, command: BudgetCommand) =>
      Promise.resolve(env.SECURITY_BUDGET.get(env.SECURITY_BUDGET.idFromName(scope)).run(command)) as Promise<T>,
    blobs: r2Blobs(env.BUCKET),
    realtime: async (request) => (await routeRealtimeRequest(request, env)) ?? new Response('Not found', { status: 404 }),
    models: env.MODELS
      ? {
          async get(key) {
            const object = await env.MODELS!.get(key);
            if (!object) return null;
            return {
              body: object.body,
              size: object.size,
              httpEtag: object.httpEtag,
              httpMetadata: object.httpMetadata,
            };
          },
        }
      : null,
  };
}
