import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatShareFragment } from '../src/lib/shareLink';
import { encodeShareDrop, parseShareDrop } from '../src/lib/shareDrop';

test('offline drop round-trips a share fragment', () => {
  const fragment = formatShareFragment({ payload: 'abcDEF0123456789_-', burn: true });
  const encoded = encodeShareDrop(fragment);
  const parsed = parseShareDrop(encoded);
  assert.ok(!('error' in parsed));
  assert.equal(parsed.fragment, fragment);
  assert.equal(parsed.link.burn, true);
  assert.equal(parsed.link.payload, 'abcDEF0123456789_-');
});

test('offline drop refuses garbage', () => {
  assert.deepEqual(parseShareDrop('{'), { error: 'invalid' });
  assert.deepEqual(parseShareDrop(JSON.stringify({ format: 'nope', v: 1, fragment: 'x' })), { error: 'invalid' });
});
