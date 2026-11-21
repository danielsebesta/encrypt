import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  claimVoiceMediaSession,
  releaseVoiceMediaSession,
  updateVoiceMediaSession,
  voiceMediaSessionOwner,
} from '../src/lib/voiceMediaSession';

test('voice media session is claimed by one owner and released only by that owner', () => {
  const actions: string[] = [];
  const handlers = new Map<string, () => void>();
  const fake = {
    metadata: null as MediaMetadata | null,
    playbackState: 'none' as MediaSessionPlaybackState,
    setActionHandler(action: string, handler: (() => void) | null) {
      actions.push(handler ? `set:${action}` : `clear:${action}`);
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    },
    setPositionState() {},
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { mediaSession: fake },
    configurable: true,
  });
  (globalThis as { MediaMetadata?: new (init: unknown) => unknown }).MediaMetadata = class {
    constructor(public init: unknown) {}
  };

  const a = Symbol('a');
  const b = Symbol('b');
  let playCount = 0;
  claimVoiceMediaSession(a, 'Voice message', {
    play: () => { playCount += 1; },
    pause: () => {},
    seekTo: () => {},
    seekBy: () => {},
    stop: () => {},
  });
  assert.equal(voiceMediaSessionOwner(), a);
  assert.ok(actions.includes('set:play'));
  handlers.get('play')?.();
  assert.equal(playCount, 1);

  claimVoiceMediaSession(b, 'Other', {
    play: () => { playCount += 10; },
    pause: () => {},
    seekTo: () => {},
    seekBy: () => {},
    stop: () => {},
  });
  assert.equal(voiceMediaSessionOwner(), b);
  releaseVoiceMediaSession(a);
  assert.equal(voiceMediaSessionOwner(), b);
  updateVoiceMediaSession(b, true, 3, 12);
  assert.equal(fake.playbackState, 'playing');
  releaseVoiceMediaSession(b);
  assert.equal(voiceMediaSessionOwner(), null);
  assert.equal(fake.playbackState, 'none');
  assert.ok(actions.includes('clear:play'));
});
