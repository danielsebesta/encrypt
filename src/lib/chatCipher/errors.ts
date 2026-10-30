/** Map technical failures to stable Chat cipher locale keys. */

export type ChatCipherErrorKey =
  | 'tools.chatCipher.errorGeneric'
  | 'tools.chatCipher.errorBoth'
  | 'tools.chatCipher.errorTable'
  | 'tools.chatCipher.errorTableChecksum'
  | 'tools.chatCipher.errorPassword'
  | 'tools.chatCipher.errorCoverMismatch'
  | 'tools.chatCipher.errorCoverCorrupt'
  | 'tools.chatCipher.errorTooLong';

const RULES: Array<{ key: ChatCipherErrorKey; test: (message: string, name: string) => boolean }> = [
  {
    key: 'tools.chatCipher.errorCoverMismatch',
    test: (m) => /does not match the word table/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorCoverCorrupt',
    test: (m) =>
      /Truncated cover|Truncated encrypted|Extra cover|No cover tokens|Invalid cover/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorTooLong',
    test: (m) => /Message too large|Cover text would be too long|Input too large/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorTableChecksum',
    test: (m) => /checksum mismatch|Invalid word table/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorTable',
    test: (m) => /Could not download the word table|Failed to fetch|NetworkError|Load failed/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorPassword',
    test: (m, name) =>
      name === 'OperationError' ||
      /OperationError|AES-GCM|decrypt|authentication|integrity|wrong password/i.test(m),
  },
];

export function chatCipherErrorKey(error: unknown): ChatCipherErrorKey {
  const err = error instanceof Error ? error : null;
  const message = err?.message?.trim() || String(error ?? '');
  const name = err?.name ?? '';
  for (const rule of RULES) {
    if (rule.test(message, name)) return rule.key;
  }
  return 'tools.chatCipher.errorGeneric';
}

/** True when fetching the word table again might help. */
export function chatCipherErrorRetryable(key: ChatCipherErrorKey): boolean {
  return key === 'tools.chatCipher.errorTable' || key === 'tools.chatCipher.errorTableChecksum';
}
