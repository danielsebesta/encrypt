import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweepExpiredUploads } from '../src/adapters/cloudflare/sweep';

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 20, 12);

type Stored = { key: string; uploaded: Date; customMetadata?: Record<string, string> };

function fakeBucket(objects: Stored[], pageSize = 2) {
  const store = new Map(objects.map((object) => [object.key, object]));
  return {
    store,
    async list({ prefix = '', cursor }: { prefix?: string; cursor?: string }) {
      const keys = [...store.keys()].filter((key) => key.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + pageSize).map((key) => store.get(key)!);
      const truncated = start + pageSize < keys.length;
      return { objects: page, truncated, cursor: truncated ? String(start + pageSize) : undefined };
    },
    async delete(keys: string | string[]) {
      for (const key of [keys].flat()) store.delete(key);
    },
  };
}

test('the sweep removes expired uploads in every retention class and keeps live ones', async () => {
  const bucket = fakeBucket([
    { key: 't1h/a', uploaded: new Date(NOW - 2 * HOUR) },
    { key: 't1h/b', uploaded: new Date(NOW - HOUR / 2) },
    { key: 't1d/c', uploaded: new Date(NOW - HOUR), customMetadata: { expires: String(NOW - 1) } },
    { key: 't1d/d', uploaded: new Date(NOW - 25 * HOUR), customMetadata: { expires: String(NOW + HOUR) } },
    { key: 't1d/e', uploaded: new Date(NOW - HOUR), customMetadata: { expires: String(NOW + HOUR) } },
    { key: 't7d/f/meta', uploaded: new Date(NOW - 8 * 24 * HOUR) },
    { key: 't7d/f/p/0', uploaded: new Date(NOW - 8 * 24 * HOUR) },
    { key: 't7d/g', uploaded: new Date(NOW - 24 * HOUR), customMetadata: { expires: 'junk' } },
    { key: 'unrelated', uploaded: new Date(0) },
  ]);
  const removed = await sweepExpiredUploads(bucket as never, NOW);
  assert.equal(removed, 5);
  assert.deepEqual([...bucket.store.keys()].sort(), ['t1d/e', 't1h/b', 't7d/g', 'unrelated']);
});

test('the fresh-install config stays generic and production keeps its own domains and history', () => {
  const toml = readFileSync('wrangler.toml', 'utf8');
  const production = JSON.parse(readFileSync('wrangler.production.json', 'utf8'));
  assert.doesNotMatch(toml.replace(/^#.*$/gm, ''), /encrypt\.click|c76ce085|jurisdiction/);
  assert.match(toml, /^workers_dev = true$/m);
  assert.match(toml, /^crons = \[/m);
  const tags = [...toml.matchAll(/^tag = "([^"]+)"/gm)].map(([, tag]) => tag);
  assert.deepEqual(production.migrations.slice(0, tags.length).map((m: { tag: string }) => m.tag), tags);
  assert.deepEqual(production.routes.map((r: { pattern: string }) => r.pattern), ['encrypt.click', 'www.encrypt.click']);
  assert.equal(production.r2_buckets[0].jurisdiction, 'eu');
});
