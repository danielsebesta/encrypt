import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCipherErrorKey, chatCipherErrorRetryable } from '../src/lib/chatCipher/errors';

test('maps password and cover failures', () => {
  assert.equal(chatCipherErrorKey(new Error('Wrong password')), 'tools.chatCipher.errorPassword');
  const op = new Error('The operation failed');
  op.name = 'OperationError';
  assert.equal(chatCipherErrorKey(op), 'tools.chatCipher.errorPassword');
  assert.equal(
    chatCipherErrorKey(new Error('Cover text does not match the word table')),
    'tools.chatCipher.errorCoverMismatch',
  );
  assert.equal(chatCipherErrorKey(new Error('Truncated cover text')), 'tools.chatCipher.errorCoverCorrupt');
});

test('a table that cannot load offers a fresh download', () => {
  for (const message of ['Could not download the word table (503)', 'Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed']) {
    assert.equal(chatCipherErrorKey(new TypeError(message)), 'tools.chatCipher.errorTable', message);
  }
  assert.equal(chatCipherErrorKey(new Error('Word table checksum mismatch')), 'tools.chatCipher.errorTableChecksum');
  assert.equal(chatCipherErrorKey(new Error('Invalid word table')), 'tools.chatCipher.errorTableChecksum');
  assert.ok(chatCipherErrorRetryable('tools.chatCipher.errorTable'));
  assert.ok(chatCipherErrorRetryable('tools.chatCipher.errorTableChecksum'));
  assert.ok(!chatCipherErrorRetryable('tools.chatCipher.errorPassword'));
});

test('falls back to generic', () => {
  assert.equal(chatCipherErrorKey(new Error('unexpected boom')), 'tools.chatCipher.errorGeneric');
  assert.equal(chatCipherErrorKey('plain string'), 'tools.chatCipher.errorGeneric');
});
