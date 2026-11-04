import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_VOICE_SECONDS, VOICE_BARS, formatClock, pickVoiceType, placeholderPeaks, validVoiceDuration, voiceFileName, voicePeaks, voiceTypeOf } from '../src/lib/voiceMessage';
import { stampPayload, validPayload } from '../src/lib/chatProtocol';

test('recording prefers Opus in WebM and falls back to what the browser supports', () => {
  assert.equal(pickVoiceType(() => true), 'audio/webm;codecs=opus');
  assert.equal(pickVoiceType((type) => type.startsWith('audio/mp4')), 'audio/mp4;codecs=mp4a.40.2');
  assert.equal(pickVoiceType(() => false), '');
  assert.equal(pickVoiceType(() => { throw new Error(); }), '');
});

test('voice files are named by format and played back with the matching type', () => {
  const at = new Date('2026-10-31T10:20:30Z');
  assert.equal(voiceFileName('audio/webm;codecs=opus', at), 'voice-2026-10-31_10-20-30.webm');
  assert.equal(voiceFileName('audio/mp4', at), 'voice-2026-10-31_10-20-30.m4a');
  assert.equal(voiceFileName('audio/ogg;codecs=opus', at), 'voice-2026-10-31_10-20-30.ogg');
  assert.equal(voiceTypeOf('voice.m4a'), 'audio/mp4');
  assert.equal(voiceTypeOf('voice.webm'), 'audio/webm');
  assert.equal(voiceTypeOf('strange'), 'audio/webm');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(75.9), '1:15');
  assert.equal(formatClock(MAX_VOICE_SECONDS), '5:00');
});

test('a voice message is a file marked as voice with a duration within the limit', () => {
  const room = 'room';
  const file = { name: 'voice.webm', size: 1000, urls: ['https://example.test/f'], key: 'k'.repeat(43) };
  const check = (extra: Record<string, unknown>) => validPayload(JSON.parse(stampPayload(JSON.stringify({ type: 'chat-message', id: 'v1', file: { ...file, ...extra } }), room)), room);
  assert.equal(check({}), true);
  assert.equal(check({ voice: true, duration: 12.3 }), true);
  assert.equal(check({ voice: true, duration: MAX_VOICE_SECONDS + 5 }), false);
  assert.equal(check({ voice: true }), false);
  assert.equal(check({ voice: 'yes', duration: 3 }), false);
  assert.equal(validVoiceDuration(-1), false);
  assert.equal(validVoiceDuration(Number.NaN), false);
});

test('placeholder waveforms are deterministic, sized to the bar count and bounded', () => {
  const a = placeholderPeaks('msg-1');
  assert.equal(a.length, VOICE_BARS);
  assert.deepEqual(placeholderPeaks('msg-1'), a);
  assert.notDeepEqual(placeholderPeaks('msg-2'), a);
  for (const value of a) assert.ok(value >= 0.1 && value <= 1);
  assert.equal(placeholderPeaks('x', 12).length, 12);
});

test('peak extraction refuses recordings over the decode limit or missing a decoder', async () => {
  const blob = new Blob([new Uint8Array(64)], { type: 'audio/webm' });
  assert.equal(await voicePeaks(blob, 121), null);
  assert.equal(await voicePeaks(blob, 30), null);
});
