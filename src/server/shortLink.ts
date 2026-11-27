import { parseShareFragment } from '../lib/shareLink';
import { roundTime } from '../lib/timelock';

const MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function shortLinkTtl(fragment: string, now = Date.now()): number | null {
  const link = parseShareFragment(fragment);
  if (!link) return null;
  const nowSeconds = Math.floor(now / 1000);
  if (link.expires !== undefined) return link.expires > nowSeconds ? link.expires - nowSeconds : null;
  const opens = link.lock ? Math.max(nowSeconds, Math.ceil(roundTime(link.lock.round) / 1000)) : nowSeconds;
  return opens - nowSeconds + MESSAGE_TTL_SECONDS;
}
