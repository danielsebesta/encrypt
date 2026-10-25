import { encrypt as aesEncrypt, decrypt as aesDecrypt } from '../aesGcm';
import { assertOffline, ensurePack, getPackStatus, type PackStatus } from './cache';
import { createCzechCodec } from './csTable';
import { PACKS, packTotalBytes, type ChatLanguage } from './packs';
import type { ChatCipherProgress } from './progress';

export type { ChatLanguage, PackStatus, ChatCipherProgress };
export type { ChatCipherPhase } from './progress';
export { PACKS, packTotalBytes, ensurePack, getPackStatus };

/** Legacy table codec (tests / offline fixtures). Live CS uses neural Kecal via ONNX. */
export { createCzechCodec };

export async function encryptToChat(
  text: string,
  password: string,
  lang: ChatLanguage,
  onProgress?: ChatCipherProgress,
): Promise<string> {
  await assertOffline(lang);
  onProgress?.('seal');
  const sealed = await aesEncrypt(text, password);
  if (PACKS[lang].engine === 'table') {
    onProgress?.('cover', { done: 1, total: 1 });
    return createCzechCodec().encode(sealed);
  }
  const { openLmSession } = await import('./lm');
  const session = await openLmSession(lang, onProgress);
  return session.encodeCover(sealed, (done, total) => onProgress?.('cover', { done, total }));
}

export async function decryptFromChat(
  cover: string,
  password: string,
  lang: ChatLanguage,
  onProgress?: ChatCipherProgress,
): Promise<string> {
  await assertOffline(lang);
  let sealed: Uint8Array;
  if (PACKS[lang].engine === 'table') {
    onProgress?.('cover', { done: 1, total: 1 });
    sealed = createCzechCodec().decode(cover);
  } else {
    const { openLmSession } = await import('./lm');
    const session = await openLmSession(lang, onProgress);
    sealed = await session.decodeCover(cover, (done, total) => onProgress?.('cover', { done, total }));
  }
  onProgress?.('open');
  return aesDecrypt(sealed, password);
}
