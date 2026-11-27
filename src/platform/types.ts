export interface SqlLike {
  exec(query: string, ...bindings: any[]): { toArray(): any[] };
}

export interface BlobMeta {
  /** Absolute expiry in milliseconds; the object counts as gone from then on. */
  expires: number;
  burn: boolean;
}

export interface StoredBlob extends BlobMeta {
  body: ReadableStream<Uint8Array>;
  size: number;
  uploaded: number;
}

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
  env: Record<string, string | undefined>;
  clientIp(request: Request): string;
  /**
   * Runs one budget command against the SQLite database of `scope`. Commands for one scope must never interleave:
   * a Durable Object per scope on Cloudflare, a synchronous SQLite call on Node.
   */
  budget<T = unknown>(scope: string, command: BudgetCommand): Promise<T>;
  blobs: BlobStore;
  realtime(request: Request): Promise<Response>;
  waitUntil(work: Promise<unknown>): void;
  build?: string;
  startedAt?: number;
}
