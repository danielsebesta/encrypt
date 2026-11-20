import { RETENTIONS, RETENTION_MS } from '../../lib/retention';

type SweepBucket = Pick<R2Bucket, 'list' | 'delete'>;

/** Deletes uploads past their expiry, so a bucket without lifecycle rules keeps nothing longer than promised. */
export async function sweepExpiredUploads(bucket: SweepBucket, now = Date.now()): Promise<number> {
  let removed = 0;
  for (const retention of RETENTIONS) {
    const ttl = RETENTION_MS[retention];
    let cursor: string | undefined;
    do {
      const page = await bucket.list({ prefix: `t${retention}/`, cursor, limit: 1000, include: ['customMetadata'] });
      const expired = page.objects
        .filter((object) => {
          const stored = Number(object.customMetadata?.expires);
          const end = object.uploaded.getTime() + ttl;
          return now >= (Number.isFinite(stored) && stored > 0 ? Math.min(stored, end) : end);
        })
        .map((object) => object.key);
      if (expired.length) {
        await bucket.delete(expired);
        removed += expired.length;
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  return removed;
}
