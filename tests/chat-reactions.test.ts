import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReactionBook, REACTION_EMOJI, validMessageRef, validReactionEmoji, type ReactionEvent } from '../src/lib/chatReactions';
import { isContent, relayedContentOk, stampPayload, validPayload } from '../src/lib/chatProtocol';
import { plainSnippet } from '../src/lib/chatMarkdown';

const event = (over: Partial<ReactionEvent>): ReactionEvent => ({ id: 'e1', target: 'm1', emoji: '👍', remove: false, reactor: 'alice', name: 'Alice', at: 1000, ...over });

test('six quick reactions, any single emoji accepted, anything else refused', () => {
  assert.deepEqual([...REACTION_EMOJI], ['👍', '❤️', '😂', '😮', '😢', '🔥']);
  for (const emoji of REACTION_EMOJI) assert.equal(validReactionEmoji(emoji), true);
  for (const ok of ['💩', '👍🏽', '🏳️‍🌈', '🇨🇿']) assert.equal(validReactionEmoji(ok), true);
  for (const bad of ['❤', '', 'x', '1', '©', '👍👍', '👍 ', 1, null]) assert.equal(validReactionEmoji(bad), false);
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

test('reactions order by first use and cap distinct emoji per message', () => {
  const book = new ReactionBook();
  book.apply(event({ id: 'a', emoji: '🍕', at: 5 }));
  book.apply(event({ id: 'b', emoji: '👍', reactor: 'bob', at: 9 }));
  assert.deepEqual(book.summary('m1', 'x').map((r) => r.emoji), ['🍕', '👍']);
  const many = ['😀', '😁', '😃', '😄', '😅', '😆', '😉', '😊', '😋', '😎', '😍', '😘', '🥰', '😗', '😙', '😚', '🙂', '🤗'];
  many.forEach((emoji, i) => book.apply(event({ id: `m${i}`, emoji, reactor: `r${i}`, at: 20 + i })));
  assert.equal(book.summary('m1', 'x').length, 20);
  assert.equal(book.apply(event({ id: 'over', emoji: '🤩', reactor: 'z', at: 99 })), false);
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
  assert.equal(forward.apply(event({ emoji: 'xx' })), false);
});

test('replies and reactions pass validation only in their exact shape and count as content', () => {
  const room = 'room';
  const stamp = (value: Record<string, unknown>) => JSON.parse(stampPayload(JSON.stringify(value), room));
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm2', text: 'hi', replyTo: 'm1' }), room), true);
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm2', text: 'hi', replyTo: 'not valid' }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️' }), room), true);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️', remove: true }), room), true);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️', remove: false }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '🍕' }), room), true);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: 'pizza' }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', emoji: '❤️' }), room), false);
  const reaction = { type: 'reaction' };
  assert.equal(isContent(reaction), true);
  assert.equal(relayedContentOk(reaction, true, false), false);
  assert.equal(relayedContentOk(reaction, true, true), true);
});

test('view-once messages and burns pass validation only in their exact shape and count as content', () => {
  const room = 'room';
  const stamp = (value: Record<string, unknown>) => JSON.parse(stampPayload(JSON.stringify(value), room));
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm1', text: 'secret', once: true }), room), true);
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm1', text: 'secret', once: false }), room), false);
  assert.equal(validPayload(stamp({ type: 'chat-message', id: 'm1', text: 'secret', once: 1 }), room), false);
  assert.equal(validPayload(stamp({ type: 'reaction', id: 'r1', target: 'm1', emoji: '❤️', once: true }), room), false);
  assert.equal(validPayload(stamp({ type: 'message-burn', id: 'b1', target: 'm1' }), room), true);
  assert.equal(validPayload(stamp({ type: 'message-burn', id: 'b1' }), room), false);
  assert.equal(validPayload(stamp({ type: 'message-burn', id: 'b1', target: 'not valid' }), room), false);
  const burn = { type: 'message-burn' };
  assert.equal(isContent(burn), true);
  assert.equal(relayedContentOk(burn, true, false), false);
  assert.equal(relayedContentOk(burn, true, true), true);
});

test('a quoted message is one line of plain text that keeps spoilers hidden', () => {
  assert.equal(plainSnippet('**bold** and _it_ ||secret|| `code`\n> quoted'), 'bold and it ••• code quoted');
  assert.equal(plainSnippet('x'.repeat(200), 20), `${'x'.repeat(19)}…`);
  assert.equal(plainSnippet('||line\nbreak||'), '•••');
});

test('member events are content and validate only in their exact shape', () => {
  const room = 'room';
  const stamp = (value: Record<string, unknown>) => JSON.parse(stampPayload(JSON.stringify(value), room));
  assert.equal(isContent({ type: 'member-event' }), true);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'joined' }), room), true);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'left', name: 'Dast' }), room), true);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'renamed', from: 'a', to: 'b' }), room), true);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'left' }), room), false);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'renamed', from: 'a' }), room), false);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'kicked', name: 'a' }), room), false);
  assert.equal(validPayload(stamp({ type: 'member-event', id: 'e1', kind: 'left', name: 'x'.repeat(129) }), room), false);
});
