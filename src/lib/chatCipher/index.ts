import { decryptWithSurplus, encrypt as aesEncrypt } from '../aesGcm';
import { restoreFixedHeader, stripFixedHeader } from '../passwordEnvelope';
import { dropRetiredModels, loadCoverCodec, rankCoverLangs, reloadCoverCodec, type CoverLang } from './coverTable';
import type { ChatCipherProgress } from './progress';

export type { ChatCipherPhase, ChatCipherProgress, ChatCipherProgressInfo } from './progress';
export type { ChatCipherErrorKey } from './errors';
export type { CoverLang } from './coverTable';
export {
  COVER_LANGS,
  COVER_TABLES,
  COVER_TABLE_SHA256,
  COVER_TABLE_URL,
  isCoverLang,
  preferredCoverLang,
} from './coverTable';
export { chatCipherErrorKey, chatCipherErrorRetryable } from './errors';
export { dropRetiredModels, reloadCoverCodec };

/** Readies the table so the first click is instant. A failure resurfaces on that click. */
export async function warmCoverTable(lang: CoverLang = 'cs'): Promise<void> {
  await loadCoverCodec(lang).catch(() => {});
}

export async function encryptToChat(
  text: string,
  password: string,
  onProgress?: ChatCipherProgress,
  lang: CoverLang = 'cs',
): Promise<string> {
  const codec = await loadCoverCodec(lang);
  onProgress?.('seal');
  const sealed = await aesEncrypt(text, password);
  onProgress?.('cover');
  return codec.encode(stripFixedHeader(sealed), undefined, (done, total) => onProgress?.('cover', { done, total }));
}

export async function decryptFromChat(
  cover: string,
  password: string,
  onProgress?: ChatCipherProgress,
  lang: CoverLang = 'cs',
): Promise<string> {
  try {
    const codec = await loadCoverCodec(lang);
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

const WRONG_PASSWORD = /Wrong password/;
const MAX_PASSWORD_TRIES = 3;

/** Opens a cover without knowing its language: `first` is tried first, then the other tables that spell the text best. */
export async function decryptFromChatAuto(
  cover: string,
  password: string,
  onProgress?: ChatCipherProgress,
  first: CoverLang = 'cs',
): Promise<{ text: string; lang: CoverLang }> {
  const tried = new Set<CoverLang>();
  let passwordError: unknown = null;
  let otherError: unknown = null;
  let passwordTries = 0;
  const attempt = async (lang: CoverLang) => {
    tried.add(lang);
    try {
      return { text: await decryptFromChat(cover, password, onProgress, lang), lang };
    } catch (e: unknown) {
      if (e instanceof Error && WRONG_PASSWORD.test(e.message)) {
        passwordError ??= e;
        passwordTries++;
      } else {
        otherError ??= e;
      }
      return null;
    }
  };
  const quick = await loadCoverCodec(first).then(codec => codec.coverage(cover), () => 0);
  if (quick >= 0.95) {
    const opened = await attempt(first);
    if (opened) return opened;
  }
  for (const lang of await rankCoverLangs(cover, first)) {
    if (tried.has(lang)) continue;
    if (passwordTries >= MAX_PASSWORD_TRIES) break;
    const opened = await attempt(lang);
    if (opened) return opened;
  }
  if (!tried.size) {
    const opened = await attempt(first);
    if (opened) return opened;
  }
  throw passwordError ?? otherError ?? new Error('Cover text does not match the word table');
}
