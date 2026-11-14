/**
 * Content of a compact chat-cipher envelope: one flag byte and the message, compressed when that comes out shorter.
 * The flag travels inside the encrypted body, so the compression never leaks anything about the message, and it names
 * the exact language model used, so unpacking never depends on the language of the cover or of the receiving client.
 */

import { huffmanPack, huffmanUnpack } from './huffman';
import { COVER_LANGS } from './coverTable';
import type { CoverLang } from './coverTable';

const RAW = 0;
const DEFLATE = 1;
const HUFFMAN = 2; // huffman flags are HUFFMAN + COVER_LANGS.indexOf(lang), so the model id travels inside the sealed body

async function deflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream()!.pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream()!.pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

export async function packContent(text: string, lang: CoverLang): Promise<Uint8Array> {
  const raw = new TextEncoder().encode(text);
  let flag = RAW;
  let payload: Uint8Array = raw;
  const deflated = await deflateRaw(raw);
  if (deflated && deflated.length < payload.length) {
    flag = DEFLATE;
    payload = deflated;
  }
  const huffed = huffmanPack(raw, lang);
  if (huffed && huffed.length < payload.length) {
    flag = HUFFMAN + COVER_LANGS.indexOf(lang);
    payload = huffed;
  }
  const content = new Uint8Array(1 + payload.length);
  content[0] = flag;
  content.set(payload, 1);
  return content;
}

export async function unpackContent(content: Uint8Array): Promise<string> {
  if (content.length < 1) throw new Error('Empty sealed content');
  const payload = content.subarray(1);
  if (content[0] === RAW) return new TextDecoder().decode(payload);
  if (content[0] === DEFLATE) {
    const raw = await inflateRaw(payload);
    if (!raw) throw new Error('Sealed content does not decompress');
    return new TextDecoder().decode(raw);
  }
  const langIndex = content[0] - HUFFMAN;
  if (langIndex >= 0 && langIndex < COVER_LANGS.length) {
    return new TextDecoder().decode(huffmanUnpack(payload, COVER_LANGS[langIndex]));
  }
  throw new Error('Unsupported sealed content');
}
