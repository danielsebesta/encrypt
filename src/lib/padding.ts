/** Padmé: rounds a length up so that at most O(log log n) bits of it remain, with under 12% overhead. */
export function padme(length: number): number {
  if (!Number.isInteger(length) || length < 0 || length > 0xffffffff) throw new Error('Invalid length');
  if (length < 2) return length;
  const exponent = 31 - Math.clz32(length);
  const bits = 32 - Math.clz32(exponent);
  const step = 2 ** (exponent - bits);
  return Math.ceil(length / step) * step;
}

export const PAD_MIN_BYTES = 512;
export const PAD_MAX_CHARS = 65536;
// signPayload appends ,"_pk":"<43 chars>" and ,"_sig":"<86 chars>" after the padding is in place.
export const SIGNATURE_BYTES = 52 + 96;
// and in saved rooms also ,"_pqk":"<43 chars>" and ,"_pq":"<3227 chars>", the ML-DSA-44 key hash and signature.
export const PQ_SIGNATURE_BYTES = 53 + 3236;

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/**
 * Adds a _pad field so the final JSON, once signed, is exactly a Padmé bucket long and never shorter than the minimum,
 * which makes typing notices, presence checks and short messages the same size on the wire.
 */
export function padPayload(json: string, extra = SIGNATURE_BYTES, minimum = PAD_MIN_BYTES): string {
  const value = JSON.parse(json) as Record<string, unknown>;
  const size = utf8Length(JSON.stringify({ ...value, _pad: '' })) + extra;
  const target = Math.max(minimum, padme(size));
  return JSON.stringify({ ...value, _pad: '0'.repeat(Math.min(target - size, PAD_MAX_CHARS)) });
}

export function validPad(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= PAD_MAX_CHARS);
}
