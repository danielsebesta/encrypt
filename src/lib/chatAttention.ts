const NOTIFY_PREFIX = 'encrypt.click:chat-notify:';

export const NOTIFY_DELAY_MS = 2_000;
export const NOTIFY_GAP_MS = 30_000;

export function titleWithUnread(base: string, unread: number): string {
  if (unread <= 0) return base;
  return `(${unread > 99 ? '99+' : unread}) ${base}`;
}

type PrefStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Only an on/off flag is kept, under the room name the address already shows, never a key or a password. */
export function loadNotifyPref(storage: PrefStorage, room: string): boolean {
  try {
    return storage.getItem(`${NOTIFY_PREFIX}${room}`) === '1';
  } catch {
    return false;
  }
}

export function saveNotifyPref(storage: PrefStorage, room: string, on: boolean) {
  try {
    if (on) storage.setItem(`${NOTIFY_PREFIX}${room}`, '1');
    else storage.removeItem(`${NOTIFY_PREFIX}${room}`);
  } catch {}
}

/**
 * Turns a burst of incoming messages into one notification: the first message waits a moment for the rest, and after a
 * notification the next one waits until a quiet gap has passed.
 */
export class NotificationBurst {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastShown = -Infinity;

  constructor(
    private readonly show: () => void,
    private readonly now: () => number = Date.now,
    private readonly delayMs = NOTIFY_DELAY_MS,
    private readonly gapMs = NOTIFY_GAP_MS,
  ) {}

  note() {
    if (this.timer) return;
    const wait = Math.max(this.delayMs, this.lastShown + this.gapMs - this.now());
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.lastShown = this.now();
      this.show();
    }, wait);
  }

  cancel() {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  reset() {
    this.cancel();
    this.lastShown = -Infinity;
  }
}
