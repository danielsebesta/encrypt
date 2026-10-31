import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { LEGACY_TTL_MS } from '../../lib/retention';
import type { BlobMeta, BlobStore, StoredBlob } from '../../platform/types';

export const BLOB_TTL_MS = LEGACY_TTL_MS;
const ID_RE = /^(?:t(?:1h|7d)-)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Row = { expires: number; burn: number };

/**
 * Ciphertext uploads as plain files: `<dir>/<id>`, written under `<dir>/.tmp` and renamed into place once complete.
 * Expiry and the one-time flag sit in SQLite; files without a row expire a day after they were written.
 */
export class FileBlobStore implements BlobStore {
  private readonly tmp: string;

  constructor(
    private readonly dir: string,
    private readonly now = () => Date.now(),
    private readonly meta: DatabaseSync = new DatabaseSync(':memory:'),
  ) {
    this.tmp = path.join(dir, '.tmp');
    meta.exec('CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, expires INTEGER NOT NULL, burn INTEGER NOT NULL) WITHOUT ROWID');
  }

  async init() {
    await mkdir(this.tmp, { recursive: true, mode: 0o700 });
  }

  async put(id: string, body: ReadableStream<Uint8Array>, size: number, meta: BlobMeta): Promise<void> {
    if (!ID_RE.test(id)) throw new Error('Invalid blob id');
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid blob size');
    const partial = path.join(this.tmp, `${id}.${randomUUID()}`);
    let written = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        callback(written > size ? new Error('Body longer than declared') : null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>), counter, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
      if (written !== size) throw new Error('Body shorter than declared');
      this.meta.prepare('INSERT OR REPLACE INTO blobs (id, expires, burn) VALUES (?, ?, ?)').run(id, Math.round(meta.expires), meta.burn ? 1 : 0);
      await rename(partial, this.file(id));
    } catch (error) {
      await rm(partial, { force: true });
      this.forget(id);
      throw error;
    }
  }

  async get(id: string): Promise<StoredBlob | null> {
    if (!ID_RE.test(id)) return null;
    const file = this.file(id);
    const handle = await open(file, 'r').catch(() => null);
    if (!handle) return null;
    const info = await handle.stat();
    const { expires, burn } = this.metaOf(id, info.mtimeMs);
    if (!info.isFile() || this.now() >= expires) {
      await handle.close();
      if (info.isFile()) await this.delete(id);
      return null;
    }
    return { body: Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>, size: info.size, uploaded: info.mtimeMs, expires, burn };
  }

  async delete(id: string): Promise<void> {
    if (!ID_RE.test(id)) return;
    await rm(this.file(id), { force: true });
    this.forget(id);
  }

  /** Deletes expired uploads, abandoned partial writes and stale metadata; returns how many files went. */
  async sweep(): Promise<number> {
    let removed = 0;
    for (const dir of [this.dir, this.tmp]) {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile()) continue;
        const file = path.join(dir, entry.name);
        const info = await stat(file).catch(() => null);
        if (!info) continue;
        const expires = dir === this.dir && ID_RE.test(entry.name) ? this.metaOf(entry.name, info.mtimeMs).expires : info.mtimeMs + BLOB_TTL_MS;
        if (this.now() >= expires) {
          await rm(file, { force: true });
          if (dir === this.dir) this.forget(entry.name);
          removed++;
        }
      }
    }
    this.meta.prepare('DELETE FROM blobs WHERE expires <= ?').run(this.now());
    return removed;
  }

  private metaOf(id: string, mtimeMs: number): BlobMeta {
    const row = this.meta.prepare('SELECT expires, burn FROM blobs WHERE id = ?').get(id) as Row | undefined;
    return row ? { expires: row.expires, burn: row.burn === 1 } : { expires: mtimeMs + BLOB_TTL_MS, burn: false };
  }

  private forget(id: string) {
    this.meta.prepare('DELETE FROM blobs WHERE id = ?').run(id);
  }

  private file(id: string) {
    return path.join(this.dir, id);
  }
}
