import { encrypt as aesEncrypt, decrypt as aesDecrypt } from '../aesGcm';
import { assertOffline, ensurePack, getPackStatus, type PackStatus } from './cache';
import { createCzechCodec } from './csTable';
import { PACKS, packTotalBytes, type ChatLanguage } from './packs';

export type { ChatLanguage, PackStatus };
export { PACKS, packTotalBytes, ensurePack, getPackStatus };

/** Legacy table codec (tests / offline fixtures). Live CS uses neural Kecal via ONNX. */
export { createCzechCodec };

export async function encryptToChat(
  text: string,
  password: string,
  lang: ChatLanguage,
): Promise<string> {
  await assertOffline(lang);
  const sealed = await aesEncrypt(text, password);
  if (PACKS[lang].engine === 'table') return createCzechCodec().encode(sealed);
  const { openLmSession } = await import('./lm');
  return (await openLmSession(lang)).encodeCover(sealed);
}

export async function decryptFromChat(
  cover: string,
  password: string,
  lang: ChatLanguage,
): Promise<string> {
  await assertOffline(lang);
  let sealed: Uint8Array;
  if (PACKS[lang].engine === 'table') {
    sealed = createCzechCodec().decode(cover);
  } else {
    const { openLmSession } = await import('./lm');
    sealed = await (await openLmSession(lang)).decodeCover(cover);
  }
  return aesDecrypt(sealed, password);
}
