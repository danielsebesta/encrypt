import { sealPassword, openPassword } from './passwordEnvelope';

export async function encrypt(text: string, password: string): Promise<Uint8Array> {
  return sealPassword(new TextEncoder().encode(text), password);
}

export async function decrypt(data: Uint8Array, password: string): Promise<string> {
  return new TextDecoder().decode(await openPassword(data, password));
}

/** Uses the legacy uint16 length, or zero followed by uint32 for larger payloads. */
export function to14BitChunks(data: Uint8Array): number[] {
  const length = data.byteLength;
  if (length > 16 * 1024 * 1024) throw new Error('Input too large');
  const prefix = length > 65535 ? 6 : 2;
  const combined = new Uint8Array(length + prefix);
  combined[0] = prefix === 6 ? 0 : (length >> 8) & 0xff;
  combined[1] = prefix === 6 ? 0 : length & 0xff;
  if (prefix === 6) new DataView(combined.buffer).setUint32(2, length);
  combined.set(data, prefix);

  const chunks: number[] = [];
  let currentVal = 0;
  let currentBits = 0;

  for (const byte of combined) {
    currentVal = (currentVal << 8) | byte;
    currentBits += 8;

    while (currentBits >= 14) {
      currentBits -= 14;
      chunks.push((currentVal >> currentBits) & 0x3fff);
      currentVal &= (1 << currentBits) - 1;
    }
  }

  if (currentBits > 0) {
    chunks.push((currentVal << (14 - currentBits)) & 0x3fff);
  }

  return chunks;
}

/** Recovers bytes from 14-bit chunks produced by to14BitChunks. */
export function from14BitChunks(chunks: number[]): Uint8Array {
  if (chunks.length > 10_000_000 || chunks.some(c => !Number.isInteger(c) || c < 0 || c > 16383)) throw new Error('Invalid words');
  const bytes: number[] = [];
  let currentVal = 0;
  let currentBits = 0;

  for (const chunk of chunks) {
    currentVal = (currentVal << 14) | (chunk & 0x3fff);
    currentBits += 14;

    while (currentBits >= 8) {
      currentBits -= 8;
      bytes.push((currentVal >> currentBits) & 0xff);
      currentVal &= (1 << currentBits) - 1;
    }
  }

  if (bytes.length < 2) return new Uint8Array(0);

  let length = (bytes[0] << 8) | bytes[1];
  let prefix = 2;
  if (length === 0 && bytes.length >= 6) {
    length = new DataView(new Uint8Array(bytes).buffer).getUint32(2); prefix = 6;
    if (length <= 65535) throw new Error('Invalid extended length');
  }
  if (prefix + length > bytes.length || bytes.length - prefix - length > 1) throw new Error('Invalid length');
  return new Uint8Array(bytes.slice(prefix, prefix + length));
}
