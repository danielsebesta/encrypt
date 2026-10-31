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

type Row = { expires: number; burn: number; parts: number; complete: number };

/**
 * Ciphertext uploads as plain files: `<dir>/<id>`, written under `<dir>/.tmp` and renamed into place once complete.
 * Multipart uploads live in `<dir>/<id>.parts/<index>` until completed, then stay there and stream in order on get.
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
    meta.exec(`CREATE TABLE IF NOT EXISTS blobs (
      id TEXT PRIMARY KEY,
      expires INTEGER NOT NULL,
      burn INTEGER NOT NULL,
      parts INTEGER NOT NULL DEFAULT 0,
      complete INTEGER NOT NULL DEFAULT 1
    ) WITHOUT ROWID`);
    try { meta.exec('ALTER TABLE blobs ADD COLUMN parts INTEGER NOT NULL DEFAULT 0'); } catch { /* already present */ }
    try { meta.exec('ALTER TABLE blobs ADD COLUMN complete INTEGER NOT NULL DEFAULT 1'); } catch { /* already present */ }
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
      this.meta.prepare('INSERT OR REPLACE INTO blobs (id, expires, burn, parts, complete) VALUES (?, ?, ?, 0, 1)').run(id, Math.round(meta.expires), meta.burn ? 1 : 0);
      await rename(partial, this.file(id));
    } catch (error) {
      await rm(partial, { force: true });
      this.forget(id);
      throw error;
    }
  }

  async beginMultipart(id: string, parts: number, meta: BlobMeta): Promise<void> {
    if (!ID_RE.test(id)) throw new Error('Invalid blob id');
    if (!Number.isSafeInteger(parts) || parts < 2 || parts > 512) throw new Error('Invalid part count');
    await mkdir(this.partsDir(id), { recursive: true, mode: 0o700 });
    this.meta.prepare('INSERT OR REPLACE INTO blobs (id, expires, burn, parts, complete) VALUES (?, ?, ?, ?, 0)')
      .run(id, Math.round(meta.expires), meta.burn ? 1 : 0, parts);
  }

  async putPart(id: string, index: number, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
    const row = this.row(id);
    if (!row || row.complete === 1 || !Number.isSafeInteger(index) || index < 0 || index >= row.parts) throw new Error('Invalid part');
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid blob size');
    const dest = this.partFile(id, index);
    const partial = path.join(this.tmp, `${id}.${index}.${randomUUID()}`);
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
      await rename(partial, dest);
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  async completeMultipart(id: string): Promise<void> {
    const row = this.row(id);
    if (!row || row.complete === 1 || row.parts < 2) throw new Error('Invalid multipart upload');
    for (let i = 0; i < row.parts; i++) {
      const info = await stat(this.partFile(id, i)).catch(() => null);
      if (!info?.isFile()) throw new Error('Incomplete multipart upload');
    }
    this.meta.prepare('UPDATE blobs SET complete = 1 WHERE id = ?').run(id);
  }

  async get(id: string): Promise<StoredBlob | null> {
    if (!ID_RE.test(id)) return null;
    const row = this.row(id);
    if (row && row.parts > 0) {
      if (row.complete !== 1 || this.now() >= row.expires) {
        if (this.now() >= row.expires) await this.delete(id);
        return null;
      }
      const sizes: number[] = [];
      let total = 0;
      let uploaded = 0;
      for (let i = 0; i < row.parts; i++) {
        const info = await stat(this.partFile(id, i)).catch(() => null);
        if (!info?.isFile()) return null;
        sizes.push(info.size);
        total += info.size;
        uploaded = Math.max(uploaded, info.mtimeMs);
      }
      return {
        body: this.concatParts(id, row.parts),
        size: total,
        uploaded,
        expires: row.expires,
        burn: row.burn === 1,
      };
    }

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
    await rm(this.partsDir(id), { recursive: true, force: true });
    this.forget(id);
  }

  /** Deletes expired uploads, abandoned partial writes and stale metadata; returns how many files went. */
  async sweep(): Promise<number> {
    let removed = 0;
    for (const dir of [this.dir, this.tmp]) {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (entry.isDirectory() && entry.name.endsWith('.parts')) {
          const id = entry.name.slice(0, -'.parts'.length);
          if (!ID_RE.test(id)) continue;
          const expires = this.metaOf(id, 0).expires || 0;
          const info = await stat(path.join(dir, entry.name)).catch(() => null);
          const fallback = (info?.mtimeMs ?? 0) + BLOB_TTL_MS;
          if (this.now() >= (expires || fallback)) {
            await rm(path.join(dir, entry.name), { recursive: true, force: true });
            this.forget(id);
            removed++;
          }
          continue;
        }
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

  private concatParts(id: string, parts: number): ReadableStream<Uint8Array> {
    const dir = this.partsDir(id);
    let index = 0;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    return new ReadableStream({
      async pull(controller) {
        for (;;) {
          if (!reader) {
            if (index >= parts) { controller.close(); return; }
            const handle = await open(path.join(dir, String(index)), 'r');
            reader = (Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>).getReader();
            index++;
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

  private metaOf(id: string, mtimeMs: number): BlobMeta {
    const row = this.row(id);
    return row ? { expires: row.expires, burn: row.burn === 1 } : { expires: mtimeMs + BLOB_TTL_MS, burn: false };
  }

  private row(id: string): Row | undefined {
    return this.meta.prepare('SELECT expires, burn, parts, complete FROM blobs WHERE id = ?').get(id) as Row | undefined;
  }

  private forget(id: string) {
    this.meta.prepare('DELETE FROM blobs WHERE id = ?').run(id);
  }

  private file(id: string) {
    return path.join(this.dir, id);
  }

  private partsDir(id: string) {
    return path.join(this.dir, `${id}.parts`);
  }

  private partFile(id: string, index: number) {
    return path.join(this.partsDir(id), String(index));
  }
}
