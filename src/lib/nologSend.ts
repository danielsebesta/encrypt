const DEFAULT_NONCE = 'yRCdyQ1EMSA3mo4rqSkuNQ==';
const KEY_LENGTH = 16;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const ECE_RECORD_SIZE = 1024 * 64;
const DEFAULT_TIME_LIMIT = 172800;
const DEFAULT_DOWNLOAD_LIMIT = 50;

const encoder = new TextEncoder();
type DebugFn = (message: string) => void;

export interface SendInstance {
  baseUrl: string;
  label: string;
  region: 'eu' | 'other';
  country?: string;
}

function arrayToB64(array: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < array.length; i++) binary += String.fromCharCode(array[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64ToArray(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function delay(ms = 100) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseNonce(header: string | null): string {
  return (header || '').split(' ')[1] || '';
}

function transformStream(readable: ReadableStream<Uint8Array>, transformer: Transformer<Uint8Array, Uint8Array>) {
  try {
    return readable.pipeThrough(new TransformStream(transformer));
  } catch {
    const reader = readable.getReader();
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        if (transformer.start) {
          await transformer.start(controller);
        }
      },
      async pull(controller) {
        let enqueued = false;
        const wrappedController = {
          enqueue(chunk: Uint8Array) {
            enqueued = true;
            controller.enqueue(chunk);
          },
        };

        while (!enqueued) {
          const data = await reader.read();
          if (data.done) {
            if (transformer.flush) {
              await transformer.flush(controller);
            }
            controller.close();
            return;
          }
          await transformer.transform?.(data.value, wrappedController as unknown as TransformStreamDefaultController<Uint8Array>);
        }
      },
      cancel(reason) {
        return readable.cancel(reason);
      },
    });
  }
}

async function streamToUint8Array(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    length += value.length;
  }

  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

class StreamSlicer implements Transformer<Uint8Array, Uint8Array> {
  private chunkSize: number;
  private partialChunk: Uint8Array;
  private offset = 0;

  constructor(private rs: number, private mode: 'encrypt' | 'decrypt') {
    this.chunkSize = mode === 'encrypt' ? rs - 17 : 21;
    this.partialChunk = new Uint8Array(this.chunkSize);
  }

  private send(buf: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    controller.enqueue(buf);
    if (this.chunkSize === 21 && this.mode === 'decrypt') {
      this.chunkSize = this.rs;
    }
    this.partialChunk = new Uint8Array(this.chunkSize);
    this.offset = 0;
  }

  transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    let i = 0;

    if (this.offset > 0) {
      const len = Math.min(chunk.byteLength, this.chunkSize - this.offset);
      this.partialChunk.set(chunk.slice(0, len), this.offset);
      this.offset += len;
      i += len;

      if (this.offset === this.chunkSize) {
        this.send(this.partialChunk, controller);
      }
    }

    while (i < chunk.byteLength) {
      const remaining = chunk.byteLength - i;
      if (remaining >= this.chunkSize) {
        this.send(chunk.slice(i, i + this.chunkSize), controller);
        i += this.chunkSize;
      } else {
        const tail = chunk.slice(i);
        this.partialChunk.set(tail);
        this.offset = tail.byteLength;
        i += tail.byteLength;
      }
    }
  }

  flush(controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.offset > 0) {
      controller.enqueue(this.partialChunk.slice(0, this.offset));
    }
  }
}

class ECETransformer implements Transformer<Uint8Array, Uint8Array> {
  private prevChunk?: Uint8Array;
  private seq = 0;
  private firstChunk = true;
  private key?: CryptoKey;
  private nonceBase?: Uint8Array;

  constructor(
    private mode: 'encrypt' | 'decrypt',
    private ikm: Uint8Array,
    private rs: number,
    private salt?: Uint8Array,
  ) {}

  private async importSecretKey() {
    return crypto.subtle.importKey('raw', this.ikm, 'HKDF', false, ['deriveKey']);
  }

