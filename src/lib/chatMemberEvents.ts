export const MEMBER_LEAVE_GRACE_MS = 2 * 60 * 1000;

export const MEMBER_JOIN_SUPPRESS_MS = MEMBER_LEAVE_GRACE_MS + 1000;

export function memberEventBucket(at: number, grace = MEMBER_LEAVE_GRACE_MS): number {
  return Math.floor(at / grace);
}

export async function memberEventId(
  roomId: string,
  kind: 'joined' | 'left' | 'renamed',
  subject: string,
  at = Date.now(),
  grace = MEMBER_LEAVE_GRACE_MS,
): Promise<string> {
  const bytes = new TextEncoder().encode(`${roomId}:${kind}:${subject}:${memberEventBucket(at, grace)}`);
  const dig = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(dig).slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function shouldSuppressJoin(lastJoinedAt: number, now = Date.now(), windowMs = MEMBER_JOIN_SUPPRESS_MS): boolean {
  return lastJoinedAt > 0 && now - lastJoinedAt < windowMs;
}

export function isDuplicateMemberNotice(
  existing: { kind?: string; subject?: string; time: number },
  kind: string,
  subject: string,
  at: number,
  grace = MEMBER_LEAVE_GRACE_MS,
): boolean {
  if (!subject || existing.kind !== kind || existing.subject !== subject) return false;
  return memberEventBucket(existing.time, grace) === memberEventBucket(at, grace);
}

export type MemberNotice = { kind: string; who: string };

export function stillAnnounced(notices: MemberNotice[], signer: string, name: string): boolean {
  for (let i = notices.length - 1; i >= 0; i--) {
    const { kind, who } = notices[i];
    if (kind === 'joined' && who === signer) return true;
    if (kind === 'left' && who === name) return false;
  }
  return false;
}
