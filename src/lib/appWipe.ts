export const WIPE_LS_PREFIXES: readonly string[] = ['encrypt.click:chat-', 'encrypt.click:alias:', 'encrypt.click:nick:', 'encrypt:joined:'];
export const WIPE_SS_PREFIXES: readonly string[] = ['chat-pw:', 'wb-pw:', 'encrypt-click:once:', 'encrypt.click:chat-'];
export const WIPE_SS_KEYS: readonly string[] = ['chat-password', 'chat-share-password', 'chat-room-config', 'whiteboard-password', 'whiteboard-share-password'];
export const PANIC_FLAG = 'encrypt.click:panic-wipe';

function sweep(storage: Storage, drop: (key: string) => boolean) {
  const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
  for (const key of keys) if (key !== null && drop(key)) storage.removeItem(key);
}

export function wipeRoomStorage(local: Storage, session: Storage) {
  try {
    sweep(local, (key) => WIPE_LS_PREFIXES.some((p) => key.startsWith(p)));
  } catch {}
  try {
    sweep(session, (key) => WIPE_SS_KEYS.includes(key) || WIPE_SS_PREFIXES.some((p) => key.startsWith(p)));
  } catch {}
}
