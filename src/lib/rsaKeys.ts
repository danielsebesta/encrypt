export const RSA_BIT_LENGTHS = [2048, 3072, 4096] as const;
export const DEFAULT_RSA_BITS = 3072;

export type SSHKeyType = 'ed25519' | 'rsa';

const MAX_COMMENT_LENGTH = 256;
const OPENSSH_AUTH_MAGIC = 'openssh-key-v1\0';
const ED25519_PKCS8_PREFIX = Uint8Array.of(0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20);

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function wrapPem(base64: string, label: string, width = 64, trailingNewline = false): string {
  const lines = base64.match(new RegExp(`.{1,${width}}`, 'g')) || [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----${trailingNewline ? '\n' : ''}`;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const binary = atob(b64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sshUint32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value);
  return out;
}

function sshString(data: Uint8Array | string): Uint8Array {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return concatBytes(sshUint32(bytes.length), bytes);
}

function sshMpint(value: Uint8Array): Uint8Array {
  if (value[0] & 0x80) return sshString(concatBytes(Uint8Array.of(0), value));
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

function assertRsaBits(bits: number): void {
  if (!(RSA_BIT_LENGTHS as readonly number[]).includes(bits)) throw new RangeError(`RSA key length must be one of ${RSA_BIT_LENGTHS.join(', ')}`);
}

function cleanComment(comment: string): string {
  return comment.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim().slice(0, MAX_COMMENT_LENGTH);
}

async function generateRSACryptoKeyPair(bits: number) {
  assertRsaBits(bits);
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
  bits: number = DEFAULT_RSA_BITS,
): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await generateRSACryptoKeyPair(bits);
  const [spki, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('spki', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);

  return {
    publicKey: wrapPem(bytesToBase64(new Uint8Array(spki)), 'PUBLIC KEY'),
    privateKey: wrapPem(bytesToBase64(new Uint8Array(pkcs8)), 'PRIVATE KEY'),
  };
}

async function generateRSASSHKeyPair(bits: number, comment: string) {
  const keyPair = await generateRSACryptoKeyPair(bits);
  const [jwk, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('jwk', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);

  const wireFormat = concatBytes(sshString('ssh-rsa'), sshMpint(base64UrlToBytes(jwk.e!)), sshMpint(base64UrlToBytes(jwk.n!)));

  return {
    publicKey: `ssh-rsa ${bytesToBase64(wireFormat)}${comment ? ` ${comment}` : ''}`,
    privateKey: wrapPem(bytesToBase64(new Uint8Array(pkcs8)), 'PRIVATE KEY', 64, true),
  };
}

async function generateEd25519SSHKeyPair(comment: string) {
  const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const [rawPublic, pkcs8] = await Promise.all([
    crypto.subtle.exportKey('raw', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ]);
  const publicBytes = new Uint8Array(rawPublic);
  const pkcs8Bytes = new Uint8Array(pkcs8);
  if (
    publicBytes.length !== 32 ||
    pkcs8Bytes.length !== ED25519_PKCS8_PREFIX.length + 32 ||
    !ED25519_PKCS8_PREFIX.every((byte, i) => pkcs8Bytes[i] === byte)
  ) throw new Error('Unexpected Ed25519 key encoding');
  const seed = pkcs8Bytes.slice(ED25519_PKCS8_PREFIX.length);

  const publicBlob = concatBytes(sshString('ssh-ed25519'), sshString(publicBytes));
  const checkInt = crypto.getRandomValues(new Uint8Array(4));
  const privateSection = concatBytes(
    checkInt,
    checkInt,
    sshString('ssh-ed25519'),
    sshString(publicBytes),
    sshString(concatBytes(seed, publicBytes)),
    sshString(comment),
  );
  const padding = Uint8Array.from({ length: (8 - privateSection.length % 8) % 8 }, (_, i) => i + 1);
  const keyFile = concatBytes(
    new TextEncoder().encode(OPENSSH_AUTH_MAGIC),
    sshString('none'),
    sshString('none'),
    sshString(''),
    sshUint32(1),
    sshString(publicBlob),
    sshString(concatBytes(privateSection, padding)),
  );

  return {
    publicKey: `ssh-ed25519 ${bytesToBase64(publicBlob)}${comment ? ` ${comment}` : ''}`,
    privateKey: wrapPem(bytesToBase64(keyFile), 'OPENSSH PRIVATE KEY', 70, true),
  };
}

export async function generateSSHKeyPair(
  options: { type?: SSHKeyType; bits?: number; comment?: string } = {},
): Promise<{ publicKey: string; privateKey: string }> {
  const { type = 'ed25519', bits = DEFAULT_RSA_BITS } = options;
  const comment = cleanComment(options.comment ?? '');
  if (type === 'ed25519') return generateEd25519SSHKeyPair(comment);
  if (type === 'rsa') return generateRSASSHKeyPair(bits, comment);
  throw new RangeError('Unsupported SSH key type');
}
