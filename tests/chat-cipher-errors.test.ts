import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatCipherErrorKey, chatCipherErrorRetryable } from '../src/lib/chatCipher/errors';

test('maps ORT / backend failures', () => {
  assert.equal(
    chatCipherErrorKey(new Error('no available backend found. ERR: [wasm] Failed to fetch dynamically imported module')),
    'tools.chatCipher.errorBackend',
  );
  assert.ok(chatCipherErrorRetryable('tools.chatCipher.errorBackend'));
});

test('maps model load failures', () => {
  assert.equal(
    chatCipherErrorKey(new Error('ONNX model failed to load: local_files_only')),
    'tools.chatCipher.errorModel',
  );
});

test('maps password and cover failures', () => {
  assert.equal(chatCipherErrorKey(new Error('Wrong password')), 'tools.chatCipher.errorPassword');
  const op = new Error('The operation failed');
  op.name = 'OperationError';
  assert.equal(chatCipherErrorKey(op), 'tools.chatCipher.errorPassword');
  assert.equal(
    chatCipherErrorKey(new Error('Cover text does not match this language pack')),
    'tools.chatCipher.errorCoverMismatch',
  );
  assert.equal(chatCipherErrorKey(new Error('Truncated cover text')), 'tools.chatCipher.errorCoverCorrupt');
});

test('maps pack download failures', () => {
  assert.equal(chatCipherErrorKey(new Error('Language pack checksum mismatch')), 'tools.chatCipher.errorPackChecksum');
  assert.equal(chatCipherErrorKey(new Error('Cache API unavailable')), 'tools.chatCipher.errorPackCache');
  assert.equal(chatCipherErrorKey(new Error('Could not download language pack (404)')), 'tools.chatCipher.errorPack');
  assert.equal(
    chatCipherErrorKey(new Error('Download the language pack before encrypting or decrypting')),
    'tools.chatCipher.errorNeedPack',
  );
});

test('falls back to generic', () => {
  assert.equal(chatCipherErrorKey(new Error('unexpected boom')), 'tools.chatCipher.errorGeneric');
  assert.equal(chatCipherErrorKey('plain string'), 'tools.chatCipher.errorGeneric');
});
