import { locales } from './languages';

export type QrTarget =
  | { kind: 'receive'; href: string }
  | { kind: 'link'; url: string }
  | { kind: 'text' };

export type QrPixels = { width: number; height: number; data: Uint8Array | Uint8ClampedArray };

type Detector = { detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]> };

const RECEIVE_PATH = new RegExp(`^(?:/(?:${locales.join('|')}))?/u/?$`);

export function isReceivePath(pathname: string): boolean {
  return RECEIVE_PATH.test(pathname);
}

export function receivePayload(url: URL): string {
  if (url.hash.length > 1) return url.hash.slice(1);
  const query = url.searchParams.get('p');
  return query ? encodeURIComponent(query) : '';
}

export function classifyQrText(text: string, here: { origin: string; pathname: string }): QrTarget {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { kind: 'text' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { kind: 'text' };
  const payload = isReceivePath(url.pathname) ? receivePayload(url) : '';
  if (payload && url.origin === here.origin) return { kind: 'receive', href: `${here.pathname}#${payload}` };
  if (payload) return { kind: 'link', url: `${url.origin}${url.pathname}#${payload}` };
  return { kind: 'link', url: url.href };
}

export async function decodePixels(pixels: QrPixels): Promise<string | null> {
  const { default: decodeQR } = await import('qr/decode.js');
  try {
    return decodeQR(pixels) || null;
  } catch {
    return null;
  }
}

let native: Promise<Detector | null> | undefined;

function nativeDetector(): Promise<Detector | null> {
  native ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: any }).BarcodeDetector;
    if (!Native) return null;
    try {
      const formats: string[] | undefined = await Native.getSupportedFormats?.();
      if (formats && !formats.includes('qr_code')) return null;
      return new Native({ formats: ['qr_code'] }) as Detector;
    } catch {
      return null;
    }
  })();
  return native;
}

let canvas: HTMLCanvasElement | undefined;

export async function readQr(source: HTMLVideoElement | ImageBitmap, maxSide = 1024): Promise<string | null> {
  const detector = await nativeDetector();
  if (detector) {
    try {
      return (await detector.detect(source))[0]?.rawValue || null;
    } catch {
      return null;
    }
  }
  const width = source instanceof ImageBitmap ? source.width : source.videoWidth;
  const height = source instanceof ImageBitmap ? source.height : source.videoHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  canvas ??= document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return decodePixels(context.getImageData(0, 0, canvas.width, canvas.height));
}

export function openReceiveLink(href: string): void {
  history.pushState(null, '', href);
  location.reload();
}
