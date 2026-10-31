/** Rewrite display labels on messages that share a signing key after a rename. */
export function relabelBySigner<T extends {
  pk?: string;
  sender: string;
  initials: string;
  color: string;
  alias?: unknown;
  nick?: string;
}>(
  messages: T[],
  pk: string,
  who: { name: string; initials: string; color: string; alias?: T['alias']; nick?: string },
): T[] {
  let changed = false;
  const next = messages.map((msg) => {
    if (msg.pk !== pk) return msg;
    if (msg.sender === who.name && msg.initials === who.initials && msg.color === who.color && msg.nick === who.nick) return msg;
    changed = true;
    return { ...msg, sender: who.name, initials: who.initials, color: who.color, alias: who.alias, nick: who.nick };
  });
  return changed ? next : messages;
}
