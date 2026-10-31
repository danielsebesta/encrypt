import { hkdfAesKey, hkdfKey } from './kdf';
import { ROOM_KEY_RE, normalizeChatMode } from './chatRoomSettings';

export type RoomKind = 'chat' | 'whiteboard';
export type RoomSecret = { type: 'password' | 'key'; value: string };
export type WrappedSecret = { iv: Uint8Array; ciphertext: Uint8Array };
export type RoomEntry = {
  id: string;
  kind: RoomKind;
  roomId: string;
  mode: string;
  label: string;
  createdAt: number;
  lastSeen: number;
  secret?: WrappedSecret;
};
export type PasskeyRef = { credentialId: Uint8Array; salt: Uint8Array; createdAt: number };
/** names: this browser cannot protect secrets, so only metadata is kept. new: no passkey yet. */
export type VaultState = 'names' | 'new' | 'locked' | 'unlocked';
export type SaveResult = 'saved' | 'saved-name' | 'no-prf' | 'cancelled' | 'failed';

export const VAULT_LABEL = 'encrypt.click/room-vault/v1';
export const PRF_BYTES = 32;
export const LABEL_MAX = 64;
const PASSWORD_MAX = 1024;
const PAD_BLOCK = 128;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const CIPHERTEXT_MAX = 4096;
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WHITEBOARD_MODES = ['live', 'persistent'];

const DB_NAME = 'encrypt.click:room-vault';
const ROOMS = 'rooms';
const META = 'meta';
const PASSKEY = 'passkey';
const NAMES_ONLY = 'names-only';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function entryId(kind: RoomKind, roomId: string): string {
  return `${kind}:${roomId}`;
}

export function validRoomId(value: unknown): value is string {
  return typeof value === 'string' && ROOM_ID_RE.test(value);
}

export function validMode(kind: RoomKind, mode: unknown): mode is string {
  if (typeof mode !== 'string') return false;
  return kind === 'chat' ? normalizeChatMode(mode, true) === mode : WHITEBOARD_MODES.includes(mode);
}

export function validSecret(secret: unknown, mode: string): secret is RoomSecret {
  if (!secret || typeof secret !== 'object') return false;
  const { type, value } = secret as Record<string, unknown>;
  if (typeof value !== 'string') return false;
  if (type === 'key') return mode === 'persistent' && ROOM_KEY_RE.test(value);
  if (type === 'password') return mode !== 'persistent' && value.length > 0 && value.length <= PASSWORD_MAX && value === value.trim();
  return false;
}

export function cleanLabel(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/\s+/g, ' ').trim() : '';
  return [...(text || fallback)].slice(0, LABEL_MAX).join('');
}

const validTime = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function validWrapped(value: unknown): value is WrappedSecret {
  if (!value || typeof value !== 'object') return false;
  const { iv, ciphertext } = value as Record<string, unknown>;
  return iv instanceof Uint8Array && iv.length === IV_BYTES
    && ciphertext instanceof Uint8Array && ciphertext.length > TAG_BYTES && ciphertext.length <= CIPHERTEXT_MAX;
}

/** A stored entry as read back from the database, or null when anything about it is off. */
export function validEntry(value: unknown): RoomEntry | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.kind !== 'chat' && v.kind !== 'whiteboard') return null;
  const kind = v.kind;
  if (!validRoomId(v.roomId) || v.id !== entryId(kind, v.roomId) || !validMode(kind, v.mode)) return null;
  if (typeof v.label !== 'string' || v.label !== cleanLabel(v.label, v.roomId)) return null;
  if (!validTime(v.createdAt) || !validTime(v.lastSeen)) return null;
  if (v.secret !== undefined && !validWrapped(v.secret)) return null;
  const entry: RoomEntry = { id: v.id, kind, roomId: v.roomId, mode: v.mode, label: v.label, createdAt: v.createdAt, lastSeen: v.lastSeen };
  if (v.secret) entry.secret = { iv: (v.secret as WrappedSecret).iv, ciphertext: (v.secret as WrappedSecret).ciphertext };
  return entry;
}

