/** Same-origin language packs and ORT WASM from R2. Never list the bucket; GET/HEAD only. */

const MODEL_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.onnx_data': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export type ModelObject = {
  body: ReadableStream;
  size?: number;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
};

export type ModelStore = {
  get(key: string): Promise<ModelObject | null>;
};

export async function serveModel(
  request: Request,
  store: ModelStore | null | undefined,
  path: string,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  if (!store) return new Response('Models unavailable', { status: 503 });
  const key = path.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!key.startsWith('models/') || key.includes('\\') || key.split('/').some(p => !p || p === '..' || p === '.')) {
    return new Response('Not found', { status: 404 });
  }
  const object = await store.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const ext = key.includes('.') ? key.slice(key.lastIndexOf('.')) : '';
  const headers = new Headers();
  headers.set('Content-Type', MODEL_TYPES[ext] || object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('X-Content-Type-Options', 'nosniff');
  if (object.size != null) headers.set('Content-Length', String(object.size));
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(object.body, { status: 200, headers });
}
