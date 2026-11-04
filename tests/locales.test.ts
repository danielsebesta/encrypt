import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dict = (locale: string) => JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;

const LOCALES = ['cs', 'sk', 'de', 'es', 'fr', 'pl'] as const;

/** Keys that may legitimately match English (brands, loanwords, cognates, technical labels). */
const ALLOW_SAME_AS_EN = new Set([
  'app.filter.live',
  'app.new.kindChat',
  'app.settings.app',
  'app.settings.materialShort',
  'app.settings.system',
  'app.tab.chats',
  'chat.about.2.title',
  'chat.alias.format',
  'chat.onceBlurVoice',
  'chat.onceBlurFile',
  'chat.onceBlurText',
  'chat.callMicrophone',
  'chat.callParticipants',
  'chat.callRelay',
  'chat.callRelayHost',
  'chat.callRelayTransport',
  'chat.serverQualityOffline',
  'chat.voicePause',
  'chat.whiteboardTitle',
  'common.transfer.indeterminate',
  'common.transfer.offline',
  'common.transfer.online',
  'integrity.repoLabel',
  'landing.features.6.title',
  'landing.try.tab.chat',
  'landing.try.tab.whiteboard',
  'nav.chat',
  'nav.menu',
  'nav.whiteboard',
  'chat.inviteCard.link',
  'rooms.kind.chat',
  'rooms.kind.whiteboard',
  'tools.chatCipher.inputText',
  'tools.photoCipher.batchProgress',
  'tools.steganography.batchProgress',
  'tools.timeCapsule.decryptedMessage',
  'tools.timeCapsule.message',
  'tools.timeCapsule.utc',
  'tools.ultimateEncrypt.confirm.decryptPath',
  'tools.ultimateEncrypt.confirm.swissTransfer',
  'tools.ultimateEncrypt.firstPartyUpload',
  'tools.ultimateEncrypt.messageLabel',
  'whiteboard.canvasRole',
  'whiteboard.chat',
  'whiteboard.chatPlaceholder',
  'whiteboard.color',
  'whiteboard.colors.orange',
  'whiteboard.colors.violet',
  'whiteboard.geo.ellipse',
  'whiteboard.geo.rectangle',
  'whiteboard.geo.triangle',
  'whiteboard.roomLink',
  'whiteboard.tool.text',
  'whiteboard.zoom',
]);

function mayMatchEnglish(key: string): boolean {
  if (ALLOW_SAME_AS_EN.has(key)) return true;
  // Language-neutral room aliases intentionally reuse English adj/animal tokens.
  if (key.startsWith('chat.alias.adj.') || key.startsWith('chat.alias.animal.')) return true;
  return false;
}

test('every locale carries exactly the English keys with the same placeholders', () => {
  const en = dict('en');
  for (const locale of LOCALES) {
    const other = dict(locale);
    assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort(), locale);
    for (const [key, value] of Object.entries(en)) {
      const placeholders = (text: string) => (text.match(/\{[a-zA-Z]+\}/g) ?? []).sort();
      assert.deepEqual(placeholders(other[key]), placeholders(value), `${locale} ${key}`);
      assert.ok(other[key].trim().length > 0, `${locale} ${key} is empty`);
    }
  }
});

test('non-English locales do not leave UI strings as English (allowlist for brands/loanwords)', () => {
  const en = dict('en');
  for (const locale of LOCALES) {
    const other = dict(locale);
    const leftovers: string[] = [];
    for (const [key, value] of Object.entries(en)) {
      if (other[key] !== value) continue;
      if (mayMatchEnglish(key)) continue;
      if (value.length <= 3) continue;
      if (!/[A-Za-z]{3,}/.test(value)) continue;
      leftovers.push(key);
    }
    assert.deepEqual(leftovers, [], `${locale} still matches English for: ${leftovers.join(', ')}`);
  }
});
