import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReactionBook, REACTION_EMOJI, validMessageRef, validReactionEmoji, type ReactionEvent } from '../src/lib/chatReactions';
import { isContent, relayedContentOk, stampPayload, validPayload } from '../src/lib/chatProtocol';
import { plainSnippet } from '../src/lib/chatMarkdown';

const event = (over: Partial<ReactionEvent>): ReactionEvent => ({ id: 'e1', target: 'm1', emoji: '👍', remove: false, reactor: 'alice', name: 'Alice', at: 1000, ...over });

test('there are exactly six reactions and anything else is refused', () => {
  assert.deepEqual([...REACTION_EMOJI], ['👍', '❤️', '😂', '😮', '😢', '🔥']);
  for (const emoji of REACTION_EMOJI) assert.equal(validReactionEmoji(emoji), true);
  for (const bad of ['💩', '❤', '', 'x', 1, null]) assert.equal(validReactionEmoji(bad), false);
  assert.equal(validMessageRef('0123456789abcdef'), true);
  assert.equal(validMessageRef('whiteboard-0123'), true);
  for (const bad of ['', 'a'.repeat(65), 'has space', '<b>', 7]) assert.equal(validMessageRef(bad), false);
});

test('reactions fold per reactor, count, mark your own and toggle off', () => {
  const book = new ReactionBook();
  book.apply(event({}));
  book.apply(event({ id: 'e2', reactor: 'bob', name: 'Bob', at: 1100 }));
  book.apply(event({ id: 'e3', reactor: 'bob', name: 'Bob', emoji: '🔥', at: 1200 }));
  assert.deepEqual(book.summary('m1', 'bob', 'you'), [
    { emoji: '👍', count: 2, mine: true, names: ['Alice', 'you'] },
    { emoji: '🔥', count: 1, mine: true, names: ['you'] },
  ]);
  book.apply(event({ id: 'e4', reactor: 'bob', name: 'Bob', remove: true, at: 1300 }));
  assert.deepEqual(book.summary('m1', 'carol'), [
    { emoji: '👍', count: 1, mine: false, names: ['Alice'] },
    { emoji: '🔥', count: 1, mine: false, names: ['Bob'] },
  ]);
  assert.equal(book.has('m1', '👍', 'bob'), false);
  assert.deepEqual(book.summary('other', 'bob'), []);
});

test('replaying the same reactions again or in another order ends in the same state', () => {
  const events = [
    event({ id: 'a', at: 1 }),
    event({ id: 'b', remove: true, at: 2 }),
    event({ id: 'c', at: 3 }),
    event({ id: 'd', reactor: 'bob', name: 'Bob', emoji: '😂', at: 2 }),
    event({ id: 'e', reactor: 'bob', name: 'Bob', emoji: '😂', remove: true, at: 2 }),
  ];
  const forward = new ReactionBook();
  for (const e of events) forward.apply(e);
  const backward = new ReactionBook();
  for (const e of [...events].reverse()) backward.apply(e);
  for (const e of events) backward.apply(e);
  assert.deepEqual(backward.summary('m1', 'x'), forward.summary('m1', 'x'));
  assert.deepEqual(forward.summary('m1', 'x'), [{ emoji: '👍', count: 1, mine: false, names: ['Alice'] }]);
  assert.equal(forward.apply(event({ id: 'a', at: 1 })), false);
  assert.equal(forward.apply(event({ emoji: '💩' as any })), false);
});

test('replies and reactions pass validation only in their exact shape and count as content', () => {
  const room = 'room';
  const stamp = (value: Record<string, unknown>) => JSON.parse(stampPayload(JSON.stringify(value), room));
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm2', text: 'hi', replyTo: 'm1' }), room), true);
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm2', text: 'hi', replyTo: 'not valid' }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️' }), room), true);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️', remove: true }), room), true);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️', remove: false }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '🍕' }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', emoji: '❤️' }), room), false);
  const reaction = { type: 'reaction' };
  assert.equal(isContent(reaction), true);
  assert.equal(relayedContentOk(reaction, true, false), false);
  assert.equal(relayedContentOk(reaction, true, true), true);
});

test('a quoted message is one line of plain text that keeps spoilers hidden', () => {
  assert.equal(plainSnippet('**bold** and _it_ ||secret|| `code`\n> quoted'), 'bold and _it_ ••• code quoted');
  assert.equal(plainSnippet('x'.repeat(200), 20), `${'x'.repeat(19)}…`);
  assert.equal(plainSnippet('||line\nbreak||'), '•••');
});
