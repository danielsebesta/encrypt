// The contract between the platform-neutral server code and each deployment target (Cloudflare Workers, Node).

export interface SqlLike {
  exec(query: string, ...bindings: any[]): { toArray(): any[] };
}

export interface BlobMeta {
  /** Absolute expiry in milliseconds; the object counts as gone from then on. */
  expires: number;
  /** Deleted after its first download. */
  burn: boolean;
}

export interface StoredBlob extends BlobMeta {
  body: ReadableStream<Uint8Array>;
  size: number;
  uploaded: number;
}

/**
 * Ciphertext uploads. Ids match BLOB_ID_RE in src/lib/retention.ts and carry their retention class. Objects stored
 * without metadata, from before retention classes, expire a day after upload.
 *
 * Multipart uploads store discrete parts under the same id. `get` streams them in order only after `complete`, and
 * returns null for incomplete sessions so downloads cannot race a partial upload.
 */
export interface BlobStore {
  put(id: string, body: ReadableStream<Uint8Array>, size: number, meta: BlobMeta): Promise<void>;
  get(id: string): Promise<StoredBlob | null>;
  delete(id: string): Promise<void>;
  beginMultipart(id: string, parts: number, meta: BlobMeta): Promise<void>;
  putPart(id: string, index: number, body: ReadableStream<Uint8Array>, size: number): Promise<void>;
  completeMultipart(id: string): Promise<void>;
}

export interface UploadLimits {
  monthlyBytes: number;
  monthlyUploads: number;
  dailyBytes: number;
  dailyBytesPerClient: number;
  maxFileBytes: number;
}

export type BudgetCommand =
  | { op: 'rate'; key: string; limit: number; globalLimit: number }
  | { op: 'relay'; client: string; bytes: number; browser: boolean; pass: string | null; dailyCap: number }
  | { op: 'salt' }
  | { op: 'reserve'; client: string; bytes: number; browser: boolean; pass: string | null; limits: UploadLimits }
  | { op: 'release'; client: string; bytes: number; limits: UploadLimits }
  | { op: 'status'; limits: UploadLimits }
  | { op: 'spend'; nonce: string; expires: number }
  | { op: 'challenges'; client: string };

export interface Platform {
  /** Secrets and settings: Worker bindings on Cloudflare, process.env on Node. */
  env: Record<string, string | undefined>;
  /** The visitor's address as the platform reports it, before any /64 grouping. */
  clientIp(request: Request): string;
  /**
   * Runs one budget command against the SQLite database of `scope`. Commands for one scope must never interleave:
   * a Durable Object per scope on Cloudflare, a synchronous SQLite call on Node.
   */
  budget<T = unknown>(scope: string, command: BudgetCommand): Promise<T>;
  blobs: BlobStore;
  /** Hands a /parties/<party>/<room> request to the realtime rooms; Node upgrades sockets itself and answers 426 here. */
  realtime(request: Request): Promise<Response>;
  /** Keeps background work running after the response: ctx.waitUntil on Cloudflare, a detached promise on Node. */
  waitUntil(work: Promise<unknown>): void;
  /** Commit the running build was made from, when the platform knows it. */
  build?: string;
  /** When this process started, in milliseconds; only long-lived processes have one. */
  startedAt?: number;
}
