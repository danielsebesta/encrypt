/** Byte / speed / ETA helpers for upload and download progress UI. */

export type TransferSnapshot = {
  loaded: number;
  total: number;
  speed: number;
  online: boolean;
};

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  const n = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (n < 1000) return `${Math.round(n)} B`;
  let value = n;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const text = value.toFixed(digits).replace(/\.?0+$/, '');
  return `${text} ${UNITS[unit]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds === Infinity) return '—';
  const s = Math.ceil(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function transferRatio(snap: TransferSnapshot | null | undefined): number | null {
  if (!snap || !(snap.total > 0)) return null;
  return Math.min(1, Math.max(0, snap.loaded / snap.total));
}

/** Builds the secondary status line from locale templates. */
export function formatTransferLine(
  dict: Record<string, string>,
  t: (dict: Record<string, string>, key: string) => string,
  snap: TransferSnapshot,
): string {
  const online = t(dict, snap.online ? 'common.transfer.online' : 'common.transfer.offline');
  if (!(snap.total > 0)) {
    return t(dict, 'common.transfer.indeterminate')
      .replace('{loaded}', formatBytes(snap.loaded))
      .replace('{speed}', formatSpeed(snap.speed))
      .replace('{online}', online);
  }
  const remain = Math.max(0, snap.total - snap.loaded);
  const eta = snap.speed > 0 ? remain / snap.speed : Infinity;
  return t(dict, 'common.transfer.stats')
    .replace('{loaded}', formatBytes(snap.loaded))
    .replace('{total}', formatBytes(snap.total))
    .replace('{speed}', formatSpeed(snap.speed))
    .replace('{eta}', formatEta(eta))
    .replace('{online}', online);
}

/**
 * Rolling throughput over recent samples. Call `report` from XHR / stream progress;
 * `online` tracks `navigator.onLine` when available.
 */
export class TransferMeter {
  private samples: { at: number; loaded: number }[] = [];
  private online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  private unsub: (() => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;
    const sync = () => { this.online = navigator.onLine !== false; };
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    this.unsub = () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }

  dispose() {
    this.unsub?.();
    this.unsub = null;
  }

  reset() {
    this.samples = [];
  }

  report(loaded: number, total: number): TransferSnapshot {
    const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const safeLoaded = Math.max(0, loaded);
    this.samples.push({ at, loaded: safeLoaded });
    // Keep roughly the last two seconds of samples for a stable speed reading.
    const cutoff = at - 2000;
    while (this.samples.length > 2 && this.samples[0].at < cutoff) this.samples.shift();
    let speed = 0;
    if (this.samples.length >= 2) {
      const first = this.samples[0];
      const last = this.samples[this.samples.length - 1];
      const dt = (last.at - first.at) / 1000;
      if (dt > 0.05) speed = Math.max(0, (last.loaded - first.loaded) / dt);
    }
    return {
      loaded: safeLoaded,
      total: Math.max(0, total),
      speed,
      online: this.online,
    };
  }
}

/** Runs up to `concurrency` async tasks from a work queue. */
export async function mapPool<T>(
  count: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(0, count)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= count) return;
      results[i] = await worker(i);
    }
  });
  await Promise.all(runners);
  return results;
}
