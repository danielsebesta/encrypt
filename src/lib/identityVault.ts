import { deleteIdbDatabase } from './idbDelete';
import { cleanName, deriveIdentity, parseCard, sameKeys, SEED_BYTES, type Card, type Identity } from './identity';
import { hkdfBytes, hkdfKey } from './kdf';
import { openPassword, sealPassword, PASSWORD_ENVELOPE_MAGIC } from './passwordEnvelope';

const DB_NAME = 'encrypt.click:identity';
const STORE = 'identity';
const RECORD = 'self';
const PRF_BYTES = 32;
const HANDLE_TAG = new Uint8Array([0x65, 0x63, 0x6b, 0x31]);
const BACKUP_MAGIC = new Uint8Array([0x45, 0x43, 0x49, 0x31]);
const PRF_LABEL = 'encrypt.click/identity/v1';

export type IdentityKind = 'passkey' | 'password';

type PasskeyRecord = { kind: 'passkey'; credentialId: Uint8Array; card: Uint8Array; createdAt: number };
type PasswordRecord = { kind: 'password'; sealed: Uint8Array; card: Uint8Array; createdAt: number };
type PendingRecord = { kind: 'pending'; credentialId: Uint8Array; name: string; createdAt: number };
type StoredRecord = PasskeyRecord | PasswordRecord | PendingRecord;

export type IdentityState =
  | { state: 'none' }
  | { state: 'pending'; name: string }
  | { state: 'ready'; kind: IdentityKind; card: Card };

export type PasskeyResult = 'ok' | 'pending' | 'no-prf' | 'wrong-passkey' | 'cancelled' | 'failed';

const encoder = new TextEncoder();
const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const startsWith = (data: Uint8Array, prefix: Uint8Array) => data.length >= prefix.length && prefix.every((byte, i) => data[i] === byte);

let cached: StoredRecord | null = null;
let cachedLoaded = false;
let saltCache: Uint8Array | null = null;

export async function seedFromPrf(prfOutput: Uint8Array): Promise<Uint8Array> {
  if (prfOutput.length !== PRF_BYTES) throw new Error('Invalid PRF output');
  return hkdfBytes(await hkdfKey(prfOutput), 'encrypt.click/identity/v1/seed', SEED_BYTES);
}

export async function prfSalt(): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(PRF_LABEL)));
}

export function encodeBackup(seed: Uint8Array, name: string): Uint8Array {
  if (seed.length !== SEED_BYTES) throw new Error('Invalid seed');
  const nameBytes = encoder.encode(cleanName(name));
  const out = new Uint8Array(BACKUP_MAGIC.length + SEED_BYTES + 1 + nameBytes.length);
  out.set(BACKUP_MAGIC);
  out.set(seed, BACKUP_MAGIC.length);
  out[BACKUP_MAGIC.length + SEED_BYTES] = nameBytes.length;
  out.set(nameBytes, BACKUP_MAGIC.length + SEED_BYTES + 1);
  return out;
}

export function decodeBackup(payload: Uint8Array): { seed: Uint8Array; name: string } | null {
  const fixed = BACKUP_MAGIC.length + SEED_BYTES + 1;
  if (!startsWith(payload, BACKUP_MAGIC) || payload.length < fixed) return null;
  const nameLength = payload[fixed - 1];
  if (payload.length !== fixed + nameLength) return null;
  try {
    const name = new TextDecoder('utf-8', { fatal: true }).decode(payload.subarray(fixed));
    return { seed: payload.slice(BACKUP_MAGIC.length, BACKUP_MAGIC.length + SEED_BYTES), name: cleanName(name) };
  } catch {
    return null;
  }
}

export function looksLikeBackup(file: Uint8Array): boolean {
  return startsWith(file, PASSWORD_ENVELOPE_MAGIC);
}

export async function sealBackup(seed: Uint8Array, name: string, password: string): Promise<Uint8Array> {
  const payload = encodeBackup(seed, name);
  try {
    return await sealPassword(payload, password);
  } finally {
    payload.fill(0);
  }
}

