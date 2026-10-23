export async function roomCredentials(password: string, name: string, scope: 'chat' | 'whiteboard') {
  const enc = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000,
    salt: enc.encode(`encrypt.click:access-v2:${scope}:${name}`) }, material, 256));
  const token = hex(bytes);
  return { token, channel: await accessChannel(token) };
}

function hex(bytes: Uint8Array) { return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join(''); }

export async function accessChannel(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`room-access-v2:${token}`))));
}

export function safeColor(value: unknown): string {
  return typeof value === 'string' && /^(#[0-9a-fA-F]{3,8}|(?:hsl|rgb|oklch)\([\d.,% /-]+\))$/.test(value)
    ? value : 'hsl(160, 65%, 55%)';
}

// Oldest entries are evicted instead of refusing everything once full; by then chat messages are past their age limit anyway.
export class ReplayWindow {
  private seen = new Set<string>();
  constructor(private capacity = 50_000) {}
  accept(value: string) {
    if (this.seen.has(value)) return false;
    if (this.seen.size >= this.capacity) this.seen.delete(this.seen.values().next().value!);
    this.seen.add(value);
    return true;
  }
}
