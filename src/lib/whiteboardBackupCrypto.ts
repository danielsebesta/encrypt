import { openPassword, sealPassword, type SealOptions } from './passwordEnvelope';
import { b64ToBytes, bytesToB64 } from './whiteboardCrypto';
import { BOARD_BACKUP_MAX_BYTES, encodeBoardBackup, parseBoardBackup } from './whiteboardSync';

export const SEALED_BOARD_BACKUP_FORMAT = 'encrypt-click-board-sealed';
export const SEALED_BOARD_BACKUP_VERSION = 1;

const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const SEALED_MAX_CHARS = Math.ceil((BOARD_BACKUP_MAX_BYTES + 4096) / 3) * 4 + 1024;

function toBase64Url(bytes: Uint8Array): string {
  return bytesToB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!B64URL_RE.test(text) || text.length % 4 === 1) return null;
  return b64ToBytes(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));
}

/** Password-sealed board snapshot: `{ format, v, envelope }` where envelope is base64url(sealPassword(...)). */
export async function encodeEncryptedBoardBackup(update: Uint8Array, password: string, options: SealOptions = {}): Promise<string> {
  if (update.length > BOARD_BACKUP_MAX_BYTES) throw new Error('too-large');
  if (!password) throw new Error('password-required');
  const sealed = await sealPassword(new TextEncoder().encode(encodeBoardBackup(update)), password, options);
  return JSON.stringify({
    format: SEALED_BOARD_BACKUP_FORMAT,
    v: SEALED_BOARD_BACKUP_VERSION,
    envelope: toBase64Url(sealed),
  });
}

/** Opens a sealed board backup and returns the Yjs update bytes. */
export async function decodeEncryptedBoardBackup(text: string, password: string): Promise<Uint8Array> {
  if (!password) throw new Error('password-required');
  if (text.length > SEALED_MAX_CHARS) throw new Error('too-large');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  const { format, v, envelope } = value as Record<string, unknown>;
  if (format !== SEALED_BOARD_BACKUP_FORMAT || v !== SEALED_BOARD_BACKUP_VERSION || typeof envelope !== 'string') {
    throw new Error('invalid');
  }
  const sealed = fromBase64Url(envelope);
  if (!sealed) throw new Error('invalid');
  const opened = await openPassword(sealed, password);
  const asText = new TextDecoder().decode(opened);
  const parsed = parseBoardBackup(asText);
  if ('update' in parsed) return parsed.update;
  if (opened.length > BOARD_BACKUP_MAX_BYTES) throw new Error('too-large');
  return opened;
}
