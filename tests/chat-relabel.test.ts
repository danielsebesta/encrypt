import test from 'node:test';
import assert from 'node:assert/strict';
import { relabelBySigner } from '../src/lib/chatRelabel.ts';

test('a rename rewrites every bubble that shares the signing key', () => {
  const before = [
    { id: '1', pk: 'a', sender: 'Hrdý Jelen', initials: 'HJ', color: '#1', nick: 'Hrdý_Jelen' },
    { id: '2', pk: 'b', sender: 'Tajemný Jelen', initials: 'TJ', color: '#2' },
    { id: '3', pk: 'a', sender: 'Hrdý Jelen', initials: 'HJ', color: '#1', nick: 'Hrdý_Jelen' },
  ];
  const after = relabelBySigner(before, 'a', { name: 'blb', initials: 'bl', color: '#9', nick: 'blb' });
  assert.notEqual(after, before);
  assert.equal(after[0].sender, 'blb');
  assert.equal(after[0].initials, 'bl');
  assert.equal(after[0].nick, 'blb');
  assert.equal(after[1].sender, 'Tajemný Jelen');
  assert.equal(after[2].sender, 'blb');
});

test('unchanged labels keep the same array', () => {
  const messages = [{ id: '1', pk: 'a', sender: 'blb', initials: 'bl', color: '#9', nick: 'blb' }];
  assert.equal(relabelBySigner(messages, 'a', { name: 'blb', initials: 'bl', color: '#9', nick: 'blb' }), messages);
});
