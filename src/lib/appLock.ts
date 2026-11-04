import { createPasskey, lastPasskeyError, unlockVault, vaultState, type VaultState } from './roomVault';

const STORAGE_KEY = 'encrypt-app-lock';
const VAULT_MARK = 'vault';
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

/** 'vault' = the room-vault passkey is the lock; otherwise a standalone passkey id; null = off. */
export function storedLock(): string | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === VAULT_MARK || (value && ID_RE.test(value)) ? value : null;
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

export type EnableResult = { ok: true } | { ok: false; detail: string };

const describe = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 120) : 'unknown');

/**
 * Turns the lock on. When the browser supports the passkey PRF extension, the room vault's passkey is the lock, so one
 * biometric check opens the app and unseals saved room secrets. Otherwise a standalone passkey acts as a screen lock only.
 * Pass the vault state read earlier: the passkey prompt must start right inside the tap, and iOS drops that permission
 * if storage is read first.
 */
export async function enableLock(displayName: string, known: VaultState | null = null): Promise<EnableResult> {
  let detail = '';
  try {
    const state = known ?? (await vaultState());
    if (state === 'new') {
      const created = await createPasskey(displayName);
      if (created === 'ok') {
        localStorage.setItem(STORAGE_KEY, VAULT_MARK);
        return { ok: true };
      }
      if (created === 'cancelled' || created === 'failed') return { ok: false, detail: lastPasskeyError() || created };
    } else if (state === 'locked' || state === 'unlocked') {
      if (await unlockVault()) {
        localStorage.setItem(STORAGE_KEY, VAULT_MARK);
        return { ok: true };
      }
      return { ok: false, detail: 'vault' };
    }
  } catch (error) {
    detail = describe(error);
  }
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
    if (!credential) return { ok: false, detail: detail || 'no credential' };
    localStorage.setItem(STORAGE_KEY, toBase64Url(new Uint8Array(credential.rawId)));
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: describe(error) };
  }
}

export async function unlock(): Promise<boolean> {
  const id = storedLock();
  if (!id) return true;
  if (id === VAULT_MARK) {
    try {
      const state = await vaultState();
      if (state === 'new' || state === 'names') {
        clearLock();
        return true;
      }
    } catch {}
    return unlockVault();
  }
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

/** Always asks the device again, even when the vault key is already in memory. Used before the lock is turned off. */
export async function confirmPresence(): Promise<boolean> {
  if (storedLock() !== VAULT_MARK) return unlock();
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: location.hostname,
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