export function buildEntry(
  input: { kind: RoomKind; roomId: string; mode: string; label?: string },
  now: number,
  existing: RoomEntry | null = null,
): RoomEntry | null {
  if (!validRoomId(input.roomId) || !validMode(input.kind, input.mode)) return null;
  return {
    id: entryId(input.kind, input.roomId),
    kind: input.kind,
    roomId: input.roomId,
    mode: input.mode,
    label: cleanLabel(input.label ?? existing?.label, input.roomId),
    createdAt: existing?.createdAt ?? now,
    lastSeen: now,
  };
}

/** The wrapping key: HKDF-SHA256 over the 32-byte PRF output, as a non-extractable AES-256-GCM key. */
export async function deriveVaultKey(prfOutput: Uint8Array): Promise<CryptoKey> {
  if (!(prfOutput instanceof Uint8Array) || prfOutput.length !== PRF_BYTES) throw new Error('Invalid PRF output');
  return hkdfAesKey(await hkdfKey(prfOutput), VAULT_LABEL);
}

// Padding to whole blocks keeps the stored ciphertext from giving away the length of the password.
function encodeSecret(secret: RoomSecret): Uint8Array {
  const json = encoder.encode(JSON.stringify({ t: secret.type, v: secret.value }));
  const out = new Uint8Array(Math.ceil((json.length + 1) / PAD_BLOCK) * PAD_BLOCK).fill(0x20);
  out.set(json);
  return out;
}

export async function wrapSecret(key: CryptoKey, id: string, secret: RoomSecret): Promise<WrappedSecret> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(id) as BufferSource }, key, encodeSecret(secret) as BufferSource);
  return { iv, ciphertext: new Uint8Array(sealed) };
}

export async function unwrapSecret(key: CryptoKey, entry: Pick<RoomEntry, 'id' | 'mode' | 'secret'>): Promise<RoomSecret | null> {
  if (!validWrapped(entry.secret)) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.secret.iv as BufferSource, additionalData: encoder.encode(entry.id) as BufferSource },
      key,
      entry.secret.ciphertext as BufferSource,
    );
    const parsed = JSON.parse(decoder.decode(plain)) as { t?: unknown; v?: unknown };
    const secret = { type: parsed.t, value: parsed.v };
    return validSecret(secret, entry.mode) ? secret : null;
  } catch {
    return null;
  }
}

/** Without a vault key the entry keeps names and times only: a secret is never stored unwrapped. */
export async function sealEntry(entry: RoomEntry, secret: RoomSecret | null, key: CryptoKey | null): Promise<RoomEntry> {
  const plain: RoomEntry = { ...entry };
  delete plain.secret;
  if (!key || !secret || !validSecret(secret, entry.mode)) return plain;
  return { ...plain, secret: await wrapSecret(key, entry.id, secret) };
}

export function vaultStateFor(input: { webauthn: boolean; namesOnly: boolean; ref: PasskeyRef | null; unlocked: boolean }): VaultState {
  if (!input.webauthn || input.namesOnly) return 'names';
  if (!input.ref) return 'new';
  return input.unlocked ? 'unlocked' : 'locked';
}

export function localePrefix(locale: string): string {
  return locale && locale !== 'en' ? `/${locale}` : '';
}

/**
 * Where Open goes and what it hands over. Passwords travel in the session storage slot the room page reads and clears on
 * load, and a chat room key in the slot the room keeps for the tab, so neither shows in the address bar.
 */
export function openTarget(kind: RoomKind, roomId: string, locale: string, secret: RoomSecret | null): { href: string; handoff: [string, string] | null } {
  const path = `${localePrefix(locale)}/${kind}/${encodeURIComponent(roomId)}`;
  if (!secret) return { href: path, handoff: null };
  if (secret.type === 'password') return { href: path, handoff: [kind === 'chat' ? 'chat-password' : 'whiteboard-password', secret.value] };
  if (kind === 'chat') return { href: path, handoff: [`chat-link-key:${roomId}`, secret.value] };
  return { href: `${path}#k=${secret.value}&p=1`, handoff: null };
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];

export function relativeTime(then: number, now: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const found = UNITS.find(([, size]) => seconds >= size);
  return found ? { value: -Math.floor(seconds / found[1]), unit: found[0] } : { value: 0, unit: 'second' };
}

let sessionKey: CryptoKey | null = null;

function webauthnAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof PublicKeyCredential === 'function'
    && typeof navigator.credentials?.create === 'function';
}

