import { b64ToBytes, bytesToB64 } from './whiteboardCrypto';

// Doc updates travel encrypted and double base64 encoded (about 1.8x), so 360 kB parts stay under the relay's 720k-character cap.
export const DOC_PART_BYTES = 360_000;
export const MAX_DOC_PARTS = 64;
const HEADER = 13;
const VERSION = 1;
const MAX_ASSEMBLIES = 8;
const ASSEMBLY_TTL_MS = 120_000;

/** Splits an update into `[version | syncId(8) | index u16 | total u16 | bytes]` parts, or null when it is too large to send. */
export function splitDocUpdate(update: Uint8Array, partBytes = DOC_PART_BYTES): Uint8Array[] | null {
  const total = Math.ceil(update.length / partBytes);
  if (total < 2 || total > MAX_DOC_PARTS) return null;
  const syncId = crypto.getRandomValues(new Uint8Array(8));
  const parts: Uint8Array[] = [];
  for (let i = 0; i < total; i++) {
    const slice = update.subarray(i * partBytes, (i + 1) * partBytes);
    const part = new Uint8Array(HEADER + slice.length);
    const view = new DataView(part.buffer);
    part[0] = VERSION;
    part.set(syncId, 1);
    view.setUint16(9, i);
    view.setUint16(11, total);
    part.set(slice, HEADER);
    parts.push(part);
  }
  return parts;
}

type Assembly = { parts: (Uint8Array | undefined)[]; got: number; bytes: number; at: number };

/** Reassembles parts per sender; returns the whole update once its last part arrives. */
export class DocPartAssembler {
  private assemblies = new Map<string, Assembly>();

  constructor(private maxBytes = MAX_DOC_PARTS * DOC_PART_BYTES, private now = () => Date.now()) {}

  accept(from: string, part: Uint8Array): { update?: Uint8Array; received: number; total: number } | null {
    if (part.length <= HEADER || part[0] !== VERSION) return null;
    const view = new DataView(part.buffer, part.byteOffset, part.byteLength);
    const index = view.getUint16(9);
    const total = view.getUint16(11);
    if (total < 2 || total > MAX_DOC_PARTS || index >= total) return null;
    const key = `${from}:${Array.from(part.subarray(1, 9), b => b.toString(16).padStart(2, '0')).join('')}`;
    const now = this.now();
    for (const [k, a] of this.assemblies) if (now - a.at > ASSEMBLY_TTL_MS) this.assemblies.delete(k);

    let a = this.assemblies.get(key);
    if (!a) {
      // One unfinished update per sender, and the stalest one makes room, so a member cannot stall everyone else's sync.
      this.drop(from);
      if (this.assemblies.size >= MAX_ASSEMBLIES) {
        let stalest: string | null = null;
        for (const [k, other] of this.assemblies) if (!stalest || other.at < this.assemblies.get(stalest)!.at) stalest = k;
        if (stalest) this.assemblies.delete(stalest);
      }
      a = { parts: new Array(total), got: 0, bytes: 0, at: now };
      this.assemblies.set(key, a);
    }
    if (a.parts.length !== total || a.parts[index]) return null;
    const data = part.slice(HEADER);
    if (a.bytes + data.length > this.maxBytes) {
      this.assemblies.delete(key);
      return null;
    }
    a.parts[index] = data;
    a.got++;
    a.bytes += data.length;
    a.at = now;
    if (a.got < total) return { received: a.got, total };

    this.assemblies.delete(key);
    const update = new Uint8Array(a.bytes);
    let offset = 0;
    for (const p of a.parts) { update.set(p!, offset); offset += p!.length; }
    return { update, received: total, total };
  }

  /** Updates still waiting for parts; a snapshot taken now would miss them. */
  get pending(): number {
    const now = this.now();
    let count = 0;
    for (const a of this.assemblies.values()) if (now - a.at <= ASSEMBLY_TTL_MS) count++;
    return count;
  }

  drop(from: string) {
    for (const k of this.assemblies.keys()) if (k.startsWith(`${from}:`)) this.assemblies.delete(k);
  }
}

export const BOARD_BACKUP_FORMAT = 'encrypt-click-board';
export const BOARD_BACKUP_VERSION = 1;
export const BOARD_BACKUP_MAX_BYTES = 16 * 1024 * 1024;
const BACKUP_MAX_CHARS = Math.ceil(BOARD_BACKUP_MAX_BYTES / 3) * 4 + 1024;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** A local, unencrypted copy of the whole board: the Yjs state as one update. */
export function encodeBoardBackup(update: Uint8Array): string {
  return JSON.stringify({ format: BOARD_BACKUP_FORMAT, v: BOARD_BACKUP_VERSION, update: bytesToB64(update) });
}

export type BackupResult = { update: Uint8Array } | { error: 'invalid' | 'too-large' };

export function parseBoardBackup(text: string): BackupResult {
  if (text.length > BACKUP_MAX_CHARS) return { error: 'too-large' };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: 'invalid' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid' };
  const { format, v, update } = value as Record<string, unknown>;
  if (format !== BOARD_BACKUP_FORMAT || v !== BOARD_BACKUP_VERSION || typeof update !== 'string' || update.length < 4 || update.length % 4 || !B64_RE.test(update)) {
    return { error: 'invalid' };
  }
  const bytes = b64ToBytes(update);
  if (bytes.length > BOARD_BACKUP_MAX_BYTES) return { error: 'too-large' };
  return { update: bytes };
}

export const SAVED_BOARD_BYTES = 16 * 1024 * 1024;
export const SAVED_BOARD_IDLE_DAYS = 90;
export const SAVED_PAYLOAD_CHARS = 720_000;
// The log is folded into a fresh snapshot once it outgrows these, so a returning member replays roughly the board's own size.
export const COMPACT_LOG_BYTES = 1024 * 1024;
export const COMPACT_LOG_COUNT = 400;
