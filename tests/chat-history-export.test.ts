import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_HISTORY_FORMAT,
  CHAT_HISTORY_VERSION,
  buildChatHistoryExport,
  chatHistoryExportJson,
  chatHistoryFileName,
} from '../src/lib/chatHistoryExport';

test('export lists decrypted text and authors with ISO timestamps', () => {
  const at = new Date('2026-10-31T12:00:00.000Z');
  const doc = buildChatHistoryExport('living-room', [
    { id: 'a', time: Date.parse('2026-10-31T11:00:00.000Z'), sender: 'Ada', text: 'hello' },
    { id: 'b', time: Date.parse('2026-10-31T11:01:00.000Z'), sender: 'Bob', text: 'hi' },
  ], at);
  assert.equal(doc.format, CHAT_HISTORY_FORMAT);
  assert.equal(doc.v, CHAT_HISTORY_VERSION);
  assert.equal(doc.exportedAt, '2026-10-31T12:00:00.000Z');
  assert.equal(doc.roomId, 'living-room');
  assert.deepEqual(doc.messages, [
    { id: 'a', time: '2026-10-31T11:00:00.000Z', author: 'Ada', text: 'hello' },
    { id: 'b', time: '2026-10-31T11:01:00.000Z', author: 'Bob', text: 'hi' },
  ]);
});

test('file and voice attachments are noted without keys or URLs', () => {
  const doc = buildChatHistoryExport('r', [
    {
      id: 'f',
      time: 0,
      sender: 'Ada',
      text: '',
      file: { name: 'notes.pdf' },
    },
    {
      id: 'v',
      time: 1000,
      sender: 'Bob',
      text: '',
      file: { name: 'voice.webm', voice: true, duration: 12.5 },
    },
  ], new Date(0));
  assert.deepEqual(doc.messages[0], {
    id: 'f',
    time: '1970-01-01T00:00:00.000Z',
    author: 'Ada',
    text: '',
    attachment: 'file',
    fileName: 'notes.pdf',
  });
  assert.deepEqual(doc.messages[1], {
    id: 'v',
    time: '1970-01-01T00:00:01.000Z',
    author: 'Bob',
    text: '',
    attachment: 'voice',
    fileName: 'voice.webm',
    duration: 12.5,
  });
  const raw = chatHistoryExportJson(doc);
  assert.equal(raw.includes('key'), false);
  assert.equal(raw.includes('urls'), false);
  assert.match(raw, /"attachment": "voice"/);
});

test('export file names stay filesystem-safe', () => {
  assert.equal(chatHistoryFileName('living-room', new Date('2026-10-31T12:00:00Z')), 'chat-living-room-2026-10-31.json');
  assert.equal(chatHistoryFileName('../../odd name!', new Date('2026-01-02T00:00:00Z')), 'chat-oddname-2026-01-02.json');
  assert.equal(chatHistoryFileName('!!!', new Date('2026-01-02T00:00:00Z')), 'chat-room-2026-01-02.json');
});
