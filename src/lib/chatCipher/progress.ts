/** Progress steps reported while encrypting or decrypting Chat cipher covers. */

export type ChatCipherPhase = 'seal' | 'loadModel' | 'cover' | 'open';

export type ChatCipherProgressInfo = {
  done?: number;
  total?: number;
  preview?: string;
  /** Which ONNX device is being loaded / was selected. */
  backend?: 'webgpu' | 'wasm';
};

export type ChatCipherProgress = (phase: ChatCipherPhase, info?: ChatCipherProgressInfo) => void;
