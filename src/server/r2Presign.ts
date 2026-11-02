const enc = new TextEncoder();
const toHex = (buf: ArrayBuffer | Uint8Array) =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');

function toBufferSource(data: string | Uint8Array): ArrayBuffer {
  if (typeof data === 'string') {
    const bytes = enc.encode(data);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function hmacSha256(key: string | Uint8Array, data: string | Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    toBufferSource(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, toBufferSource(data)),
  );
}

async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', toBufferSource(data)));
}

export interface SignR2PutParams {
  accountId: string;
  bucketName: string;
  jurisdiction?: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds?: number;
  headers?: Record<string, string>;
  date?: Date;
}

/**
 * Generates an AWS Signature Version 4 presigned PUT URL for Cloudflare R2 object storage.
 * Runs completely on Web Cryptography API without external dependencies.
 */
export async function signR2PutUrl(params: SignR2PutParams): Promise<string> {
  const {
    accountId,
    bucketName,
    jurisdiction,
    key,
    accessKeyId,
    secretAccessKey,
    expiresInSeconds = 3600,
    headers = {},
    date = new Date(),
  } = params;

  const host = jurisdiction
    ? `${accountId}.${jurisdiction}.r2.cloudflarestorage.com`
    : `${accountId}.r2.cloudflarestorage.com`;

  const dateIso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = dateIso.slice(0, 8);
  const region = 'auto';
  const service = 's3';
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;

  const encodedPath = `/${encodeURIComponent(bucketName)}/${key.split('/').map(encodeURIComponent).join('/')}`;

  // Canonical headers must be lowercase, sorted, and include 'host'
  const headerMap = new Map<string, string>();
  headerMap.set('host', host);
  for (const [k, v] of Object.entries(headers)) {
    headerMap.set(k.toLowerCase().trim(), v.trim());
  }

  const sortedHeaderKeys = Array.from(headerMap.keys()).sort();
  const signedHeaders = sortedHeaderKeys.join(';');
  const canonicalHeaders = sortedHeaderKeys.map(k => `${k}:${headerMap.get(k)}\n`).join('');

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${credentialScope}`,
    'X-Amz-Date': dateIso,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  query.sort();

  const canonicalQuery = query.toString();
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = ['PUT', encodedPath, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const canonicalRequestHash = await sha256Hex(canonicalRequest);

  const stringToSign = ['AWS4-HMAC-SHA256', dateIso, credentialScope, canonicalRequestHash].join('\n');

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return `https://${host}${encodedPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
