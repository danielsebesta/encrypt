import { parseShareFragment, type ShareLink } from './shareLink';

export const SHARE_DROP_FORMAT = 'encrypt-click-drop';
export const SHARE_DROP_VERSION = 1;
const MAX_CHARS = 2_000_000;

export type ShareDrop = {
  format: typeof SHARE_DROP_FORMAT;
  v: typeof SHARE_DROP_VERSION;
  fragment: string;
};

/** Offline sealed share as a downloadable file (fragment only — password stays with the sender). */
export function encodeShareDrop(fragment: string): string {
  if (!fragment || fragment.length > MAX_CHARS) throw new Error('Invalid fragment');
  if (!parseShareFragment(fragment)) throw new Error('Invalid fragment');
  const drop: ShareDrop = { format: SHARE_DROP_FORMAT, v: SHARE_DROP_VERSION, fragment };
  return JSON.stringify(drop);
}

export function parseShareDrop(text: string): { link: ShareLink; fragment: string } | { error: 'invalid' | 'too-large' } {
  if (text.length > MAX_CHARS) return { error: 'too-large' };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: 'invalid' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'invalid' };
  const { format, v, fragment } = value as Record<string, unknown>;
  if (format !== SHARE_DROP_FORMAT || v !== SHARE_DROP_VERSION || typeof fragment !== 'string') return { error: 'invalid' };
  const link = parseShareFragment(fragment);
  if (!link) return { error: 'invalid' };
  return { link, fragment };
}

export function shareDropFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `encrypt-click-drop-${stamp}.encryptclick.json`;
}
