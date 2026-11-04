const STORAGE_KEY = 'encrypt-app-lock';
const ID_RE = /^[A-Za-z0-9_-]{16,1024}$/;

/** How long the app may stay in the background before it asks again. */
export const LOCK_AFTER_MS = 30_000;

export function shouldLock(hiddenAt: number, now: number): boolean {
  return hiddenAt > 0 && now - hiddenAt >= LOCK_AFTER_MS;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function storedLockId(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value && ID_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

export async function lockSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.isSecureContext || typeof PublicKeyCredential !== 'function') return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Registers a passkey on this device. It only ever proves "the person holding the unlocked device is here"; nothing is stored on a server. */
export async function enableLock(displayName: string): Promise<boolean> {
  try {
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: displayName, id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: displayName, displayName },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: 60_000,
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'discouraged', userVerification: 'required' },
        attestation: 'none',
      },
    }) as PublicKeyCredential | null;
    if (!credential) return false;
    localStorage.setItem(STORAGE_KEY, toBase64Url(new Uint8Array(credential.rawId)));
    return true;
  } catch {
    return false;
  }
}

export async function unlock(): Promise<boolean> {
  const id = storedLockId();
  if (!id) return true;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: fromBase64Url(id) as BufferSource }],
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return Boolean(assertion);
  } catch {
    return false;
  }
}

export function clearLock() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}
