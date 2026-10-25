/** Map technical failures to stable Chat cipher locale keys. */

export type ChatCipherErrorKey =
  | 'tools.chatCipher.errorGeneric'
  | 'tools.chatCipher.errorBoth'
  | 'tools.chatCipher.errorNeedPack'
  | 'tools.chatCipher.errorPack'
  | 'tools.chatCipher.errorPackChecksum'
  | 'tools.chatCipher.errorPackCache'
  | 'tools.chatCipher.errorBackend'
  | 'tools.chatCipher.errorModel'
  | 'tools.chatCipher.errorPassword'
  | 'tools.chatCipher.errorCoverMismatch'
  | 'tools.chatCipher.errorCoverCorrupt'
  | 'tools.chatCipher.errorTooLong';

const RULES: Array<{ key: ChatCipherErrorKey; test: (message: string, name: string) => boolean }> = [
  {
    key: 'tools.chatCipher.errorBackend',
    test: (m) =>
      /no available backend|ort-wasm|onnxruntime|webgpu|wasmPaths|Failed to fetch dynamically imported module|backend found/i.test(
        m,
      ),
  },
  {
    key: 'tools.chatCipher.errorModel',
    test: (m) =>
      /local_files_only|from_pretrained|ONNX|tokenizer|model vocabulary|Pack is not an ONNX|Missing the following inputs|model execution/i.test(
        m,
      ),
  },
  {
    key: 'tools.chatCipher.errorCoverMismatch',
    test: (m) => /does not match this language pack/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorCoverCorrupt',
    test: (m) =>
      /Truncated cover|Extra cover|No cover tokens|Invalid cover|No words|Unknown word/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorTooLong',
    test: (m) => /Message too large|Cover text would be too long|Input too large/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorPackChecksum',
    test: (m) => /checksum mismatch/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorPackCache',
    test: (m) => /Cache API unavailable/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorNeedPack',
    test: (m) => /Download the language pack/i.test(m),
  },
  {
    key: 'tools.chatCipher.errorPack',
    test: (m) => /Could not download language pack|language pack/i.test(m),
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

/** True when clearing the pack cache / redownload might help. */
export function chatCipherErrorRetryable(key: ChatCipherErrorKey): boolean {
  return (
    key === 'tools.chatCipher.errorBackend' ||
    key === 'tools.chatCipher.errorModel' ||
    key === 'tools.chatCipher.errorPack' ||
    key === 'tools.chatCipher.errorPackChecksum' ||
    key === 'tools.chatCipher.errorPackCache'
  );
}
