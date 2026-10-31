import { parseAlias } from './alias';
import { signPayload, verifyPayload, type SigningIdentity } from './chatCrypto';
import { padPayload, validPad } from './padding';
import { openBoardMessage, sealBoardMessage } from './whiteboardCrypto';
import type { TrustTable } from './chatIdentity';

export const WHITEBOARD_KINDS = ['doc', 'doc-part', 'chat', 'cursor', 'verify', 'verify-ack'] as const;
export type WhiteboardKind = typeof WHITEBOARD_KINDS[number];

// Everything on a live board is relayed and never stored, so nothing legitimate is older than this.
export const LIVE_MAX_AGE_MS = 60_000;
// A saved board replays its document updates from storage; only those may be older, and Yjs ignores a replayed one it already has.
export const STORED_KINDS: readonly WhiteboardKind[] = ['doc', 'doc-part'];
export const FUTURE_SKEW_MS = 30_000;
const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const ALIAS_KINDS = new Set<string>(['cursor', 'verify', 'verify-ack']);

export function stampEnvelope(kind: WhiteboardKind, body: Record<string, unknown>, room: string, now = Date.now()): Record<string, unknown> {
  return { ...body, _kind: kind, _room: room, _sentAt: now, _id: crypto.randomUUID() };
}

/** The stamp binds a payload to this room, to the kind the relay saw it under and, unless it was stored, to the last minute. */
export function validEnvelope(value: unknown, kind: unknown, room: string, now = Date.now(), stored = false): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (typeof kind !== 'string' || !(WHITEBOARD_KINDS as readonly string[]).includes(kind) || v._kind !== kind) return false;
  if (!room || v._room !== room || typeof v._id !== 'string' || !ID_RE.test(v._id)) return false;
  if (typeof v._sentAt !== 'number' || !Number.isFinite(v._sentAt)) return false;
  const aged = now - v._sentAt > LIVE_MAX_AGE_MS && !(stored && STORED_KINDS.includes(kind as WhiteboardKind));
  if (v._sentAt > now + FUTURE_SKEW_MS || aged || !validPad(v._pad)) return false;
  if (ALIAS_KINDS.has(kind) && !parseAlias(v.alias)) return false;
  if ((kind === 'doc' || kind === 'doc-part') && typeof v.data !== 'string') return false;
  if (kind === 'chat' && (!v.item || typeof v.item !== 'object')) return false;
  return true;
}

/** Stamp and pad, then sign with the member's board key, then encrypt under a fresh subkey of the room key. */
export async function sealEnvelope(key: CryptoKey, identity: SigningIdentity, kind: WhiteboardKind, body: Record<string, unknown>, room: string): Promise<string> {
  return sealBoardMessage(key, await signPayload(identity, padPayload(JSON.stringify(stampEnvelope(kind, body, room)))));
}

export type OpenedEnvelope = { body: Record<string, unknown>; signer: string };

/** Null for anything that fails to decrypt, carries a bad stamp or lacks a valid signature. */
export async function openEnvelope(key: CryptoKey, payload: string, kind: unknown, room: string, now = Date.now(), stored = false): Promise<OpenedEnvelope | null> {
  let body: unknown;
  try {
    body = JSON.parse(await openBoardMessage(key, payload));
  } catch {
    return null;
  }
  if (!validEnvelope(body, kind, room, now, stored)) return null;
  const signer = await verifyPayload(body);
  return signer ? { body, signer } : null;
}

/** Board chat items outlive their envelope inside the shared document, so each one carries its author's own signature. */
export async function signBoardItem<T extends Record<string, unknown>>(identity: SigningIdentity, item: T, room: string): Promise<T & { _pk: string; _sig: string }> {
  const signed = JSON.parse(await signPayload(identity, JSON.stringify({ ...item, _room: room })));
  delete signed._room;
  return signed;
}

export async function verifyBoardItem(item: unknown, room: string): Promise<string | null> {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const signer = await verifyPayload({ ...item, _room: room });
  return signer && signer === (item as Record<string, unknown>)._pk ? signer : null;
}

/** A relay connection id belongs to the first key that signs from it. */
export class ConnectionKeys {
  private keys = new Map<string, string>();

  bind(id: unknown, signer: string): boolean {
    if (typeof id !== 'string' || !id) return false;
    const bound = this.keys.get(id);
    if (bound) return bound === signer;
    this.keys.set(id, signer);
    return true;
  }

  get(id: string): string | undefined {
    return this.keys.get(id);
  }
}

// Folds case, accents, spacing and the usual l/I/1, o/0 swaps so a near-identical name cannot borrow someone's trust.
export function lookalike(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ\s._-]/g, '').toLowerCase()
    .replace(/[i1|]/g, 'l').replace(/0/g, 'o').replace(/5/g, 's').replace(/rn/g, 'm');
}

export type BoardMember = { pk: string; key: string; name: string; trusted: boolean };
type Self = { pk: string; key: string; name: string };

/** The first key a label shows up with is trusted on sight; later keys, and new labels that look like a trusted name, stay flagged until accepted. */
export class BoardTrust {
  readonly members = new Map<string, BoardMember>();

  constructor(private table: TrustTable, private self: Self, private save: (table: TrustTable) => void = () => {}, private onChange: () => void = () => {}) {
    if (!table[self.key]?.includes(self.pk)) {
      table[self.key] = [...(table[self.key] || []), self.pk];
      save(table);
    }
  }

  note(pk: string, key: string, name: string): boolean {
    if (pk === this.self.pk) return true;
    if (!this.table[key]?.length) {
      const folded = lookalike(name);
      const clash = [...this.members.values()].some((m) => m.trusted && m.pk !== pk && m.key !== key && lookalike(m.name) === folded)
        || (key !== this.self.key && lookalike(this.self.name) === folded);
      if (clash) return this.record(pk, key, name, false);
      this.table[key] = [pk];
      this.save(this.table);
    }
    return this.record(pk, key, name, this.table[key].includes(pk));
  }

  accept(pk: string): boolean {
    const member = this.members.get(pk);
    if (!member) return false;
    if (!this.table[member.key]?.includes(pk)) this.table[member.key] = [...(this.table[member.key] || []), pk];
    this.save(this.table);
    member.trusted = true;
    this.onChange();
    return true;
  }

  private record(pk: string, key: string, name: string, trusted: boolean): boolean {
    const member = this.members.get(pk);
    if (!member) {
      this.members.set(pk, { pk, key, name, trusted });
      this.onChange();
    } else if (member.trusted !== trusted || member.key !== key || member.name !== name) {
      Object.assign(member, { key, name, trusted });
      this.onChange();
    }
    return trusted;
  }
}
