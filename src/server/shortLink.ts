import { parseShareFragment } from '../lib/shareLink';
import { roundTime } from '../lib/timelock';

const MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long a short link to this share should live, in seconds: until the upload expires, or a week for a message
 * carried in the link itself (a week after it unlocks when time-locked). Null when the share has already expired.
 */
export function shortLinkTtl(fragment: string, now = Date.now()): number | null {
  const link = parseShareFragment(fragment);
  if (!link) return null;
  const nowSeconds = Math.floor(now / 1000);
  if (link.expires !== undefined) return link.expires > nowSeconds ? link.expires - nowSeconds : null;
  const opens = link.lock ? Math.max(nowSeconds, Math.ceil(roundTime(link.lock.round) / 1000)) : nowSeconds;
  return opens - nowSeconds + MESSAGE_TTL_SECONDS;
}
