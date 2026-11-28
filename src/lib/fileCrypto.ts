import { openChunkedFile } from './chunkedFile';
import { b64urlToArray } from './chatCrypto';
import { KEY_ENVELOPE_BYTES, openWithKey, sealWithKey, isKeyEnvelope } from './keyEnvelope';
import { PASSWORD_ENVELOPE_OVERHEAD, sealPassword, openPassword } from './passwordEnvelope';
import { FIRST_PARTY_ENVELOPE_LIMIT, SEND_ENVELOPE_LIMIT } from './httpLimits';
import { isRecipientEnvelope, openRecipientEnvelope, recipientOverhead, sealForRecipients } from './recipientEnvelope';
import type { Card, Identity } from './identity';
export const ECLK_MAGIC = new Uint8Array([0x45, 0x43, 0x4c, 0x4b]);

export function prependEclkMagic(data: Uint8Array): Uint8Array {
  const combined = new Uint8Array(ECLK_MAGIC.length + data.length);
  combined.set(ECLK_MAGIC, 0);
  combined.set(data, ECLK_MAGIC.length);
  return combined;
}

const UPLOAD_CEILINGS = [SEND_ENVELOPE_LIMIT, FIRST_PARTY_ENVELOPE_LIMIT];

export async function encryptData(data: Uint8Array, password: string, originalName = '', timeSecret?: Uint8Array): Promise<Uint8Array> {
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(1, meta.length);
  const length = head.length + meta.length + data.length;
  const maxLength = UPLOAD_CEILINGS.find(limit => length + PASSWORD_ENVELOPE_OVERHEAD <= limit);
  return sealPassword([head, meta, data], password, { maxLength, timeSecret });
}

export async function encryptForRecipients(data: Uint8Array, recipients: Uint8Array[], signer: Identity | null, originalName = ''): Promise<Uint8Array> {
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(1, meta.length);
  const length = head.length + meta.length + data.length;
  const maxLength = UPLOAD_CEILINGS.find(limit => length + recipientOverhead(Boolean(signer)) <= limit);
  return sealForRecipients([head, meta, data], recipients, { signer, maxLength });
}

export async function decryptForRecipient(encrypted: Uint8Array, kemSecret: Uint8Array): Promise<{ data: Uint8Array; name: string; sender: Card | null }> {
  const { content, sender } = await openRecipientEnvelope(encrypted, kemSecret);
  return { ...parseSealedPayload(content), sender };
}

export { isRecipientEnvelope };

export async function encryptDataWithKey(data: Uint8Array, key: Uint8Array, originalName = ''): Promise<Uint8Array> {
  if (key.length !== KEY_ENVELOPE_BYTES) throw new Error('Invalid file key');
  const meta = new TextEncoder().encode(JSON.stringify({ name: originalName, size: data.length }));
  if (meta.length > 65536) throw new Error('Metadata too large');
  const head = new Uint8Array(5);
  new DataView(head.buffer).setUint32(1, meta.length);
  return sealWithKey([head, meta, data], key);
}

function parseSealedPayload(payload: Uint8Array): { data: Uint8Array; name: string } {
  if (payload.length < 5 || payload[0] !== 0) throw new Error('Invalid encrypted file metadata');
  const length = new DataView(payload.buffer, payload.byteOffset, payload.byteLength).getUint32(1);
  if (length < 2 || length > 65536 || 5 + length > payload.length) throw new Error('Invalid metadata length');
  const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload.slice(5, 5 + length)));
  const data = payload.slice(5 + length);
  if (!meta || typeof meta.name !== 'string' || !Number.isSafeInteger(meta.size) || meta.size !== data.length) throw new Error('Invalid metadata');
  return { data, name: meta.name || 'decrypted-file' };
}

async function decryptClassic(encrypted: Uint8Array, password: string, timeSecret?: Uint8Array): Promise<{ data: Uint8Array; name: string }> {
  return parseSealedPayload(await openPassword(encrypted, password, timeSecret));
}

async function decryptKeyFile(encrypted: Uint8Array, keyB64url: string): Promise<{ data: Uint8Array; name: string }> {
  let key: Uint8Array;
  try {
    key = b64urlToArray(keyB64url);
  } catch {
    throw new Error('Invalid file key');
  }
  if (key.length !== KEY_ENVELOPE_BYTES) throw new Error('Invalid file key');
  return parseSealedPayload(await openWithKey(encrypted, key));
}

export async function decryptData(encrypted: Uint8Array, passwordOrKey: string, timeSecret?: Uint8Array): Promise<{ data: Uint8Array; name: string }> {
  if (isRecipientEnvelope(encrypted)) throw new Error('Encrypted for recipient keys');
  if (isKeyEnvelope(encrypted)) {
    return decryptKeyFile(encrypted, passwordOrKey);
  }
  try {
    return await decryptClassic(encrypted, passwordOrKey, timeSecret);
  } catch (classic) {
    try {
      return await openChunkedFile(encrypted, passwordOrKey, timeSecret);
    } catch {
      throw classic;
    }
  }
}
