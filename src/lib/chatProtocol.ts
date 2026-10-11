const LIVE_TYPES = new Set(['typing', 'verify', 'verify-ack', 'chat-sync', 'call-signal', 'whiteboard-invite']);
const LIVE_MAX_AGE_MS = 60_000;
const MESSAGE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function stampPayload(text: string, room: string): string {
  const value = JSON.parse(text);
  return JSON.stringify({ ...value, _room: room, _sentAt: Date.now(), _id: crypto.randomUUID() });
}

export function validPayload(value: any, room: string, history = false): boolean {
  if (!value || typeof value !== 'object' || value._room !== room || typeof value._id !== 'string' ||
    value._id.length > 64 || typeof value._sentAt !== 'number' || !Number.isFinite(value._sentAt)) return false;
  const now = Date.now();
  if (value._sentAt > now + 30000) return false;
  if (LIVE_TYPES.has(value.type) && (history || now - value._sentAt > LIVE_MAX_AGE_MS)) return false;
  if (!LIVE_TYPES.has(value.type) && !history && now - value._sentAt > MESSAGE_MAX_AGE_MS) return false;
  if (typeof value.text !== 'undefined' && (typeof value.text !== 'string' || value.text.length > 200000)) return false;
  if (typeof value.sender !== 'undefined' && (typeof value.sender !== 'string' || value.sender.length > 128)) return false;
  if (value.ttl !== undefined && (!Number.isFinite(value.ttl) || value.ttl < 0 || value.ttl > 86400)) return false;
  if (value.file && (!Array.isArray(value.file.urls) || value.file.urls.length > 8 || value.file.urls.some((u: unknown) => typeof u !== 'string' || u.length > 4096))) return false;
  return true;
}
