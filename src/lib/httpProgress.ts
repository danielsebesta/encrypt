/** XHR helpers that expose upload and download byte progress (fetch cannot). */

export type ByteProgress = (loaded: number, total: number) => void;

function headersToObject(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => { out[key] = value; });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  return { ...headers };
}

/** XHR is happiest with Blob/ArrayBuffer bodies; TypedArray views can confuse Content-Length in some engines. */
function xhrBody(body: BodyInit | null | undefined): XMLHttpRequestBodyInit | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body;
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    const view = body as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return new Blob([copy], { type: 'application/octet-stream' });
  }
  if (body instanceof FormData || body instanceof URLSearchParams) return body;
  throw new TypeError('Unsupported upload body');
}

function bodyLength(body: BodyInit | null | undefined): number {
  if (body == null) return 0;
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  return 0;
}

/**
 * Same-origin / CORS request with upload progress. Returns a Fetch `Response` so callers
 * keep using `.json()` / `.arrayBuffer()` as today.
 */
export function xhrRequest(
  url: string,
  init: {
    method?: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    signal?: AbortSignal;
  } = {},
  onUploadProgress?: ByteProgress,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method || 'GET', url, true);
    xhr.responseType = 'arraybuffer';
    const headers = headersToObject(init.headers);
    for (const [key, value] of Object.entries(headers)) xhr.setRequestHeader(key, value);

    const totalHint = bodyLength(init.body);
    if (onUploadProgress && totalHint > 0) onUploadProgress(0, totalHint);

    xhr.upload.onprogress = (event) => {
      if (!onUploadProgress) return;
      const total = event.lengthComputable ? event.total : totalHint;
      onUploadProgress(event.loaded, total > 0 ? total : totalHint);
    };

    xhr.onload = () => {
      if (onUploadProgress && totalHint > 0) onUploadProgress(totalHint, totalHint);
      const responseHeaders = new Headers();
      const raw = xhr.getAllResponseHeaders();
      for (const line of raw.trim().split(/[\r\n]+/)) {
        const idx = line.indexOf(':');
        if (idx > 0) responseHeaders.append(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
      }
      const buffer = xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0);
      resolve(new Response(buffer.byteLength ? buffer : null, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: responseHeaders,
      }));
    };
    xhr.onerror = () => reject(new TypeError('Network request failed'));
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

    if (init.signal) {
      if (init.signal.aborted) {
        xhr.abort();
        return;
      }
      init.signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    try {
      xhr.send(xhrBody(init.body ?? null));
    } catch (error) {
      reject(error);
    }
  });
}

/** Reads a Response body while reporting download progress when Content-Length is known. */
export async function readResponseProgress(
  res: Response,
  onProgress?: ByteProgress,
): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'));
  const total = Number.isFinite(declared) && declared > 0 ? declared : 0;
  if (!res.body) {
    onProgress?.(0, total);
    return new Uint8Array();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress?.(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(loaded, total > 0 ? total : loaded);
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
