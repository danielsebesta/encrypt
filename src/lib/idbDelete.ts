/** Deletes an IndexedDB database, waiting for success (or a short timeout if blocked). */
export function deleteIdbDatabase(name: string, timeoutMs = 2500): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    request.onsuccess = finish;
    request.onerror = finish;
    // Keep waiting — resolving on blocked races an in-flight write and can reload before the delete lands.
    request.onblocked = () => {};
  });
}
