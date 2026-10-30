import { encrypt as aesEncrypt, decrypt as aesDecrypt, decryptWithSurplus } from '../aesGcm';
import { restoreFixedHeader, stripFixedHeader } from '../passwordEnvelope';
import { assertOffline, clearPack, dropRetiredPacks, ensurePack, getPackStatus, type PackStatus } from './cache';
import { dropCoverCodec, loadCoverCodec } from './coverTable';
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
export { PACKS, PACK_ORDER, packList, packTotalBytes, isPackId, ensurePack, getPackStatus, dropRetiredPacks };
export { chatCipherErrorKey, chatCipherErrorRetryable } from './errors';

export type { AcceleratorProbe, LmRuntimeInfo } from './lm';

/** Probe WebGPU before encrypt; returns null offline / if the LM module fails to import. */
export async function probeAccelerator() {
  const { probeAccelerator: probe } = await import('./lm');
  return probe();
}

/** Device used by a loaded pack session, or null before the first run or for a pack without a model. */
export async function getLmRuntime(lang: ChatLanguage) {
  if (PACKS[lang].engine !== 'onnx') return null;
  const { getLmRuntime: runtime } = await import('./lm');
  return runtime(lang);
}

/** Readies what needs no permission to fetch, so the first click is instant. A failure resurfaces on that click. */
export async function warmLanguagePack(lang: ChatLanguage): Promise<void> {
  if (PACKS[lang].engine !== 'table') return;
  await loadCoverCodec().catch(() => {});
}

/** Clear cached pack files and any loaded ONNX session for this language. */
export async function resetLanguagePack(lang: ChatLanguage): Promise<void> {
  await clearPack(lang);
  if (PACKS[lang].engine === 'onnx') {
    const { dropLmSession } = await import('./lm');
    dropLmSession(lang);
  } else {
    dropCoverCodec();
  }
}

export async function encryptToChat(
  text: string,
  password: string,
  lang: ChatLanguage,
  onProgress?: ChatCipherProgress,
): Promise<string> {
  await assertOffline(lang);
  if (PACKS[lang].engine === 'table') {
    const codec = await loadCoverCodec();
    onProgress?.('seal');
    const sealed = await aesEncrypt(text, password);
    onProgress?.('cover');
    return codec.encode(stripFixedHeader(sealed), undefined, (done, total) => onProgress?.('cover', { done, total }));
  }
  onProgress?.('seal');
  const sealed = await aesEncrypt(text, password);
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
  try {
    if (PACKS[lang].engine === 'table') {
      const codec = await loadCoverCodec();
      onProgress?.('cover');
      const body = await codec.decode(cover, (done, total) => onProgress?.('cover', { done, total }));
      onProgress?.('open');
      return await decryptWithSurplus(restoreFixedHeader(body), password);
    }
    const { openLmSession } = await import('./lm');
    const session = await openLmSession(lang, onProgress);
    const sealed = await session.decodeCover(cover, (done, total) => onProgress?.('cover', { done, total }));
    onProgress?.('open');
    return await aesDecrypt(sealed, password);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    if (/Wrong password|OperationError|authentication|integrity/i.test(message) || (e instanceof Error && e.name === 'OperationError')) {
      throw new Error('Wrong password', { cause: e });
    }
    throw e;
  }
}
