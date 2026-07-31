import { ulid } from 'ulid';

export function generateUUID(): string {
  return crypto.randomUUID();
}

export function generateULID(): string {
  return ulid();
}

export function generateToken(length: number = 32, type: 'hex' | 'base64' | 'url-safe' = 'hex'): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  if (type === 'hex') {
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  if (type === 'base64') {
    return btoa(String.fromCharCode(...bytes));
  }
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
