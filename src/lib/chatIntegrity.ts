// History integrity for saved rooms. Every stored payload carries its sender's counter (_n) and the hash of that sender's
// previous stored payload (_ph), both under the signatures. The server cannot sign, so it cannot fill a gap it made,
// put a sender's messages in another order without it showing, or pass off a different history as the same one.

export type ChainIssue = 'gap' | 'reorder' | 'fork' | 'truncated';
export type ChainHead = { n: number; h: string };
export type ChainEntry = ChainHead & { ph: string; seq?: number };

type SenderState = ChainHead & { seq?: number; recent: [number, string][] };
type StoredChains = { mine: ChainHead | null; senders: Record<string, SenderState> };

const HASH_RE = /^[A-Za-z0-9_-]{43}$/;
const SENDER_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_COUNTER = 2 ** 31 - 1;
const RECENT = 32;
const MAX_SENDERS = 256;

export function validCounter(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= MAX_COUNTER;
}

export function validChainHash(value: unknown): value is string {
  return typeof value === 'string' && HASH_RE.test(value);
}

export function validPrevHash(value: unknown): value is string {
  return value === '' || validChainHash(value);
}

export function validHead(value: unknown): value is ChainHead {
  if (!value || typeof value !== 'object') return false;
  const { n, h } = value as Record<string, unknown>;
  return validCounter(n) && validChainHash(h);
}

function readState(value: unknown): SenderState | null {
  if (!validHead(value)) return null;
  const { n, h, seq, recent } = value as SenderState;
  return {
    n,
    h,
    ...(Number.isInteger(seq) ? { seq } : {}),
    recent: Array.isArray(recent) ? recent.filter((item): item is [number, string] => Array.isArray(item) && validCounter(item[0]) && validChainHash(item[1])).slice(-RECENT) : [[n, h]],
  };
}

/** Each sender's chain as far as this browser has seen it. */
export class HistoryChains {
  private senders = new Map<string, SenderState>();

  constructor(saved?: unknown) {
    if (!saved || typeof saved !== 'object') return;
    for (const [sender, value] of Object.entries(saved).slice(-MAX_SENDERS)) {
      const state = readState(value);
      if (state && SENDER_RE.test(sender)) this.senders.set(sender, state);
    }
  }

  head(sender: string): ChainHead | null {
    const state = this.senders.get(sender);
    return state ? { n: state.n, h: state.h } : null;
  }

  /**
   * A gap means counters were skipped, a reorder that the server placed an older payload after a newer one, a fork that
   * two different payloads claim the same place. Relaxed skips the gap check, for the first payload after a stretch the
   * server reports as trimmed.
   */
  observe(sender: string, entry: ChainEntry, relaxed = false): ChainIssue | null {
    const state = this.senders.get(sender);
    if (!state) {
      if (this.senders.size >= MAX_SENDERS) this.senders.delete(this.senders.keys().next().value as string);
      this.senders.set(sender, { n: entry.n, h: entry.h, ...(entry.seq !== undefined ? { seq: entry.seq } : {}), recent: [[entry.n, entry.h]] });
      return null;
    }
    const known = state.recent.find(([n]) => n === entry.n);
    if (known) return known[1] === entry.h ? null : 'fork';
    if (entry.n <= state.n) return entry.seq !== undefined && state.seq !== undefined && entry.seq > state.seq ? 'reorder' : null;
    const issue = entry.n === state.n + 1 ? (entry.ph === state.h ? null : 'fork') : relaxed ? null : 'gap';
    state.n = entry.n;
    state.h = entry.h;
    if (entry.seq !== undefined) state.seq = entry.seq;
    else delete state.seq;
    state.recent = [...state.recent, [entry.n, entry.h] as [number, string]].slice(-RECENT);
    return issue;
  }

  /** A member online announces its latest counter and hash; a head beyond what arrived means the server held some back. */
  announced(sender: string, head: ChainHead): ChainIssue | null {
    const state = this.senders.get(sender);
    if (!state) return null;
    if (head.n > state.n) return 'truncated';
    const known = head.n === state.n ? state.h : state.recent.find(([n]) => n === head.n)?.[1];
    return known === undefined || known === head.h ? null : 'fork';
  }

  toJSON(): Record<string, SenderState> {
    return Object.fromEntries(this.senders);
  }
}

function readStored(raw: string | null): StoredChains {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      mine: validHead(parsed?.mine) ? { n: parsed.mine.n, h: parsed.mine.h } : null,
      senders: new HistoryChains(parsed?.senders).toJSON(),
    };
  } catch {
    return { mine: null, senders: {} };
  }
}

export function loadChainState(storage: Storage, key: string): StoredChains {
  try {
    return readStored(storage.getItem(key));
  } catch {
    return { mine: null, senders: {} };
  }
}

/** Merges with what another tab may have written meanwhile: per sender, and for this browser's own chain, the longer one wins. */
export function saveChainState(storage: Storage, key: string, mine: ChainHead | null, chains: HistoryChains) {
  try {
    const stored = readStored(storage.getItem(key));
    const senders = { ...stored.senders };
    for (const [sender, state] of Object.entries(chains.toJSON())) {
      if (!senders[sender] || senders[sender].n <= state.n) senders[sender] = state;
    }
    const best = !stored.mine || (mine && mine.n >= stored.mine.n) ? mine : stored.mine;
    storage.setItem(key, JSON.stringify({ mine: best, senders }));
  } catch {}
}

export function forgetChainState(storage: Storage, key: string) {
  try { storage.removeItem(key); } catch {}
}