/** Returns null for a wrong password or a file that is not a key backup. */
export async function openBackup(file: Uint8Array, password: string): Promise<{ seed: Uint8Array; name: string } | null> {
  if (!looksLikeBackup(file)) return null;
  let payload: Uint8Array;
  try {
    payload = await openPassword(file, password);
  } catch {
    return null;
  }
  try {
    return decodeBackup(payload);
  } finally {
    payload.fill(0);
  }
}

export function userHandle(name: string): Uint8Array {
  const nameBytes = encoder.encode(cleanName(name));
  const out = new Uint8Array(HANDLE_TAG.length + 12 + nameBytes.length);
  out.set(HANDLE_TAG);
  out.set(random(12), HANDLE_TAG.length);
  out.set(nameBytes, HANDLE_TAG.length + 12);
  return out;
}

export function nameFromHandle(handle: Uint8Array): string | null {
  if (!startsWith(handle, HANDLE_TAG) || handle.length < HANDLE_TAG.length + 12) return null;
  try {
    return cleanName(new TextDecoder('utf-8', { fatal: true }).decode(handle.subarray(HANDLE_TAG.length + 12)));
  } catch {
    return null;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

async function databaseExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases !== 'function') return true;
  try {
    return (await indexedDB.databases()).some((db) => db.name === DB_NAME);
  } catch {
    return true;
  }
}

const bytes = (value: unknown, min: number, max: number): value is Uint8Array => value instanceof Uint8Array && value.length >= min && value.length <= max;
const time = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;

function validRecord(value: unknown): StoredRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!time(record.createdAt)) return null;
  if (record.kind === 'passkey' && bytes(record.credentialId, 16, 1023) && bytes(record.card, 1, 2048)) {
    return { kind: 'passkey', credentialId: record.credentialId, card: record.card, createdAt: record.createdAt };
  }
  if (record.kind === 'password' && bytes(record.sealed, 1, 4096) && bytes(record.card, 1, 2048)) {
    return { kind: 'password', sealed: record.sealed, card: record.card, createdAt: record.createdAt };
  }
  if (record.kind === 'pending' && bytes(record.credentialId, 16, 1023) && typeof record.name === 'string') {
    return { kind: 'pending', credentialId: record.credentialId, name: cleanName(record.name), createdAt: record.createdAt };
  }
  return null;
}

async function readRecord(): Promise<StoredRecord | null> {
  if (!(await databaseExists())) return null;
  return validRecord(await withStore('readonly', (s) => s.get(RECORD)));
}

async function writeRecord(record: StoredRecord): Promise<void> {
  await withStore('readwrite', (s) => s.put(record, RECORD));
  cached = record;
  cachedLoaded = true;
  requestPersistence();
}

export function requestPersistence(): void {
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {}
}

/** Loads the record ahead of a tap so the passkey prompt is the first await after the user's gesture. */
export async function warmIdentity(): Promise<void> {
  saltCache ??= await prfSalt();
  cached = await readRecord().catch(() => null);
  cachedLoaded = true;
}

async function record(): Promise<StoredRecord | null> {
  if (!cachedLoaded) await warmIdentity();
  return cached;
}

export async function identityState(): Promise<IdentityState> {
  const current = await record();
  if (!current) return { state: 'none' };
  if (current.kind === 'pending') return { state: 'pending', name: current.name };
  const card = await parseCard(current.card);
  if (!card) return { state: 'none' };
  return { state: 'ready', kind: current.kind, card };
}

export function webauthnAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential === 'function'
    && typeof navigator.credentials?.create === 'function' && typeof navigator.credentials?.get === 'function';
}

