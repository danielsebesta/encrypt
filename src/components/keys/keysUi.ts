import { checkRoomPassword } from '../../lib/chatRoomSettings';
import { t } from '../../lib/t';

export function strongPassword(value: string): boolean {
  const checks = checkRoomPassword(value, '');
  return checks.length && checks.variety && checks.strength;
}

const ERRORS: Record<string, string> = {
  cancelled: 'keys.error.cancelled',
  'no-prf': 'keys.error.noPrf',
  'wrong-passkey': 'keys.error.wrongPasskey',
  'wrong-password': 'keys.error.wrongPassword',
  none: 'keys.error.noKey',
};

export function keyErrorText(dict: Record<string, string>, code: string): string {
  return t(dict, ERRORS[code] ?? 'keys.error.failed');
}

export function saveBytes(bytes: Uint8Array, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
