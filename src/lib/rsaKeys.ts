function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function wrapPem(base64: string, label: string): string {
  const lines = base64.match(/.{1,64}/g) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(b64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sshString(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(data, 4);
  return out;
}

function sshMpint(value: Uint8Array): Uint8Array {
  if (value[0] & 0x80) {
    const padded = new Uint8Array(value.length + 1);
    padded.set(value, 1);
    return sshString(padded);
  }
  return sshString(value);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

async function generateRSACryptoKeyPair(bits: number) {
  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: bits,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

export async function generateRSAKeyPair(
  bits: number = 2048,
): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await generateRSACryptoKeyPair(bits);
  const [spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('spki', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);

  return {
    publicKey: wrapPem(arrayBufferToBase64(spki), 'PUBLIC KEY'),
    privateKey: wrapPem(arrayBufferToBase64(pkcs8), 'PRIVATE KEY'),
  };
}

export async function generateSSHKeyPair(
  bits: number = 4096,
): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await generateRSACryptoKeyPair(bits);
  const [jwk, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('jwk', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);

  const keyType = new TextEncoder().encode('ssh-rsa');
  const e = base64UrlToBytes(jwk.e!);
  const n = base64UrlToBytes(jwk.n!);
  const wireFormat = concatBytes(sshString(keyType), sshMpint(e), sshMpint(n));
  const wireFormatBuffer = wireFormat.buffer.slice(
    wireFormat.byteOffset,
    wireFormat.byteOffset + wireFormat.byteLength,
  ) as ArrayBuffer;

  return {
    publicKey: `ssh-rsa ${arrayBufferToBase64(wireFormatBuffer)}`,
    privateKey: wrapPem(arrayBufferToBase64(pkcs8), 'PRIVATE KEY'),
  };
}