/** False only when the browser says outright that it cannot do PRF; unknown counts as worth a try. */
export async function passkeyMaybe(): Promise<boolean> {
  if (!webauthnAvailable()) return false;
  const capabilities = (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities;
  if (typeof capabilities !== 'function') return true;
  try {
    return (await capabilities.call(PublicKeyCredential))['extension:prf'] !== false;
  } catch {
    return true;
  }
}

function prfBytes(results: AuthenticationExtensionsPRFOutputs | undefined): Uint8Array | null {
  const first = results?.results?.first;
  if (!first) return null;
  const view = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  return view.length === PRF_BYTES ? new Uint8Array(view) : null;
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

async function identityFromPrf(prf: Uint8Array, name: string): Promise<Identity> {
  const seed = await seedFromPrf(prf);
  prf.fill(0);
  try {
    return await deriveIdentity(seed, name);
  } finally {
    seed.fill(0);
  }
}

type Assertion = { prf: Uint8Array; credentialId: Uint8Array; handle: Uint8Array | null };

async function assertPasskey(credentialId: Uint8Array | null, salt: Uint8Array): Promise<Assertion | 'no-prf' | 'cancelled' | 'failed'> {
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        rpId: location.hostname,
        challenge: random(32),
        ...(credentialId ? { allowCredentials: [{ type: 'public-key' as const, id: credentialId as BufferSource }] } : {}),
        userVerification: 'required',
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt as BufferSource } } },
      },
    }) as PublicKeyCredential | null;
    if (!assertion) return 'cancelled';
    const prf = prfBytes(assertion.getClientExtensionResults().prf);
    if (!prf) return 'no-prf';
    const response = assertion.response as AuthenticatorAssertionResponse;
    return {
      prf,
      credentialId: new Uint8Array(assertion.rawId),
      handle: response.userHandle ? new Uint8Array(response.userHandle) : null,
    };
  } catch (error) {
    return cancelled(error) ? 'cancelled' : 'failed';
  }
}

async function storePasskeyIdentity(credentialId: Uint8Array, prf: Uint8Array, name: string): Promise<void> {
  const identity = await identityFromPrf(prf, name);
  try {
    await writeRecord({ kind: 'passkey', credentialId, card: identity.card.bytes, createdAt: Date.now() });
  } finally {
    identity.kemSecret.fill(0);
  }
}

/** `accountLabel` is what the password manager lists the passkey under. */
export async function createPasskeyIdentity(name: string, accountLabel: string): Promise<PasskeyResult> {
  const clean = cleanName(name);
  const salt = saltCache ?? await prfSalt();
  let credential: PublicKeyCredential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: location.hostname },
        user: { id: userHandle(clean) as BufferSource, name: accountLabel, displayName: accountLabel },
        challenge: random(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt as BufferSource } } },
      },
    }) as PublicKeyCredential | null;
  } catch (error) {
    return cancelled(error) ? 'cancelled' : 'failed';
  }
  if (!credential) return 'cancelled';
  const credentialId = new Uint8Array(credential.rawId);
  const prfResult = credential.getClientExtensionResults().prf;
  const prf = prfBytes(prfResult);
  if (!prfResult?.enabled && !prf) return 'no-prf';
  if (prf) {
    await storePasskeyIdentity(credentialId, prf, clean);
    return 'ok';
  }
  await writeRecord({ kind: 'pending', credentialId, name: clean, createdAt: Date.now() });
  return 'pending';
}

/** Some authenticators only hand out the PRF result on a sign-in, so a fresh passkey may need this second tap. */
export async function finishPasskeyIdentity(): Promise<PasskeyResult> {
  const current = await record();
  if (!current || current.kind !== 'pending') return 'failed';
  const result = await assertPasskey(current.credentialId, saltCache ?? await prfSalt());
  if (typeof result === 'string') return result;
  await storePasskeyIdentity(current.credentialId, result.prf, current.name);
  return 'ok';
}

/** Restores the key from a synced passkey: any of the user's passkeys can be picked, so the handle tag is checked. */
export async function restorePasskeyIdentity(fallbackName: string): Promise<PasskeyResult> {
  const result = await assertPasskey(null, saltCache ?? await prfSalt());
  if (typeof result === 'string') return result;
  const name = result.handle ? nameFromHandle(result.handle) : null;
  if (name === null) {
    result.prf.fill(0);
    return 'wrong-passkey';
  }
  await storePasskeyIdentity(result.credentialId, result.prf, name || fallbackName);
  return 'ok';
}

