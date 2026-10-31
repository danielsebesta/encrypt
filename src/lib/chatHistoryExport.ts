/** Local, unencrypted export of messages this browser has already decrypted. */

export const CHAT_HISTORY_FORMAT = 'encrypt-click-chat-history';
export const CHAT_HISTORY_VERSION = 1;

export type ChatHistoryAttachment = 'file' | 'voice';

export type ChatHistoryMessageInput = {
  id: string;
  time: number;
  sender: string;
  text: string;
  file?: { name?: string; voice?: true; duration?: number } | null;
};

export type ChatHistoryExportMessage = {
  id: string;
  time: string;
  author: string;
  text: string;
  attachment?: ChatHistoryAttachment;
  fileName?: string;
  duration?: number;
};

export type ChatHistoryExport = {
  format: typeof CHAT_HISTORY_FORMAT;
  v: typeof CHAT_HISTORY_VERSION;
  exportedAt: string;
  roomId: string;
  messages: ChatHistoryExportMessage[];
};

function attachmentOf(file: NonNullable<ChatHistoryMessageInput['file']>): ChatHistoryAttachment {
  return file.voice === true ? 'voice' : 'file';
}

/** Map in-memory decrypted messages to a JSON-safe export; never includes keys or download URLs. */
export function buildChatHistoryExport(
  roomId: string,
  messages: readonly ChatHistoryMessageInput[],
  exportedAt = new Date(),
): ChatHistoryExport {
  return {
    format: CHAT_HISTORY_FORMAT,
    v: CHAT_HISTORY_VERSION,
    exportedAt: exportedAt.toISOString(),
    roomId,
    messages: messages.map((msg) => {
      const entry: ChatHistoryExportMessage = {
        id: msg.id,
        time: new Date(msg.time).toISOString(),
        author: msg.sender,
        text: msg.text || '',
      };
      if (msg.file) {
        entry.attachment = attachmentOf(msg.file);
        if (typeof msg.file.name === 'string' && msg.file.name) entry.fileName = msg.file.name;
        if (msg.file.voice === true && typeof msg.file.duration === 'number') entry.duration = msg.file.duration;
      }
      return entry;
    }),
  };
}

export function chatHistoryExportJson(doc: ChatHistoryExport): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function chatHistoryFileName(roomId: string, at = new Date()): string {
  const safe = roomId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'room';
  const day = at.toISOString().slice(0, 10);
  return `chat-${safe}-${day}.json`;
}
