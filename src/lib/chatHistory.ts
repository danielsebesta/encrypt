const LEGACY = 'encrypt.click:chat-history:v2:';
const ARCHIVE = 'encrypt.click:chat-history:legacy:';

// Preserve ciphertext but remove the fast password fingerprints from all legacy keys.
export function archiveLegacyHistory(storage: Storage) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(LEGACY)));
  for (const key of keys) {
    const room = key.slice(LEGACY.length, key.lastIndexOf(':'));
    const value = storage.getItem(key);
    if (value !== null) storage.setItem(`${ARCHIVE}${room}:${crypto.randomUUID()}`, value);
    storage.removeItem(key);
  }
}

export async function migrateRoomHistory(storage: Storage, room: string, destination: string, reencrypt: (cipher: string) => Promise<string>, limit: number) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => Boolean(key?.startsWith(`${ARCHIVE}${room}:`)));
  for (const key of keys) {
    const items = JSON.parse(storage.getItem(key) || '[]');
    if (!Array.isArray(items)) continue;
    const migrated = [], remaining = [];
    for (const item of items.slice(-limit)) {
      try { migrated.push({ ...item, payload: await reencrypt(item.payload) }); } catch { remaining.push(item); }
    }
    if (migrated.length) {
      const existing = JSON.parse(storage.getItem(destination) || '[]');
      storage.setItem(destination, JSON.stringify([...existing, ...migrated].slice(-limit)));
      if (remaining.length) storage.setItem(key, JSON.stringify(remaining));
      else storage.removeItem(key);
    }
  }
}
