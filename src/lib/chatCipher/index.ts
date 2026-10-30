import { decryptWithSurplus, encrypt as aesEncrypt } from '../aesGcm';
import { restoreFixedHeader, stripFixedHeader } from '../passwordEnvelope';
import { dropRetiredModels, loadCoverCodec, reloadCoverCodec } from './coverTable';
import type { ChatCipherProgress } from './progress';

export type { ChatCipherPhase, ChatCipherProgress, ChatCipherProgressInfo } from './progress';
export type { ChatCipherErrorKey } from './errors';
export { chatCipherErrorKey, chatCipherErrorRetryable } from './errors';
export { dropRetiredModels, reloadCoverCodec };

/** Readies the table so the first click is instant. A failure resurfaces on that click. */
export async function warmCoverTable(): Promise<void> {
  await loadCoverCodec().catch(() => {});
}

export async function encryptToChat(text: string, password: string, onProgress?: ChatCipherProgress): Promise<string> {
  const codec = await loadCoverCodec();
  onProgress?.('seal');
  const sealed = await aesEncrypt(text, password);
  onProgress?.('cover');
  return codec.encode(stripFixedHeader(sealed), undefined, (done, total) => onProgress?.('cover', { done, total }));
}

export async function decryptFromChat(cover: string, password: string, onProgress?: ChatCipherProgress): Promise<string> {
  try {
    const codec = await loadCoverCodec();
    onProgress?.('cover');
    const body = await codec.decode(cover, (done, total) => onProgress?.('cover', { done, total }));
    onProgress?.('open');
    return await decryptWithSurplus(restoreFixedHeader(body), password);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (/Wrong password|OperationError|authentication|integrity/i.test(message) || (e instanceof Error && e.name === 'OperationError')) {
      throw new Error('Wrong password', { cause: e });
    }
    throw e;
  }
}
