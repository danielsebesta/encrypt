/** Deterministic top-k linguistic steganography over a next-token scorer. */

export type NextLogits = (context: number[]) => Float32Array | Promise<Float32Array>;

export type StegoProgress = (done: number, total: number, token?: number) => void;

export interface StegoCodec {
  encode(data: Uint8Array, onProgress?: StegoProgress): Promise<number[]>;
  decode(tokens: number[], onProgress?: StegoProgress): Promise<Uint8Array>;
}

export interface StegoOptions {
  /** Tokens that start every cover sequence. */
  start: number[];
  /** How many top candidates carry bits (must be a power of two). */
  topK?: number;
  /** Ban these ids from candidates (pad, specials). */
  ban?: number[];
  /** Soft cap on generated tokens (encode fails if data does not fit). */
  maxTokens?: number;
}

function writeVarint(out: number[], value: number) {
  while (value >= 0x80) {
    out.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  out.push(value);
}

function bitsFromBytes(data: Uint8Array): number[] {
  const bits: number[] = [];
  for (const byte of data) {
    for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  }
  return bits;
}

function topIndices(logits: Float32Array, k: number, ban: Set<number>): number[] {
  const scored: { i: number; v: number }[] = [];
  for (let i = 0; i < logits.length; i++) {
    if (ban.has(i)) continue;
    scored.push({ i, v: logits[i]! });
  }
  scored.sort((a, b) => b.v - a.v || a.i - b.i);
  if (scored.length < k) throw new Error('Model vocabulary too small for stego top-k');
  return scored.slice(0, k).map(s => s.i);
}

export function createStegoCodec(next: NextLogits, options: StegoOptions): StegoCodec {
  const topK = options.topK ?? 16;
  if (topK < 2 || (topK & (topK - 1)) !== 0) throw new Error('topK must be a power of two');
  const bitsPer = Math.log2(topK);
  const ban = new Set(options.ban ?? []);
  const maxTokens = options.maxTokens ?? 4096;

  async function encode(data: Uint8Array, onProgress?: StegoProgress): Promise<number[]> {
    if (data.byteLength > 64 * 1024) throw new Error('Message too large');
    const payload: number[] = [];
    writeVarint(payload, data.byteLength);
    const body = new Uint8Array(payload.length + data.byteLength);
    body.set(payload);
    body.set(data, payload.length);
    const bits = bitsFromBytes(body);
    let bitAt = 0;
    const context = options.start.slice();
    const out = context.slice();
    const total = Math.max(1, Math.ceil(bits.length / bitsPer));
    let done = 0;
    onProgress?.(0, total);

    while (bitAt < bits.length) {
      if (out.length - options.start.length >= maxTokens) throw new Error('Cover text would be too long');
      const logits = await next(context);
      const ids = topIndices(logits, topK, ban);
      let choice = 0;
      for (let b = 0; b < bitsPer; b++) {
        choice = (choice << 1) | (bits[bitAt++] ?? 0);
      }
      const token = ids[choice]!;
      context.push(token);
      out.push(token);
      done++;
      onProgress?.(done, total, token);
    }
    return out.slice(options.start.length);
  }

  async function decode(tokens: number[], onProgress?: StegoProgress): Promise<Uint8Array> {
    if (!tokens.length) throw new Error('No cover tokens');
    const bits: number[] = [];
    const context = options.start.slice();
    const total = tokens.length;
    onProgress?.(0, total);
    let done = 0;
    for (const token of tokens) {
      const logits = await next(context);
      const ids = topIndices(logits, topK, ban);
      const choice = ids.indexOf(token);
      if (choice < 0) throw new Error('Cover text does not match this language pack');
      for (let b = bitsPer - 1; b >= 0; b--) bits.push((choice >> b) & 1);
      context.push(token);
      done++;
      onProgress?.(done, total, token);
    }

    const available = bits.length >> 3;
    let length = 0;
    let shift = 0;
    let offset = 0;
    for (;;) {
      if (offset >= available) throw new Error('Truncated cover text');
      const byte = (() => {
        let value = 0;
        for (let i = 0; i < 8; i++) value = (value << 1) | (bits[offset * 8 + i] ?? 0);
        return value;
      })();
      offset++;
      length |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) break;
      shift += 7;
      if (shift > 28) throw new Error('Invalid cover header');
    }
    if (available - offset < length) throw new Error('Truncated cover text');
    if (bits.length - (offset + length) * 8 >= bitsPer * 8) throw new Error('Extra cover tokens');
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      let value = 0;
      for (let b = 0; b < 8; b++) value = (value << 1) | (bits[(offset + i) * 8 + b] ?? 0);
      out[i] = value;
    }
    return out;
  }

  return { encode, decode };
}
