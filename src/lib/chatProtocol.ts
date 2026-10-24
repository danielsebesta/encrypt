import { NICKNAME_RE } from './alias';
import { validPad } from './padding';
import { validCounter, validHead, validPrevHash } from './chatIntegrity';

const LIVE_TYPES = new Set(['typing', 'verify', 'verify-ack', 'chat-sync', 'call-signal', 'whiteboard-invite', 'rename', 'presence', 'fs-key']);
const LIVE_MAX_AGE_MS = 60_000;
const MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const B64URL_RE = /^[A-Za-z0-9_-]+$/;
const KEY_HASH_RE = /^[A-Za-z0-9_-]{43}$/;
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CONTENT_TYPES = new Set(['chat-message', 'whiteboard-invite']);

const b64url = (value: unknown, max: number, exact = false) =>
  typeof value === 'string' && B64URL_RE.test(value) && (exact ? value.length === max : value.length <= max);

export function isContent(value: any): boolean {
  return CONTENT_TYPES.has(value?.type);
}

/** In rooms with forward secrecy, content that arrives over the relay counts only when it came out of its sender's chain. */
export function relayedContentOk(value: any, forwardSecrecy: boolean, fromChain: boolean): boolean {
  return !forwardSecrecy || fromChain || !isContent(value);
}

export function stampPayload(text: string, room: string): string {
  const value = JSON.parse(text);
  return JSON.stringify({ ...value, _room: room, _sentAt: Date.now(), _id: crypto.randomUUID() });
}

function validKeyFields(value: any): boolean {
  if (value.fs !== undefined && !b64url(value.fs, 87, true)) return false;
  if (value.pq !== undefined && !b64url(value.pq, 1750, true)) return false;
  if (value._pqk !== undefined && !(typeof value._pqk === 'string' && KEY_HASH_RE.test(value._pqk))) return false;
  if (value.clientId !== undefined && !(typeof value.clientId === 'string' && CLIENT_ID_RE.test(value.clientId))) return false;
  if (value.to !== undefined && !(typeof value.to === 'string' && CLIENT_ID_RE.test(value.to))) return false;
  if (value.k !== undefined && !b64url(value.k, 16, true)) return false;
  if (value.n !== undefined && !(Number.isInteger(value.n) && value.n >= 0 && value.n < 2 ** 31)) return false;
  if (value.c !== undefined && !b64url(value.c, 720_000)) return false;
  if (value.keys !== undefined && !(Array.isArray(value.keys) && value.keys.length <= 64)) return false;
  if (value.want !== undefined && !(Array.isArray(value.want) && value.want.length <= 64 && value.want.every((pk: unknown) => typeof pk === 'string' && KEY_HASH_RE.test(pk)))) return false;
  if (value.head !== undefined && !validHead(value.head)) return false;
  if (value._n !== undefined && !validCounter(value._n)) return false;
  if (value._ph !== undefined && !validPrevHash(value._ph)) return false;
  if ((value._n === undefined) !== (value._ph === undefined)) return false;
  return true;
}

export function validPayload(value: any, room: string, history = false): boolean {
  if (!value || typeof value !== 'object' || value._room !== room || typeof value._id !== 'string' ||
    value._id.length > 64 || typeof value._sentAt !== 'number' || !Number.isFinite(value._sentAt)) return false;
  const now = Date.now();
  if (value._sentAt > now + 30000 || !validPad(value._pad)) return false;
  if (LIVE_TYPES.has(value.type) && (history || now - value._sentAt > LIVE_MAX_AGE_MS)) return false;
  if (!LIVE_TYPES.has(value.type) && !history && now - value._sentAt > MESSAGE_MAX_AGE_MS) return false;
  if (typeof value.text !== 'undefined' && (typeof value.text !== 'string' || value.text.length > 200000)) return false;
  if (typeof value.sender !== 'undefined' && (typeof value.sender !== 'string' || value.sender.length > 128)) return false;
  if (value.alias !== undefined && !(Array.isArray(value.alias) && value.alias.length === 3 && value.alias.every((n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) < 360))) return false;
  if (value.nick !== undefined && !(typeof value.nick === 'string' && NICKNAME_RE.test(value.nick))) return false;
  if (value.fromNick !== undefined && !(typeof value.fromNick === 'string' && NICKNAME_RE.test(value.fromNick))) return false;
  if (value.prev !== undefined && (typeof value.prev !== 'string' || value.prev.length > 64)) return false;
  if (value.ttl !== undefined && (!Number.isFinite(value.ttl) || value.ttl < 0 || value.ttl > 86400)) return false;
  if (value.file && (!Array.isArray(value.file.urls) || value.file.urls.length > 8 || value.file.urls.some((u: unknown) => typeof u !== 'string' || u.length > 4096))) return false;
  if (value.file && !b64url(value.file.key, 43, true)) return false;
  return validKeyFields(value);
}
