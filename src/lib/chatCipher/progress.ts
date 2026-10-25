/** Progress steps reported while encrypting or decrypting Chat cipher covers. */

export type ChatCipherPhase = 'seal' | 'loadModel' | 'cover' | 'open';

export type ChatCipherProgress = (
  phase: ChatCipherPhase,
  info?: { done: number; total: number; preview?: string },
) => void;
