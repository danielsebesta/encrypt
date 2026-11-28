const MARKER = new TextEncoder().encode('!!DONE!!');
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_RAW_BYTES = 256 * 1024 * 1024;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// Pixels are written to and read from the PNG bytes directly: browsers that add noise to canvas readback (Helium, Brave) destroy the hidden bits.
export async function createStegoImage(data: Uint8Array): Promise<Uint8Array> {
  const payload = new Uint8Array(data.length + MARKER.length);
  payload.set(data, 0);
  payload.set(MARKER, data.length);

  const bitCount = payload.length * 8;
  const size = Math.ceil(Math.sqrt(Math.ceil(bitCount / 3))) + 20;
  const stride = 1 + size * 4;
  const raw = new Uint8Array(stride * size);

  const noise = new Uint8Array(size * size * 3);
  for (let at = 0; at < noise.length; at += 65536) crypto.getRandomValues(noise.subarray(at, at + 65536));

  let bit = 0;
  let sample = 0;
  for (let y = 0; y < size; y++) {
    for (let at = y * stride + 1; at < (y + 1) * stride; at += 4) {
      for (let channel = 0; channel < 3; channel++) {
        let value = 50 + ((noise[sample++] * 100) >> 8);
        if (bit < bitCount) {
          value = (value & 0xfe) | ((payload[bit >> 3] >> (7 - (bit & 7))) & 1);
          bit++;
        }
        raw[at + channel] = value;
      }
      raw[at + 3] = 255;
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  header.set([8, 6, 0, 0, 0], 8);
  const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  const parts = [PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', compressed), chunk('IEND', new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

type Pixels = { data: Uint8Array | Uint8ClampedArray; channels: number };

async function inflateExactly(compressed: Uint8Array[], length: number): Promise<Uint8Array | null> {
  const out = new Uint8Array(length);
  const reader = new Blob(compressed as BlobPart[]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let filled = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return filled === length ? out : null;
      if (filled + value.length > length) {
        await reader.cancel();
        return null;
      }
      out.set(value, filled);
      filled += value.length;
    }
  } catch {
    return null;
  }
}

function paeth(left: number, up: number, corner: number): number {
  const estimate = left + up - corner;
  const toLeft = Math.abs(estimate - left);
  const toUp = Math.abs(estimate - up);
  const toCorner = Math.abs(estimate - corner);
  if (toLeft <= toUp && toLeft <= toCorner) return left;
  return toUp <= toCorner ? up : corner;
}

/** Decodes 8-bit RGB and RGBA PNGs without interlacing; anything else returns null. */
async function readPng(file: Uint8Array): Promise<Pixels | null> {
  if (file.length < PNG_SIGNATURE.length || !PNG_SIGNATURE.every((byte, i) => file[i] === byte)) return null;
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const compressed: Uint8Array[] = [];
  let width = 0;
  let height = 0;
  let channels = 0;
  for (let at = PNG_SIGNATURE.length; at + 12 <= file.length;) {
    const length = view.getUint32(at);
    if (length > file.length - at - 12) return null;
    const type = String.fromCharCode(...file.subarray(at + 4, at + 8));
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      if (length !== 13 || body[8] !== 8 || (body[9] !== 2 && body[9] !== 6) || body[10] || body[11] || body[12]) return null;
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      compressed.push(body);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + length;
  }
  const row = width * channels;
  const total = (row + 1) * height;
  if (!width || !height || !compressed.length || total > MAX_RAW_BYTES) return null;
  const raw = await inflateExactly(compressed, total);
  if (!raw) return null;

  const data = new Uint8Array(row * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (row + 1)];
    if (filter > 4) return null;
    const source = y * (row + 1) + 1;
    const target = y * row;
    for (let x = 0; x < row; x++) {
      const left = x >= channels ? data[target + x - channels] : 0;
      const up = y ? data[target + x - row] : 0;
      const corner = y && x >= channels ? data[target + x - row - channels] : 0;
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner);
      data[target + x] = raw[source + x] + predicted;
    }
  }
  return { data, channels };
}

async function canvasPixels(file: Uint8Array): Promise<Pixels | null> {
  const bitmap = await createImageBitmap(new Blob([file as BlobPart]));
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, channels: 4 };
}

function hiddenPayload({ data, channels }: Pixels): Uint8Array | null {
  const out = new Uint8Array(Math.floor((Math.floor(data.length / channels) * 3) / 8));
  const last = MARKER[MARKER.length - 1];
  let length = 0;
  let byte = 0;
  let bits = 0;
  for (let at = 0; at + 2 < data.length; at += channels) {
    for (let channel = 0; channel < 3; channel++) {
      byte = (byte << 1) | (data[at + channel] & 1);
      if (++bits < 8) continue;
      out[length++] = byte;
      bits = 0;
      if (byte === last && length >= MARKER.length && MARKER.every((b, i) => out[length - MARKER.length + i] === b)) {
        return out.slice(0, length - MARKER.length);
      }
      byte = 0;
    }
  }
  return null;
}

export async function extractStego(imageData: Uint8Array): Promise<Uint8Array | null> {
  const pixels = (await readPng(imageData)) ?? (await canvasPixels(imageData));
  return pixels ? hiddenPayload(pixels) : null;
}