  private async generateKey() {
    const inputKey = await this.importSecretKey();
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: this.salt!,
        info: encoder.encode('Content-Encoding: aes128gcm\0'),
        hash: 'SHA-256',
      },
      inputKey,
      { name: 'AES-GCM', length: 128 },
      true,
      ['encrypt', 'decrypt'],
    );
  }

  private async generateNonceBase() {
    const inputKey = await this.importSecretKey();
    const baseKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: this.salt!,
        info: encoder.encode('Content-Encoding: nonce\0'),
        hash: 'SHA-256',
      },
      inputKey,
      { name: 'AES-GCM', length: 128 },
      true,
      ['encrypt', 'decrypt'],
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', baseKey));
    return raw.slice(0, NONCE_LENGTH);
  }

  private generateNonce(seq: number) {
    const nonce = new Uint8Array(this.nonceBase!);
    const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength);
    const mixed = (view.getUint32(NONCE_LENGTH - 4) ^ seq) >>> 0;
    view.setUint32(NONCE_LENGTH - 4, mixed);
    return nonce;
  }

  private pad(data: Uint8Array, isLast: boolean) {
    if (data.length + TAG_LENGTH >= this.rs) {
      throw new Error('data too large for record size');
    }
    if (isLast) {
      return concatBytes(data, new Uint8Array([2]));
    }
    const padding = new Uint8Array(this.rs - data.length - TAG_LENGTH);
    padding[0] = 1;
    return concatBytes(data, padding);
  }

  private unpad(data: Uint8Array, isLast: boolean) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i]) {
        if (isLast && data[i] !== 2) throw new Error('invalid final record delimiter');
        if (!isLast && data[i] !== 1) throw new Error('invalid record delimiter');
        return data.slice(0, i);
      }
    }
    throw new Error('no delimiter found');
  }

  private createHeader() {
    const header = new Uint8Array(KEY_LENGTH + 5);
    header.set(this.salt!, 0);
    const view = new DataView(header.buffer);
    view.setUint32(KEY_LENGTH, this.rs);
    view.setUint8(KEY_LENGTH + 4, 0);
    return header;
  }

  private readHeader(buffer: Uint8Array) {
    if (buffer.length < 21) throw new Error('chunk too small for header');
    const salt = buffer.slice(0, KEY_LENGTH);
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const rs = view.getUint32(KEY_LENGTH);
    const idlen = view.getUint8(KEY_LENGTH + 4);
    return { salt, rs, length: idlen + KEY_LENGTH + 5 };
  }

  private async encryptRecord(buffer: Uint8Array, seq: number, isLast: boolean) {
    const nonce = this.generateNonce(seq);
    const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, this.key!, this.pad(buffer, isLast));
    return new Uint8Array(encrypted);
  }

  private async decryptRecord(buffer: Uint8Array, seq: number, isLast: boolean) {
    const nonce = this.generateNonce(seq);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, this.key!, buffer);
    return this.unpad(new Uint8Array(decrypted), isLast);
  }

  async start(controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.mode === 'encrypt') {
      this.salt = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
      this.key = await this.generateKey();
      this.nonceBase = await this.generateNonceBase();
      controller.enqueue(this.createHeader());
    }
  }

  private async transformPrevChunk(isLast: boolean, controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.mode === 'encrypt') {
      controller.enqueue(await this.encryptRecord(this.prevChunk!, this.seq, isLast));
      this.seq++;
      return;
    }

    if (this.seq === 0) {
      const header = this.readHeader(this.prevChunk!);
      this.salt = header.salt;
      this.rs = header.rs;
      this.key = await this.generateKey();
      this.nonceBase = await this.generateNonceBase();
    } else {
      controller.enqueue(await this.decryptRecord(this.prevChunk!, this.seq - 1, isLast));
    }
    this.seq++;
  }

  async transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
    if (!this.firstChunk) {
      await this.transformPrevChunk(false, controller);
    }
    this.firstChunk = false;
    this.prevChunk = chunk;
  }

  async flush(controller: TransformStreamDefaultController<Uint8Array>) {
    if (this.prevChunk) {
      await this.transformPrevChunk(true, controller);
    }
  }
}

function encryptStream(input: ReadableStream<Uint8Array>, key: Uint8Array, rs = ECE_RECORD_SIZE) {
  return transformStream(transformStream(input, new StreamSlicer(rs, 'encrypt')), new ECETransformer('encrypt', key, rs));
}

function decryptStream(input: ReadableStream<Uint8Array>, key: Uint8Array, rs = ECE_RECORD_SIZE) {
  return transformStream(transformStream(input, new StreamSlicer(rs, 'decrypt')), new ECETransformer('decrypt', key, rs));
}

async function encryptSendBytes(data: Uint8Array, key: Uint8Array) {
  const encryptedStream = encryptStream(new Blob([data]).stream() as ReadableStream<Uint8Array>, key);
  return streamToUint8Array(encryptedStream);
}

class NologSendKeychain {
  rawSecret: Uint8Array;
  private nonceValue = DEFAULT_NONCE;

  constructor(secretKeyB64?: string) {
    this.rawSecret = secretKeyB64 ? b64ToArray(secretKeyB64) : crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  }

  get nonce() {
    return this.nonceValue;
  }

  set nonce(value: string) {
    if (value) this.nonceValue = value;
  }

  private async importSecretKey() {
    return crypto.subtle.importKey('raw', this.rawSecret, 'HKDF', false, ['deriveKey']);
  }

