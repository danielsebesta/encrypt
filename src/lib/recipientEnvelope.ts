import { ml_kem768_x25519 } from '@noble/post-quantum/hybrid.js';
import { equalBytes, hkdfAesKey, hkdfBytes, hkdfKey } from './kdf';
import { padme } from './padding';
import { randomIndex } from './random';
import {
  CARD_MAX_BYTES, KEM_CIPHERTEXT_BYTES, KEM_PUBLIC_BYTES, SIGNATURE_BYTES, parseCard, sha256, signMessage, verifySignature,
  type Card, type Identity,
} from './identity';

const ECR1_MAGIC = new Uint8Array([0x45, 0x43, 0x52, 0x31, 1]);
export const RECIPIENT_SLOTS = 8;
const FILE_KEY_BYTES = 32;
const TAG_BYTES = 16;
const WRAPPED_BYTES = FILE_KEY_BYTES + TAG_BYTES;
const SLOT_BYTES = KEM_CIPHERTEXT_BYTES + WRAPPED_BYTES;
const COMMITMENT_OFFSET = ECR1_MAGIC.length + RECIPIENT_SLOTS * SLOT_BYTES;
const HEADER_BYTES = COMMITMENT_OFFSET + 32;
const LENGTH_BYTES = 4;
const FLAG_SIGNED = 1;
const SIGNED_EXTRA_MAX = 2 + CARD_MAX_BYTES + SIGNATURE_BYTES;
const SIG_CONTEXT = new TextEncoder().encode('encrypt.click/recipient/v1/sig');

export const RECIPIENT_HEADER_BYTES = HEADER_BYTES;

export class NotForThisKey extends Error {
  constructor() {
    super('Not encrypted for this key');
  }
}

export function isRecipientEnvelope(data: Uint8Array): boolean {
  return data.length >= ECR1_MAGIC.length && ECR1_MAGIC.every((byte, i) => data[i] === byte);
}

/** Bytes the envelope adds to its content at most, before padding. */
export function recipientOverhead(signed: boolean): number {
  return HEADER_BYTES + TAG_BYTES + LENGTH_BYTES + 1 + (signed ? SIGNED_EXTRA_MAX : 0);
}

async function wrapKeys(sharedSecret: Uint8Array): Promise<{ key: CryptoKey; iv: Uint8Array }> {
  const base = await hkdfKey(sharedSecret);
  const [key, iv] = await Promise.all([
    hkdfAesKey(base, 'encrypt.click/recipient/v1/wrap/key'),
    hkdfBytes(base, 'encrypt.click/recipient/v1/wrap/iv', 12),
  ]);
  return { key, iv };
}

async function fileKeys(fileKey: Uint8Array): Promise<{ key: CryptoKey; iv: Uint8Array; commitment: Uint8Array }> {
  const base = await hkdfKey(fileKey);
  const [key, iv, commitment] = await Promise.all([
    hkdfAesKey(base, 'encrypt.click/recipient/v1/body/key'),
    hkdfBytes(base, 'encrypt.click/recipient/v1/body/iv', 12),
    hkdfBytes(base, 'encrypt.click/recipient/v1/commit'),
  ]);
  return { key, iv, commitment };
}

function slotAad(kemCiphertext: Uint8Array): Uint8Array {
  const aad = new Uint8Array(ECR1_MAGIC.length + kemCiphertext.length);
  aad.set(ECR1_MAGIC);
  aad.set(kemCiphertext, ECR1_MAGIC.length);
  return aad;
}

async function sealSlot(kemPub: Uint8Array, fileKey: Uint8Array): Promise<Uint8Array> {
  const { cipherText, sharedSecret } = ml_kem768_x25519.encapsulate(kemPub);
  try {
    const { key, iv } = await wrapKeys(sharedSecret);
    const wrapped = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: slotAad(cipherText) as BufferSource }, key, fileKey as BufferSource,
    ));
    const slot = new Uint8Array(SLOT_BYTES);
    slot.set(cipherText);
    slot.set(wrapped, KEM_CIPHERTEXT_BYTES);
    return slot;
  } finally {
    sharedSecret.fill(0);
  }
}

