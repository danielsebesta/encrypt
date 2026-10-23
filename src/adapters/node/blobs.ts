import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { BlobStore, StoredBlob } from '../../platform/types';

export const BLOB_TTL_MS = 24 * 60 * 60 * 1000;
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Ciphertext uploads as plain files: `<dir>/<id>`, written under `<dir>/.tmp` and renamed into place once complete. */
export class FileBlobStore implements BlobStore {
  private readonly tmp: string;

  constructor(private readonly dir: string, private readonly now = () => Date.now()) {
    this.tmp = path.join(dir, '.tmp');
  }

  async init() {
    await mkdir(this.tmp, { recursive: true, mode: 0o700 });
  }

  async put(id: string, body: ReadableStream<Uint8Array>, size: number): Promise<void> {
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
      await rename(partial, this.file(id));
    } catch (error) {
      await rm(partial, { force: true });
      throw error;
    }
  }

  async get(id: string): Promise<StoredBlob | null> {
    if (!ID_RE.test(id)) return null;
    const file = this.file(id);
    const handle = await open(file, 'r').catch(() => null);
    if (!handle) return null;
    const info = await handle.stat();
    if (!info.isFile() || this.now() - info.mtimeMs > BLOB_TTL_MS) {
      await handle.close();
      if (info.isFile()) await rm(file, { force: true });
      return null;
    }
    return { body: Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>, size: info.size, uploaded: info.mtimeMs };
  }

  async delete(id: string): Promise<void> {
    if (ID_RE.test(id)) await rm(this.file(id), { force: true });
  }

  /** Deletes expired uploads and abandoned partial writes; returns how many files went. */
  async sweep(): Promise<number> {
    let removed = 0;
    for (const dir of [this.dir, this.tmp]) {
      for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile()) continue;
        const file = path.join(dir, entry.name);
        const info = await stat(file).catch(() => null);
        if (info && this.now() - info.mtimeMs > BLOB_TTL_MS) {
          await rm(file, { force: true });
          removed++;
        }
      }
    }
    return removed;
  }

  private file(id: string) {
    return path.join(this.dir, id);
  }
}
