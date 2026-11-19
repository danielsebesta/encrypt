export const SYNC_BACKUP_SLOTS = 2;
export const SYNC_BACKUP_STEP_MS = 1500;

export function syncAnswerDelay(
  myId: string,
  newcomer: string,
  memberIds: readonly string[],
  hasContent: boolean,
): number | null {
  if (!hasContent) return null;
  if (!myId) return 0;
  let rank = 0;
  for (const id of memberIds) {
    if (id !== newcomer && id !== myId && id < myId) rank++;
  }
  return rank > SYNC_BACKUP_SLOTS ? null : rank * SYNC_BACKUP_STEP_MS;
}
