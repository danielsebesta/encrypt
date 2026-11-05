import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CLOSE_PX, CLOSE_VELOCITY, GRAB_PX } from '../src/lib/sheetSwipe';

describe('sheet swipe dismiss', () => {
  it('keeps a tall grab strip and an easy close threshold', () => {
    assert.ok(GRAB_PX >= 120, 'grab zone should cover the handle and title');
    assert.ok(CLOSE_PX <= 48, 'short pull should be enough to close');
    assert.ok(CLOSE_VELOCITY <= 0.35, 'a light flick should close');
  });
});
