import { encrypt as aesEncrypt, decrypt as aesDecrypt } from '../aesGcm';
import { assertOffline, clearPack, ensurePack, getPackStatus, type PackStatus } from './cache';
import { createCzechCodec } from './csTable';
import {
  PACK_ORDER,
  PACKS,
  isPackId,
  packList,
  packTotalBytes,
  type ChatLanguage,
  type PackId,
  type PackManifest,
} from './packs';
import type { ChatCipherProgress } from './progress';

export type { ChatLanguage, PackId, PackManifest, PackStatus, ChatCipherProgress };
export type { ChatCipherPhase } from './progress';
export type { ChatCipherErrorKey } from './errors';
export { PACKS, PACK_ORDER, packList, packTotalBytes, isPackId, ensurePack, getPackStatus };
export { chatCipherErrorKey, chatCipherErrorRetryable } from './errors';

export type { AcceleratorProbe, LmRuntimeInfo } from './lm';

/** Probe WebGPU before encrypt; returns null offline / if the LM module fails to import. */
export async function probeAccelerator() {
  const { probeAccelerator: probe } = await import('./lm');
  return probe();
}

/** Device used by a loaded pack session, or null before the first run. */
export async function getLmRuntime(lang: ChatLanguage) {
  const { getLmRuntime: runtime } = await import('./lm');
  return runtime(lang);
}

/** Clear cached pack files and any loaded ONNX session for this language. */
export async function resetLanguagePack(lang: ChatLanguage): Promise<void> {
  await clearPack(lang);
  if (PACKS[lang].engine === 'onnx') {
    const { dropLmSession } = await import('./lm');
    dropLmSession(lang);
  }
}

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
  return session.encodeCover(sealed, (done, total, preview) =>
    onProgress?.('cover', { done, total, preview }),
  );
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
  try {
    return await aesDecrypt(sealed, password);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (/Wrong password|OperationError|authentication|integrity/i.test(message) || (e instanceof Error && e.name === 'OperationError')) {
      throw new Error('Wrong password', { cause: e });
    }
    throw e;
  }
}
