const MARKER = new TextEncoder().encode('!!DONE!!');

export async function createStegoImage(data: Uint8Array): Promise<Uint8Array> {
  const payload = new Uint8Array(data.length + MARKER.length);
  payload.set(data, 0);
  payload.set(MARKER, data.length);

  const bits: string[] = [];
  for (const byte of payload) {
    bits.push(byte.toString(2).padStart(8, '0'));
  }
  const bitString = bits.join('');

  const totalPixels = Math.ceil(bitString.length / 3);
  const size = Math.ceil(Math.sqrt(totalPixels)) + 20;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context failed');

  const imageData = ctx.createImageData(size, size);
  const pixels = imageData.data;

  let bitIdx = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 50 + Math.floor(Math.random() * 100);
    pixels[i + 1] = 50 + Math.floor(Math.random() * 100);
    pixels[i + 2] = 50 + Math.floor(Math.random() * 100);
    pixels[i + 3] = 255;

    if (bitIdx < bitString.length) {
      pixels[i] = (pixels[i] & 0xfe) | parseInt(bitString[bitIdx++], 10);
    }
    if (bitIdx < bitString.length) {
      pixels[i + 1] = (pixels[i + 1] & 0xfe) | parseInt(bitString[bitIdx++], 10);
    }
    if (bitIdx < bitString.length) {
      pixels[i + 2] = (pixels[i + 2] & 0xfe) | parseInt(bitString[bitIdx++], 10);
    }
  }

  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Failed to create blob'));
      blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)));
    }, 'image/png');
  });
}

export async function extractStego(imageData: Uint8Array): Promise<Uint8Array | null> {
  const blob = new Blob([imageData.buffer as ArrayBuffer], { type: 'image/png' });
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.drawImage(bitmap, 0, 0);
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imgData.data;

  const bits: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    bits.push(pixels[i] & 1);
    bits.push(pixels[i + 1] & 1);
    bits.push(pixels[i + 2] & 1);
  }

  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    if (i + 8 > bits.length) break;
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j];
    }
    bytes.push(byte);

    if (bytes.length >= MARKER.length) {
      const tail = bytes.slice(-MARKER.length);
      if (tail.every((b, idx) => b === MARKER[idx])) {
        return new Uint8Array(bytes.slice(0, -MARKER.length));
      }
    }
  }
  return null;
}
