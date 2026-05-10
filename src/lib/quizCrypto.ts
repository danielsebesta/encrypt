/**
 * E2E Quiz Encryption
 *
 * Trust model:
 * - PartyKit server is a dumb relay; sees only ciphertext + connection metadata.
 * - Host is the scoring authority and trusted by participants.
 * - Player joins by entering PIN, then performs ECDH handshake with host through
 *   the relay. Host delivers the room passphrase encrypted with the shared secret.
 * - All subsequent room traffic is AES-GCM encrypted with the room passphrase.
 */

import { encryptMessage, decryptMessage, generateRoomKey, importRoomKey } from './chatCrypto';

export type ECDHKeypair = CryptoKeyPair;

/** Generate an ephemeral P-256 ECDH keypair for a single handshake. */
export async function generateEphemeralKeypair(): Promise<ECDHKeypair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey'],
  );
}

/** Export a public key as base64url for transmission over the relay. */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return arrayToB64url(new Uint8Array(raw));
}

/** Import a peer's exported public key. */
export async function importPublicKey(b64: string): Promise<CryptoKey> {
  const raw = b64urlToArray(b64);
  return crypto.subtle.importKey(
    'raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, [],
  );
}

/** Derive a shared AES-GCM key from a local private key + peer public key. */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublicKey },
    privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Compute a short fingerprint for visual MITM verification.
 * SHA-256 of (host_pub || player_pub) sorted, returned as 6-char hex.
 */
export async function fingerprint(pubA: string, pubB: string): Promise<string> {
  const sorted = [pubA, pubB].sort().join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sorted));
  const bytes = new Uint8Array(digest);
  return Array.from(bytes.slice(0, 3), b => b.toString(16).padStart(2, '0')).join('-').toUpperCase();
}

export { encryptMessage, decryptMessage, generateRoomKey, importRoomKey };

function arrayToB64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToArray(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