export async function createPasswordIdentity(name: string, password: string): Promise<Card> {
  const seed = random(SEED_BYTES);
  try {
    const identity = await deriveIdentity(seed, name);
    identity.kemSecret.fill(0);
    const sealed = await sealBackup(seed, identity.card.name, password);
    await writeRecord({ kind: 'password', sealed, card: identity.card.bytes, createdAt: Date.now() });
    return identity.card;
  } finally {
    seed.fill(0);
  }
}

/** Keeps the backup file itself as the stored record, so the same password unlocks it here and exports it later. */
export async function importBackup(file: Uint8Array, password: string): Promise<Card | null> {
  const opened = await openBackup(file, password);
  if (!opened) return null;
  try {
    const identity = await deriveIdentity(opened.seed, opened.name);
    identity.kemSecret.fill(0);
    await writeRecord({ kind: 'password', sealed: file.slice(), card: identity.card.bytes, createdAt: Date.now() });
    return identity.card;
  } finally {
    opened.seed.fill(0);
  }
}

export type UnlockResult = { identity: Identity } | { error: 'none' | 'wrong-password' | 'no-prf' | 'wrong-passkey' | 'cancelled' | 'failed' };

async function unlockSeed(password?: string): Promise<{ seed: Uint8Array; name: string } | { error: Exclude<UnlockResult, { identity: Identity }>['error'] }> {
  const current = cachedLoaded ? cached : await record();
  if (!current || current.kind === 'pending') return { error: 'none' };
  if (current.kind === 'password') {
    if (!password) return { error: 'wrong-password' };
    const opened = await openBackup(current.sealed, password);
    return opened ?? { error: 'wrong-password' };
  }
  const result = await assertPasskey(current.credentialId, saltCache ?? await prfSalt());
  if (typeof result === 'string') return { error: result };
  const seed = await seedFromPrf(result.prf);
  result.prf.fill(0);
  return { seed, name: (await cardOf(current))?.name ?? '' };
}

function cardOf(current: PasskeyRecord | PasswordRecord): Promise<Card | null> {
  return parseCard(current.card);
}

/**
 * Opens the key for one operation. The caller zeroes `identity.kemSecret` when done. A passkey identity must be
 * checked against the stored card, since another passkey of the same site would derive a different key.
 */
export async function unlockIdentity(password?: string): Promise<UnlockResult> {
  const current = cachedLoaded ? cached : await record();
  const opened = await unlockSeed(password);
  if ('error' in opened) return opened;
  try {
    const stored = current && current.kind !== 'pending' ? await cardOf(current) : null;
    const identity = await deriveIdentity(opened.seed, stored?.name ?? opened.name);
    if (stored && !sameKeys(identity.card, stored)) {
      identity.kemSecret.fill(0);
      return { error: 'wrong-passkey' };
    }
    return { identity };
  } finally {
    opened.seed.fill(0);
  }
}

/** For a password identity the stored file already is the backup; a passkey identity is sealed under `password`. */
export async function exportBackup(password?: string): Promise<Uint8Array | { error: Exclude<UnlockResult, { identity: Identity }>['error'] }> {
  const current = cachedLoaded ? cached : await record();
  if (!current || current.kind === 'pending') return { error: 'none' };
  if (current.kind === 'password') return current.sealed.slice();
  if (!password) return { error: 'wrong-password' };
  const opened = await unlockSeed();
  if ('error' in opened) return opened;
  try {
    const stored = await cardOf(current);
    return await sealBackup(opened.seed, stored?.name ?? opened.name, password);
  } finally {
    opened.seed.fill(0);
  }
}

export async function renameStoredIdentity(card: Uint8Array): Promise<void> {
  const current = await record();
  if (!current || current.kind === 'pending') return;
  await writeRecord({ ...current, card });
}

export async function forgetIdentity(): Promise<void> {
  cached = null;
  cachedLoaded = true;
  await deleteIdbDatabase(DB_NAME);
}
