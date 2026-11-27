export type ChatCipherPhase = 'seal' | 'cover' | 'open';

export type ChatCipherProgressInfo = {
  done?: number;
  total?: number;
};

export type ChatCipherProgress = (phase: ChatCipherPhase, info?: ChatCipherProgressInfo) => void;
