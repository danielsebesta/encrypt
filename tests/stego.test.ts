import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, inflateSync } from 'node:zlib';
import { createStegoImage, extractStego } from '../src/lib/ghost/steganography';

const random = (length: number) => {
  const out = new Uint8Array(length);
  for (let at = 0; at < length; at += 65536) crypto.getRandomValues(out.subarray(at, at + 65536));
  return out;
};

function chunks(png: Uint8Array): { type: string; body: Uint8Array }[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out = [];
  for (let at = 8; at < png.length;) {
    const length = view.getUint32(at);
    out.push({ type: String.fromCharCode(...png.subarray(at + 4, at + 8)), body: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
  }
  return out;
}

function rebuild(signature: Uint8Array, parts: { type: string; body: Uint8Array }[]): Uint8Array {
  return Buffer.concat([signature, ...parts.flatMap(({ type, body }) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return [length, Buffer.from(type), Buffer.from(body), Buffer.alloc(4)];
  })]);
}

test('hidden data survives the round trip without a canvas', async () => {
  for (const length of [0, 1, 9381, 200_000]) {
    const data = random(length);
    const png = await createStegoImage(data);
    assert.deepEqual([...png.subarray(1, 4)], [...Buffer.from('PNG')]);
    assert.deepEqual(await extractStego(png), data);
  }
});

test('every PNG row filter and split image data decode to the same payload', async () => {
  const data = random(5000);
  const png = await createStegoImage(data);
  const parts = chunks(png);
  const header = parts.find((p) => p.type === 'IHDR')!.body;
  const size = Buffer.from(header).readUInt32BE(0);
  const row = size * 4;
  const raw = inflateSync(parts.find((p) => p.type === 'IDAT')!.body);
  const pixel = (x: number, y: number) => (x < 0 || y < 0 ? 0 : raw[y * (row + 1) + 1 + x]);
  const filtered = Buffer.from(raw);
  for (let y = 0; y < size; y++) {
    const filter = y % 5;
    filtered[y * (row + 1)] = filter;
    for (let x = 0; x < row; x++) {
      const left = pixel(x - 4, y);
      const up = pixel(x, y - 1);
      const corner = pixel(x - 4, y - 1);
      const p = left + up - corner;
      const nearest = Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - corner) ? left : Math.abs(p - up) <= Math.abs(p - corner) ? up : corner;
      const predicted = [0, left, up, (left + up) >> 1, nearest][filter];
      filtered[y * (row + 1) + 1 + x] = (pixel(x, y) - predicted) & 0xff;
    }
  }
  const compressed = deflateSync(filtered);
  const again = rebuild(png.subarray(0, 8), [
    { type: 'IHDR', body: header },
    { type: 'IDAT', body: compressed.subarray(0, 100) },
    { type: 'IDAT', body: compressed.subarray(100) },
    { type: 'IEND', body: new Uint8Array(0) },
  ]);
  assert.deepEqual(await extractStego(again), data);
});
