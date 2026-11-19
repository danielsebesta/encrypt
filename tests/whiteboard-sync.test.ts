import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_BACKUP_SLOTS, SYNC_BACKUP_STEP_MS, syncAnswerDelay } from '../src/lib/whiteboardSyncElection';

test('lowest id with content answers immediately', () => {
  assert.equal(syncAnswerDelay('a', 'z', ['a', 'b', 'c', 'z'], true), 0);
});

test('an empty member never answers', () => {
  assert.equal(syncAnswerDelay('a', 'z', ['a', 'b', 'z'], false), null);
  const ids = ['a', 'b', 'c', 'z'];
  assert.ok(ids.filter(id => id !== 'z').every(id => syncAnswerDelay(id, 'z', ids, false) === null));
});

test('a member with content answers after a delay when an empty lower id exists', () => {
  assert.equal(syncAnswerDelay('b', 'z', ['a', 'b', 'z'], true), SYNC_BACKUP_STEP_MS);
  assert.equal(syncAnswerDelay('c', 'z', ['a', 'b', 'c', 'z'], true), 2 * SYNC_BACKUP_STEP_MS);
});

test('the newcomer is not counted when ranking', () => {
  assert.equal(syncAnswerDelay('b', 'a', ['a', 'b'], true), 0);
});

test('a single member answers at once', () => {
  assert.equal(syncAnswerDelay('a', 'z', ['a', 'z'], true), 0);
  assert.equal(syncAnswerDelay('a', 'z', [], true), 0);
});

test('backup responders are bounded', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'z'];
  const answering = ids.filter(id => id !== 'z' && syncAnswerDelay(id, 'z', ids, true) !== null);
  assert.equal(answering.length, SYNC_BACKUP_SLOTS + 1);
});

test('an unknown own id answers immediately', () => {
  assert.equal(syncAnswerDelay('', 'z', ['a'], true), 0);
});
