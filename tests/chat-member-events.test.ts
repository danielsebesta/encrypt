import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MEMBER_JOIN_SUPPRESS_MS,
  MEMBER_LEAVE_GRACE_MS,
  isDuplicateMemberNotice,
  memberEventBucket,
  memberEventId,
  shouldSuppressJoin,
} from '../src/lib/chatMemberEvents';

describe('chat member events', () => {
  it('suppresses join only across the soft-reconnect window', () => {
    const joinedAt = 1_000_000;
    assert.equal(shouldSuppressJoin(joinedAt, joinedAt + 1000), true);
    assert.equal(shouldSuppressJoin(joinedAt, joinedAt + MEMBER_JOIN_SUPPRESS_MS - 1), true);
    assert.equal(shouldSuppressJoin(joinedAt, joinedAt + MEMBER_JOIN_SUPPRESS_MS), false);
    assert.equal(shouldSuppressJoin(0, joinedAt), false);
  });

  it('buckets leave/join notices by grace window', () => {
    const start = MEMBER_LEAVE_GRACE_MS * 10;
    assert.equal(memberEventBucket(start), memberEventBucket(start + MEMBER_LEAVE_GRACE_MS - 1));
    assert.notEqual(memberEventBucket(start), memberEventBucket(start + MEMBER_LEAVE_GRACE_MS));
  });

  it('collapses duplicate leave notices in the same bucket', () => {
    const at = MEMBER_LEAVE_GRACE_MS * 4 + 100;
    assert.equal(isDuplicateMemberNotice({ kind: 'left', subject: 'pk', time: at }, 'left', 'pk', at + 50), true);
    assert.equal(isDuplicateMemberNotice({ kind: 'left', subject: 'pk', time: at }, 'left', 'other', at + 50), false);
    assert.equal(isDuplicateMemberNotice({ kind: 'joined', subject: 'pk', time: at }, 'left', 'pk', at + 50), false);
    assert.equal(
      isDuplicateMemberNotice({ kind: 'left', subject: 'pk', time: at }, 'left', 'pk', at + MEMBER_LEAVE_GRACE_MS),
      false,
    );
  });

  it('gives two announcers the same leave id in one bucket', async () => {
    const at = MEMBER_LEAVE_GRACE_MS * 7 + 20;
    const a = await memberEventId('room', 'left', 'signer', at);
    const b = await memberEventId('room', 'left', 'signer', at + 100);
    const c = await memberEventId('room', 'left', 'other', at);
    assert.equal(a.length, 16);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });
});