  private async deriveAuthKey() {
    const secretKey = await this.importSecretKey();
    return crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: new Uint8Array(),
        info: encoder.encode('authentication'),
        hash: 'SHA-256',
      },
      secretKey,
      { name: 'HMAC', hash: { name: 'SHA-256' } },
      true,
      ['sign'],
    );
  }

  async authKeyB64() {
    const authKey = await this.deriveAuthKey();
    const raw = await crypto.subtle.exportKey('raw', authKey);
    return arrayToB64(new Uint8Array(raw));
  }

  async authHeader() {
    const authKey = await this.deriveAuthKey();
    const sig = await crypto.subtle.sign({ name: 'HMAC' }, authKey, b64ToArray(this.nonceValue));
    return `send-v1 ${arrayToB64(new Uint8Array(sig))}`;
  }

  async encryptMetadata(metadata: { name: string; size: number; type: string; manifest?: Record<string, unknown> }) {
    const secretKey = await this.importSecretKey();
    const metaKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        salt: new Uint8Array(),
        info: encoder.encode('metadata'),
        hash: 'SHA-256',
      },
      secretKey,
      { name: 'AES-GCM', length: 128 },
      false,
      ['encrypt'],
    );
    const data = encoder.encode(JSON.stringify({
      name: metadata.name,
      size: metadata.size,
      type: metadata.type || 'application/octet-stream',
      manifest: metadata.manifest || {},
    }));
    return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12), tagLength: 128 }, metaKey, data));
  }
}

async function openWs(url: string) {
  return new Promise<WebSocket>((resolve, reject) => {
    try {
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      ws.addEventListener('open', () => resolve(ws), { once: true });
      ws.addEventListener('error', () => reject(new Error(`WebSocket connection failed (readyState=${ws.readyState})`)), { once: true });
      ws.addEventListener('close', (event) => reject(new Error(`WebSocket closed before open (code=${event.code}, reason=${event.reason || 'none'})`)), { once: true });
    } catch (error) {
      reject(error);
    }
  });
}

function listenForResponse(ws: WebSocket) {
  return new Promise<any>((resolve, reject) => {
    function handleClose(event: CloseEvent) {
      ws.removeEventListener('message', handleMessage);
      reject(new Error(`NoLog Send connection closed (code=${event.code}, reason=${event.reason || 'none'})`));
    }
    function handleMessage(event: MessageEvent) {
      ws.removeEventListener('close', handleClose);
      try {
        const response = JSON.parse(String(event.data));
        if (response.error) throw new Error(String(response.error));
        resolve(response);
      } catch (error) {
        reject(error);
      }
    }
    ws.addEventListener('message', handleMessage, { once: true });
    ws.addEventListener('close', handleClose, { once: true });
  });
}

export async function uploadToNologSend(data: Uint8Array, filename: string, fileType = 'application/octet-stream', onDebug?: DebugFn) {
  const keychain = new NologSendKeychain();
  onDebug?.(`NoLog Send: preparing ${filename} (${data.byteLength} bytes)`);
  const encryptedStream = encryptStream(new Blob([data]).stream() as ReadableStream<Uint8Array>, keychain.rawSecret);
  const metadata = await keychain.encryptMetadata({ name: filename, size: data.byteLength, type: fileType });
  const verifierB64 = await keychain.authKeyB64();
  onDebug?.(`NoLog Send: metadata encrypted (${metadata.byteLength} bytes)`);
  const ws = await openWs('wss://upload.nolog.cz/api/ws');
  onDebug?.('NoLog Send: websocket opened');

  try {
    const uploadInfoResponse = listenForResponse(ws);
    ws.send(JSON.stringify({
      fileMetadata: arrayToB64(metadata),
      authorization: `send-v1 ${verifierB64}`,
      timeLimit: DEFAULT_TIME_LIMIT,
      dlimit: DEFAULT_DOWNLOAD_LIMIT,
    }));
    onDebug?.(`NoLog Send: upload handshake sent (timeLimit=${DEFAULT_TIME_LIMIT}s, dlimit=${DEFAULT_DOWNLOAD_LIMIT})`);

    const uploadInfo = await uploadInfoResponse;
    onDebug?.(`NoLog Send: upload accepted (id=${uploadInfo.id}, url=${uploadInfo.url})`);
    const completedResponse = listenForResponse(ws);
    const reader = encryptedStream.getReader();
    let sentBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      ws.send(value);
      sentBytes += value.byteLength;
      while (ws.bufferedAmount > ECE_RECORD_SIZE * 2 && ws.readyState === WebSocket.OPEN) {
        await delay();
      }
    }
    onDebug?.(`NoLog Send: encrypted stream sent (${sentBytes} bytes including envelope)`);

    if (ws.readyState === WebSocket.OPEN) {
      ws.send(new Uint8Array([0]));
      onDebug?.('NoLog Send: EOF sent');
    }

    await completedResponse;
    onDebug?.('NoLog Send: server confirmed upload completion');
    return `${uploadInfo.url}#${arrayToB64(keychain.rawSecret)}`;
  } finally {
    if (![WebSocket.CLOSING, WebSocket.CLOSED].includes(ws.readyState)) {
      ws.close();
    }
  }
}

function normalizeSendBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/g, '');
}

function parseSendDownloadUrl(urlString: string) {
  const url = new URL(urlString);
  const match = url.pathname.match(/\/download\/([0-9a-fA-F]{10,16})\/?$/);
  const secret = url.hash.slice(1);

  if (!match || !secret) {
    throw new Error('Invalid Send URL');
  }

  return {
    baseUrl: `${url.protocol}//${url.host}`,
    id: match[1],
    secret,
  };
}

export async function uploadToSendHttp(baseUrl: string, data: Uint8Array, filename: string, fileType = 'application/octet-stream', onDebug?: DebugFn) {
  const normalizedBaseUrl = normalizeSendBaseUrl(baseUrl);
  const keychain = new NologSendKeychain();
  onDebug?.(`Send ${normalizedBaseUrl}: preparing ${filename} (${data.byteLength} bytes)`);
  const metadata = await keychain.encryptMetadata({ name: filename, size: data.byteLength, type: fileType });
  const verifierB64 = await keychain.authKeyB64();
  onDebug?.(`Send ${normalizedBaseUrl}: metadata encrypted (${metadata.byteLength} bytes)`);
  const encryptedBytes = await encryptSendBytes(data, keychain.rawSecret);
  onDebug?.(`Send ${normalizedBaseUrl}: encrypted body prepared (${encryptedBytes.byteLength} bytes including envelope)`);

  const res = await fetch(`${normalizedBaseUrl}/api/upload`, {
    method: 'POST',
    headers: {
      'Authorization': `send-v1 ${verifierB64}`,
      'X-File-Metadata': arrayToB64(metadata),
      'Content-Type': 'application/octet-stream',
    },
    body: encryptedBytes,
  });
  onDebug?.(`Send ${normalizedBaseUrl}: HTTP upload response ${res.status}`);
  if (!res.ok) {
    throw new Error(`Send upload failed: HTTP ${res.status}`);
  }

  const uploadInfo = await res.json() as any;
  if (!uploadInfo?.url) {
    throw new Error('Send upload failed: missing URL');
  }
  onDebug?.(`Send ${normalizedBaseUrl}: upload accepted (id=${uploadInfo.id}, url=${uploadInfo.url})`);
  return `${uploadInfo.url}#${arrayToB64(keychain.rawSecret)}`;
}

async function fetchSendBlob(baseUrl: string, id: string, keychain: NologSendKeychain, onDebug?: DebugFn) {
  const normalizedBaseUrl = normalizeSendBaseUrl(baseUrl);
  const doFetch = async () => {
    const res = await fetch(`${normalizedBaseUrl}/api/download/blob/${id}`, {
      headers: { Authorization: await keychain.authHeader() },
    });
    const nonce = parseNonce(res.headers.get('WWW-Authenticate'));
    return { res, nonce };
  };

  let { res, nonce } = await doFetch();
  onDebug?.(`Send ${normalizedBaseUrl}: blob fetch response ${res.status}`);
  if (res.status === 401 && nonce && nonce !== keychain.nonce) {
    keychain.nonce = nonce;
    onDebug?.(`Send ${normalizedBaseUrl}: received nonce challenge, retrying fetch`);
    ({ res } = await doFetch());
    onDebug?.(`Send ${normalizedBaseUrl}: retry response ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(`Send download failed: HTTP ${res.status}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  onDebug?.(`Send ${normalizedBaseUrl}: encrypted blob downloaded (${bytes.byteLength} bytes)`);
  return bytes;
}

export async function downloadFromSendUrl(urlString: string, onDebug?: DebugFn) {
  const { baseUrl, id, secret } = parseSendDownloadUrl(urlString);
  const keychain = new NologSendKeychain(secret);
  onDebug?.(`Send ${baseUrl}: resolving download ${id}`);
  const encryptedBytes = await fetchSendBlob(baseUrl, id, keychain, onDebug);
  const decryptedStream = decryptStream(new Blob([encryptedBytes]).stream() as ReadableStream<Uint8Array>, keychain.rawSecret);
  const decryptedBytes = await streamToUint8Array(decryptedStream);
  onDebug?.(`Send ${baseUrl}: outer Send layer decrypted (${decryptedBytes.byteLength} bytes)`);
  return decryptedBytes;
}

export async function downloadFromSendServer(urlString: string, onDebug?: DebugFn) {
  return downloadFromSendUrl(urlString, onDebug);
}

export function isSendUrl(urlString: string) {
  try {
    parseSendDownloadUrl(urlString);
    return true;
  } catch {
    return false;
  }
}