async function openSlot(slot: Uint8Array, kemSecret: Uint8Array): Promise<Uint8Array | null> {
  const cipherText = slot.subarray(0, KEM_CIPHERTEXT_BYTES);
  let sharedSecret: Uint8Array;
  try {
    sharedSecret = ml_kem768_x25519.decapsulate(cipherText, kemSecret);
  } catch {
    return null;
  }
  try {
    const { key, iv } = await wrapKeys(sharedSecret);
    const fileKey = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: slotAad(cipherText) as BufferSource }, key, slot.subarray(KEM_CIPHERTEXT_BYTES) as BufferSource,
    ));
    return fileKey.length === FILE_KEY_BYTES ? fileKey : null;
  } catch {
    return null;
  } finally {
    sharedSecret.fill(0);
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export type SealRecipientOptions = { signer?: Identity | null; maxLength?: number };

/**
 * ECR1: magic and version, eight slots of an X-Wing ciphertext and the file key wrapped under its shared secret,
 * a commitment to the file key, then AES-256-GCM over the length-prefixed, Padmé-padded body with the whole header
 * as AAD. Unused slots go to throwaway keys and the slot order is shuffled, so the file shows neither who can open
 * it nor how many. A signature covers the hash of the header, slots included, and of the content.
 */
export async function sealForRecipients(content: Uint8Array | Uint8Array[], recipients: Uint8Array[], options: SealRecipientOptions = {}): Promise<Uint8Array> {
  const unique: Uint8Array[] = [];
  for (const kemPub of recipients) {
    if (kemPub.length !== KEM_PUBLIC_BYTES) throw new Error('Invalid recipient key');
    if (!unique.some((known) => equalBytes(known, kemPub))) unique.push(kemPub);
  }
  if (unique.length === 0 || unique.length > RECIPIENT_SLOTS) throw new Error('Invalid recipient count');

  const parts = Array.isArray(content) ? content : [content];
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  if (length > 0xffff_ffff - recipientOverhead(true)) throw new Error('Input too large');

  const fileKey = crypto.getRandomValues(new Uint8Array(FILE_KEY_BYTES));
  try {
    const slots: Uint8Array[] = [];
    for (const kemPub of unique) slots.push(await sealSlot(kemPub, fileKey));
    while (slots.length < RECIPIENT_SLOTS) {
      const decoy = ml_kem768_x25519.keygen();
      decoy.secretKey.fill(0);
      slots.push(await sealSlot(decoy.publicKey, crypto.getRandomValues(new Uint8Array(FILE_KEY_BYTES))));
    }
    shuffle(slots);

    const { key, iv, commitment } = await fileKeys(fileKey);
    const header = new Uint8Array(HEADER_BYTES);
    header.set(ECR1_MAGIC);
    slots.forEach((slot, i) => header.set(slot, ECR1_MAGIC.length + i * SLOT_BYTES));
    header.set(commitment, COMMITMENT_OFFSET);

    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { joined.set(part, offset); offset += part.length; }

    let signedExtra = new Uint8Array(0);
    if (options.signer) {
      const card = options.signer.card.bytes;
      const signature = await signMessage(options.signer, new Uint8Array([...SIG_CONTEXT, ...(await sha256(header)), ...(await sha256(joined))]));
      signedExtra = new Uint8Array(2 + card.length + SIGNATURE_BYTES);
      new DataView(signedExtra.buffer).setUint16(0, card.length);
      signedExtra.set(card, 2);
      signedExtra.set(signature, 2 + card.length);
    }

    const inner = LENGTH_BYTES + 1 + signedExtra.length + length;
    const ceiling = Math.max(inner, (options.maxLength ?? Infinity) - HEADER_BYTES - TAG_BYTES);
    const body = new Uint8Array(Math.min(padme(inner), ceiling));
    const view = new DataView(body.buffer);
    view.setUint32(0, length);
    body[LENGTH_BYTES] = options.signer ? FLAG_SIGNED : 0;
    body.set(signedExtra, LENGTH_BYTES + 1);
    body.set(joined, LENGTH_BYTES + 1 + signedExtra.length);
    joined.fill(0);

    const cipher = new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource }, key, body as BufferSource,
    ));
    body.fill(0);
    const result = new Uint8Array(HEADER_BYTES + cipher.length);
    result.set(header);
    result.set(cipher, HEADER_BYTES);
    return result;
  } finally {
    fileKey.fill(0);
  }
}

export type OpenedRecipientEnvelope = { content: Uint8Array; sender: Card | null };

export async function openRecipientEnvelope(data: Uint8Array, kemSecret: Uint8Array): Promise<OpenedRecipientEnvelope> {
  if (!isRecipientEnvelope(data)) throw new Error('Unsupported encrypted data');
  if (data.length < HEADER_BYTES + TAG_BYTES + LENGTH_BYTES + 1) throw new Error('Truncated encrypted data');
  const header = data.subarray(0, HEADER_BYTES);

  let fileKey: Uint8Array | null = null;
  for (let i = 0; i < RECIPIENT_SLOTS; i++) {
    const start = ECR1_MAGIC.length + i * SLOT_BYTES;
    const opened = await openSlot(header.subarray(start, start + SLOT_BYTES), kemSecret);
    if (opened && !fileKey) fileKey = opened;
    else opened?.fill(0);
  }
  if (!fileKey) throw new NotForThisKey();

  let body: Uint8Array;
  try {
    const { key, iv, commitment } = await fileKeys(fileKey);
    if (!equalBytes(commitment, header.subarray(COMMITMENT_OFFSET))) throw new Error('Invalid key commitment');
    body = new Uint8Array(await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: header as BufferSource }, key, data.subarray(HEADER_BYTES) as BufferSource,
    ));
  } finally {
    fileKey.fill(0);
  }

  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const length = view.getUint32(0);
  const flags = body[LENGTH_BYTES];
  if (flags & ~FLAG_SIGNED) throw new Error('Unsupported encrypted data');
  let offset = LENGTH_BYTES + 1;
  let sender: Card | null = null;
  let signature: Uint8Array | null = null;
  if (flags & FLAG_SIGNED) {
    if (offset + 2 > body.length) throw new Error('Invalid encrypted data');
    const cardLength = view.getUint16(offset);
    offset += 2;
    if (cardLength > CARD_MAX_BYTES || offset + cardLength + SIGNATURE_BYTES > body.length) throw new Error('Invalid encrypted data');
    sender = await parseCard(body.slice(offset, offset + cardLength));
    if (!sender) throw new Error('Invalid sender card');
    offset += cardLength;
    signature = body.slice(offset, offset + SIGNATURE_BYTES);
    offset += SIGNATURE_BYTES;
  }
  if (offset + length > body.length) throw new Error('Invalid encrypted data');
  if (body.subarray(offset + length).some((byte) => byte !== 0)) throw new Error('Invalid encrypted data');
  const content = body.slice(offset, offset + length);
  if (sender && signature) {
    const message = new Uint8Array([...SIG_CONTEXT, ...(await sha256(header)), ...(await sha256(content))]);
    if (!(await verifySignature(sender.signPub, signature, message))) throw new Error('Invalid sender signature');
  }
  return { content, sender };
}
