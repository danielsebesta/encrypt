import { createChatCodec } from '../chatWords';
import table from '../chatTable.json';
import { PASSWORD_ENVELOPE_MAGIC } from '../passwordEnvelope';
import type { ChatTable } from '../chatWords';

/** Czech cover codec: bundled chat language pack (same project as Kecal; runs offline with no download). */
export function createCzechCodec() {
  return createChatCodec(table as ChatTable, { prefix: PASSWORD_ENVELOPE_MAGIC });
}