async function prfMaybe(): Promise<boolean> {
  if (!webauthnAvailable()) return false;
  const capabilities = (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities;
  if (typeof capabilities !== 'function') return true;
  try {
    return (await capabilities.call(PublicKeyCredential))['extension:prf'] !== false;
  } catch {
    return true;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(ROOMS, { keyPath: 'id' });
      request.result.createObjectStore(META);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('blocked'));
  });
}

async function withStore<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = run(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

// Opening the database creates it, so a browser that never saved a room is only asked whether it exists.
async function vaultExists(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  if (typeof indexedDB.databases !== 'function') return true;
  try {
    return (await indexedDB.databases()).some((db) => db.name === DB_NAME);
  } catch {
    return true;
  }
}

function validRef(value: unknown): PasskeyRef | null {
  if (!value || typeof value !== 'object') return null;
  const { credentialId, salt, createdAt } = value as Record<string, unknown>;
  if (!(credentialId instanceof Uint8Array) || credentialId.length < 16 || credentialId.length > 1023) return null;
  if (!(salt instanceof Uint8Array) || salt.length !== PRF_BYTES || !validTime(createdAt)) return null;
  return { credentialId, salt, createdAt };
}

async function readRef(): Promise<PasskeyRef | null> {
  return validRef(await withStore(META, 'readonly', (s) => s.get(PASSKEY)));
}

export async function vaultState(): Promise<VaultState> {
  let namesOnly = false;
  let ref: PasskeyRef | null = null;
  if (await vaultExists()) {
    try {
      namesOnly = (await withStore(META, 'readonly', (s) => s.get(NAMES_ONLY))) === true;
      ref = await readRef();
    } catch {}
  }
  return vaultStateFor({ webauthn: await prfMaybe(), namesOnly, ref, unlocked: Boolean(sessionKey) });
}

export async function listRooms(): Promise<RoomEntry[]> {
  if (!(await vaultExists())) return [];
  try {
    const all = await withStore(ROOMS, 'readonly', (s) => s.getAll());
    return all.map(validEntry).filter((e): e is RoomEntry => e !== null).sort((a, b) => b.lastSeen - a.lastSeen);
  } catch {
    return [];
  }
}

export async function getRoom(kind: RoomKind, roomId: string): Promise<RoomEntry | null> {
  if (!validRoomId(roomId) || !(await vaultExists())) return null;
  try {
    return validEntry(await withStore(ROOMS, 'readonly', (s) => s.get(entryId(kind, roomId))));
  } catch {
    return null;
  }
}

/** A visit to a saved room moves it up the list; no unlock is needed because the secret is left as it is. */
export async function touchRoom(kind: RoomKind, roomId: string): Promise<RoomEntry | null> {
  const entry = await getRoom(kind, roomId);
  if (!entry) return null;
  const next = { ...entry, lastSeen: Date.now() };
  try { await withStore(ROOMS, 'readwrite', (s) => s.put(next)); } catch {}
  return next;
}

export async function renameRoom(entry: RoomEntry, label: string): Promise<RoomEntry> {
  const next = { ...entry, label: cleanLabel(label, entry.roomId) };
  await withStore(ROOMS, 'readwrite', (s) => s.put(next));
  return next;
}

export async function forgetRoom(entry: RoomEntry): Promise<void> {
  await withStore(ROOMS, 'readwrite', (s) => s.delete(entry.id));
}

/** Removes every entry and the passkey reference. The passkey itself can only be deleted where the device keeps it. */
export async function forgetEverything(): Promise<void> {
  sessionKey = null;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

function prfBytes(results: AuthenticationExtensionsPRFOutputs | undefined): Uint8Array | null {
  const first = results?.results?.first;
  if (!first) return null;
  const view = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array(first.buffer, first.byteOffset, first.byteLength);
  return view.length === PRF_BYTES ? new Uint8Array(view) : null;
}

async function keyFromPrf(bytes: Uint8Array): Promise<CryptoKey> {
  try {
    return await deriveVaultKey(bytes);
  } finally {
    bytes.fill(0);
  }
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'AbortError');
}

async function createPasskey(userName: string): Promise<'ok' | 'no-prf' | 'cancelled' | 'failed'> {
  const salt = random(PRF_BYTES);
  let credential: PublicKeyCredential | null;
  try {
    credential = await navigator.credentials.create({
      publicKey: {
        rp: { id: location.hostname, name: location.hostname },
        user: { id: random(16), name: userName, displayName: userName },
        challenge: random(32),
        pubKeyCredParams: [{ type: 'public-key', alg: -8 }, { type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        attestation: 'none',
        timeout: 120_000,
        extensions: { prf: { eval: { first: salt } } },
      },
    }) as PublicKeyCredential | null;
  } catch (error) {
    return cancelled(error) ? 'cancelled' : 'failed';
  }
  if (!credential) return 'cancelled';
  const prf = credential.getClientExtensionResults().prf;
  const first = prfBytes(prf);
  if (!prf?.enabled && !first) {
    await withStore(META, 'readwrite', (s) => s.put(true, NAMES_ONLY));
    return 'no-prf';
  }
  await withStore(META, 'readwrite', (s) => s.put({ credentialId: new Uint8Array(credential.rawId), salt, createdAt: Date.now() }, PASSKEY));
  if (first) sessionKey = await keyFromPrf(first);
  return 'ok';
}

/** Asks the passkey for its PRF output and keeps the derived key in memory for this page only. */
export async function unlockVault(): Promise<boolean> {
  if (sessionKey) return true;
  const ref = await readRef().catch(() => null);
  if (!ref || !webauthnAvailable()) return false;
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        rpId: location.hostname,
        challenge: random(32),
        allowCredentials: [{ type: 'public-key', id: ref.credentialId as BufferSource }],
        userVerification: 'required',
        timeout: 120_000,
        extensions: { prf: { eval: { first: ref.salt as BufferSource } } },
      },
    }) as PublicKeyCredential | null;
    const first = prfBytes(assertion?.getClientExtensionResults().prf);
    if (!first) return false;
    sessionKey = await keyFromPrf(first);
    return true;
  } catch {
    return false;
  }
}

