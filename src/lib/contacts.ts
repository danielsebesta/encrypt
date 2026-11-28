import { arrayToB64url, b64urlToArray } from './chatCrypto';
import { deleteIdbDatabase } from './idbDelete';
import { cleanName, contactId, fingerprint, parseCard, sameKeys, type Card } from './identity';
import { openPassword, sealPassword, PASSWORD_ENVELOPE_MAGIC } from './passwordEnvelope';

const DB_NAME = 'encrypt.click:contacts';
const STORE = 'contacts';
const EXPORT_TYPE = 'encrypt.click/contacts';
export const MAX_CONTACTS = 500;

type StoredContact = { id: string; card: Uint8Array; name: string; addedAt: number; verified: boolean };

export type Contact = { id: string; card: Card; name: string; addedAt: number; verified: boolean; fingerprint: string };

export type AddResult =
  | { status: 'added'; contact: Contact }
  | { status: 'exists'; contact: Contact }
  | { status: 'name-taken'; existing: Contact }
  | { status: 'full' };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
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

export function sameName(a: string, b: string): boolean {
  return a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;
}

export function compareContacts(a: Pick<Contact, 'name' | 'addedAt'>, b: Pick<Contact, 'name' | 'addedAt'>): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.addedAt - b.addedAt;
}

async function toContact(value: unknown): Promise<Contact | null> {
  if (!value || typeof value !== 'object') return null;
  const { id, card, name, addedAt, verified } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !(card instanceof Uint8Array) || typeof name !== 'string') return null;
  if (!Number.isSafeInteger(addedAt) || typeof verified !== 'boolean') return null;
  const parsed = await parseCard(card);
  if (!parsed || (await contactId(parsed)) !== id) return null;
  return { id, card: parsed, name: cleanName(name) || parsed.name, addedAt: addedAt as number, verified, fingerprint: await fingerprint(parsed) };
}

const stored = (contact: Contact): StoredContact => ({
  id: contact.id, card: contact.card.bytes, name: contact.name, addedAt: contact.addedAt, verified: contact.verified,
});

export async function listContacts(): Promise<Contact[]> {
  if (!(await databaseExists())) return [];
  try {
    const all = await withStore('readonly', (s) => s.getAll());
    const contacts = await Promise.all(all.map(toContact));
    return contacts.filter((c): c is Contact => c !== null).sort(compareContacts);
  } catch {
    return [];
  }
}

export async function getContact(id: string): Promise<Contact | null> {
  if (!(await databaseExists())) return null;
  try {
    return await toContact(await withStore('readonly', (s) => s.get(id)));
  } catch {
    return null;
  }
}

export async function findContact(card: Pick<Card, 'signPub' | 'kemPub'>): Promise<Contact | null> {
  return getContact(await contactId(card));
}

/**
 * Never replaces a stored key: the same keys report `exists`, and a new key under a name already in the list is held
 * back as `name-taken` until the user saves it under another name or with `allowSameName`.
 */
export async function addContact(card: Card, name = card.name, options: { verified?: boolean; allowSameName?: boolean } = {}): Promise<AddResult> {
  const id = await contactId(card);
  const existing = await getContact(id);
  if (existing) return { status: 'exists', contact: existing };
  const all = await listContacts();
  if (all.length >= MAX_CONTACTS) return { status: 'full' };
  const label = cleanName(name) || card.name;
  const clash = all.find((c) => sameName(c.name, label) && !sameKeys(c.card, card));
  if (clash && !options.allowSameName) return { status: 'name-taken', existing: clash };
  const contact: Contact = { id, card, name: label, addedAt: Date.now(), verified: Boolean(options.verified), fingerprint: await fingerprint(card) };
  await withStore('readwrite', (s) => s.put(stored(contact)));
  try {
    void navigator.storage?.persist?.().catch(() => {});
  } catch {}
  return { status: 'added', contact };
}

export async function updateContact(contact: Contact, change: { name?: string; verified?: boolean }): Promise<Contact> {
  const next: Contact = {
    ...contact,
    name: change.name === undefined ? contact.name : cleanName(change.name) || contact.card.name,
    verified: change.verified ?? contact.verified,
  };
  await withStore('readwrite', (s) => s.put(stored(next)));
  return next;
}

export async function deleteContact(contact: Pick<Contact, 'id'>): Promise<void> {
  await withStore('readwrite', (s) => s.delete(contact.id));
}

export async function forgetContacts(): Promise<void> {
  await deleteIdbDatabase(DB_NAME);
}

type ExportedContact = { card: string; name: string; addedAt: number; verified: boolean };

export function encodeContacts(contacts: Contact[]): Uint8Array {
  const list: ExportedContact[] = contacts.map((c) => ({ card: arrayToB64url(c.card.bytes), name: c.name, addedAt: c.addedAt, verified: c.verified }));
  return new TextEncoder().encode(JSON.stringify({ type: EXPORT_TYPE, v: 1, contacts: list }));
}

export async function decodeContacts(payload: Uint8Array): Promise<Contact[] | null> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { type, v, contacts } = value as Record<string, unknown>;
  if (type !== EXPORT_TYPE || v !== 1 || !Array.isArray(contacts) || contacts.length > MAX_CONTACTS) return null;
  const out: Contact[] = [];
  for (const entry of contacts) {
    if (!entry || typeof entry !== 'object') continue;
    const { card, name, addedAt, verified } = entry as Record<string, unknown>;
    if (typeof card !== 'string' || !/^[A-Za-z0-9_-]+$/.test(card) || card.length > 2048) continue;
    let parsed: Card | null = null;
    try {
      parsed = await parseCard(b64urlToArray(card));
    } catch {}
    if (!parsed) continue;
    out.push({
      id: await contactId(parsed),
      card: parsed,
      name: (typeof name === 'string' ? cleanName(name) : '') || parsed.name,
      addedAt: Number.isSafeInteger(addedAt) && (addedAt as number) > 0 ? (addedAt as number) : Date.now(),
      verified: verified === true,
      fingerprint: await fingerprint(parsed),
    });
  }
  return out;
}

export function looksLikeContactsFile(file: Uint8Array): boolean {
  return file.length >= PASSWORD_ENVELOPE_MAGIC.length && PASSWORD_ENVELOPE_MAGIC.every((byte, i) => file[i] === byte);
}

export async function exportContacts(password: string): Promise<Uint8Array> {
  return sealPassword(encodeContacts(await listContacts()), password);
}

export type ImportResult = { added: number; skipped: number } | null;

/** Keeps every contact already stored; imported keys only ever add entries, same names included. */
export async function importContacts(file: Uint8Array, password: string): Promise<ImportResult> {
  if (!looksLikeContactsFile(file)) return null;
  let payload: Uint8Array;
  try {
    payload = await openPassword(file, password);
  } catch {
    return null;
  }
  const contacts = await decodeContacts(payload);
  if (!contacts) return null;
  const known = new Set((await listContacts()).map((c) => c.id));
  const fresh: Contact[] = [];
  for (const contact of contacts) {
    if (known.has(contact.id) || known.size >= MAX_CONTACTS) continue;
    known.add(contact.id);
    fresh.push(contact);
  }
  if (fresh.length) {
    const db = await openDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        for (const contact of fresh) store.add(stored(contact));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }
  return { added: fresh.length, skipped: contacts.length - fresh.length };
}
