import { IMAGE_MAX_EDGE, IMAGE_TARGET_BYTES, type BoardAsset } from './whiteboardRecords';
import { bytesToB64 } from './whiteboardCrypto';

const QUALITIES = [0.85, 0.75, 0.62, 0.5];
const SHRINK = 0.75;
const MAX_ROUNDS = 6;

let webp: boolean | null = null;

function canEncodeWebp(): boolean {
  if (webp === null) {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    webp = probe.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webp;
}

async function decode(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

/**
 * Re-encodes a picture on this device before it joins the board: at most IMAGE_MAX_EDGE on the long side, WebP where the
 * browser can write it and JPEG elsewhere, stepping quality and then size down until it fits IMAGE_TARGET_BYTES.
 * Redrawing also drops metadata such as EXIF location.
 */
export async function encodeBoardImage(blob: Blob): Promise<BoardAsset> {
  const img = await decode(blob);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('Empty image');
  const mime = canEncodeWebp() ? 'image/webp' : 'image/jpeg';
  let scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  for (let round = 0; round < MAX_ROUNDS; round++) {
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No canvas');
    if (mime === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of QUALITIES) {
      const out = await encode(canvas, mime, quality);
      if (!out || out.type !== mime) throw new Error('Encoding failed');
      if (out.size <= IMAGE_TARGET_BYTES) {
        return { mime, width: canvas.width, height: canvas.height, data: bytesToB64(new Uint8Array(await out.arrayBuffer())) };
      }
    }
    scale *= SHRINK;
  }
  throw new Error('Image too detailed');
}