export async function revealSecret(entry: RoomEntry): Promise<RoomSecret | null> {
  if (!entry.secret || !sessionKey) return null;
  return unwrapSecret(sessionKey, entry);
}

export function canOpen(entry: RoomEntry): boolean {
  return entry.mode !== 'persistent' || Boolean(entry.secret);
}

/** Unlocks if needed and goes to the room. False when a stored secret could not be released, so nothing happens. */
export async function openRoom(entry: RoomEntry, locale: string): Promise<boolean> {
  let secret: RoomSecret | null = null;
  if (entry.secret) {
    if (!(await unlockVault())) return false;
    secret = await revealSecret(entry);
    if (!secret) return false;
  } else if (!canOpen(entry)) {
    return false;
  }
  const target = openTarget(entry.kind, entry.roomId, locale, secret);
  if (target.handoff) {
    try { sessionStorage.setItem(target.handoff[0], target.handoff[1]); } catch {}
  }
  location.assign(target.href);
  return true;
}

/**
 * Stores or updates a room. With withSecret the secret is wrapped under the passkey's key, creating the passkey first if
 * there is none; when this browser cannot do that, only the name is kept.
 */
export async function saveRoom(
  input: { kind: RoomKind; roomId: string; mode: string; label: string },
  secret: RoomSecret | null,
  options: { withSecret: boolean; passkeyName: string },
): Promise<SaveResult> {
  try {
    const existing = await getRoom(input.kind, input.roomId);
    const entry = buildEntry(input, Date.now(), existing);
    if (!entry) return 'failed';
    let result: SaveResult = 'saved-name';
    if (options.withSecret && secret && validSecret(secret, entry.mode)) {
      const state = await vaultState();
      if (state === 'new') {
        const created = await createPasskey(options.passkeyName);
        if (created === 'cancelled' || created === 'failed') return created;
        if (created === 'no-prf') result = 'no-prf';
      }
      if (result !== 'no-prf' && state !== 'names') {
        if (!(await unlockVault())) return 'cancelled';
        result = 'saved';
      }
    }
    const stored = await sealEntry(entry, result === 'saved' ? secret : null, sessionKey);
    await withStore(ROOMS, 'readwrite', (s) => s.put(stored));
    return result;
  } catch {
    return 'failed';
  }
}
