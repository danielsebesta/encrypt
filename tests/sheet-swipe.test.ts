import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_PX, CLOSE_VELOCITY } from '../src/lib/sheetSwipe';

describe('sheet swipe dismiss', () => {
  it('keeps an easy close threshold for a pull from anywhere on the panel', () => {
    assert.ok(CLOSE_PX <= 48, 'short pull should be enough to close');
    assert.ok(CLOSE_VELOCITY <= 0.35, 'a light flick should close');
  });
});
