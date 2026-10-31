import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VAULT_LABEL, buildEntry, cleanLabel, deriveVaultKey, entryId, openTarget, relativeTime, sealEntry, unwrapSecret,
  validEntry, validSecret, vaultState, vaultStateFor, wrapSecret, type RoomEntry, type RoomSecret,
} from '../src/lib/roomVault';

const KEY = 'A'.repeat(43);
const prf = () => crypto.getRandomValues(new Uint8Array(32));

async function hkdfWith(prfOutput: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', prfOutput as BufferSource, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new TextEncoder().encode(info) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

function entry(overrides: Partial<RoomEntry> = {}): RoomEntry {
  return { ...buildEntry({ kind: 'chat', roomId: 'team-room', mode: 'live', label: 'Team' }, 1000)!, ...overrides };
}

test('a wrapped secret opens with the same PRF output and only for its own entry', async () => {
  const output = prf();
  const key = await deriveVaultKey(output);
  assert.equal(key.extractable, false);
  const room = entry();
  const secret: RoomSecret = { type: 'password', value: 'Correct-Horse-42-Battery-Staple' };
  const wrapped = await wrapSecret(key, room.id, secret);
  assert.equal(wrapped.iv.length, 12);
  assert.equal(wrapped.ciphertext.length % 128, 16);
  assert.ok(!new TextDecoder().decode(wrapped.ciphertext).includes(secret.value));
  assert.deepEqual(await unwrapSecret(await deriveVaultKey(new Uint8Array(output)), { ...room, secret: wrapped }), secret);
  assert.equal(await unwrapSecret(key, { ...room, id: entryId('whiteboard', 'team-room'), secret: wrapped }), null);
  assert.equal(await unwrapSecret(await deriveVaultKey(prf()), { ...room, secret: wrapped }), null);
  const tampered = new Uint8Array(wrapped.ciphertext);
  tampered[0] ^= 1;
  assert.equal(await unwrapSecret(key, { ...room, secret: { iv: wrapped.iv, ciphertext: tampered } }), null);
});

test('short and long passwords give ciphertexts of the same size', async () => {
  const key = await deriveVaultKey(prf());
  const a = await wrapSecret(key, 'chat:x', { type: 'password', value: 'a'.repeat(16) });
  const b = await wrapSecret(key, 'chat:x', { type: 'password', value: 'b'.repeat(80) });
  assert.equal(a.ciphertext.length, b.ciphertext.length);
});

test('the wrapping key is HKDF-SHA256 under the vault label and no other', async () => {
  const output = prf();
  const room = entry({ mode: 'persistent', roomId: 'abc', id: 'chat:abc' });
  const secret: RoomSecret = { type: 'key', value: KEY };
  const wrapped = await wrapSecret(await deriveVaultKey(output), room.id, secret);
  assert.deepEqual(await unwrapSecret(await hkdfWith(output, VAULT_LABEL), { ...room, secret: wrapped }), secret);
  for (const other of ['encrypt.click/room-vault/v2', 'encrypt.click/chat/local', '']) {
    assert.equal(await unwrapSecret(await hkdfWith(output, other), { ...room, secret: wrapped }), null, other);
  }
});

test('the PRF output must be exactly 32 bytes', async () => {
  await assert.rejects(deriveVaultKey(new Uint8Array(16)));
  await assert.rejects(deriveVaultKey(new Uint8Array(64)));
});

test('secrets must match the room mode', () => {
  assert.ok(validSecret({ type: 'key', value: KEY }, 'persistent'));
  assert.ok(!validSecret({ type: 'key', value: KEY }, 'live'));
  assert.ok(!validSecret({ type: 'key', value: 'short' }, 'persistent'));
  assert.ok(validSecret({ type: 'password', value: 'x'.repeat(20) }, 'ttl-60'));
  assert.ok(!validSecret({ type: 'password', value: 'x'.repeat(20) }, 'persistent'));
  assert.ok(!validSecret({ type: 'password', value: '' }, 'live'));
  assert.ok(!validSecret({ type: 'password', value: ' padded ' }, 'live'));
  assert.ok(!validSecret({ type: 'token', value: 'x' }, 'live'));
});

test('a secret that does not fit the stored mode is not handed out', async () => {
  const key = await deriveVaultKey(prf());
  const room = entry();
  const wrapped = await wrapSecret(key, room.id, { type: 'key', value: KEY });
  assert.equal(await unwrapSecret(key, { ...room, secret: wrapped }), null);
});

test('entries are validated when read back', async () => {
  const good = entry();
  assert.deepEqual(validEntry(good), good);
  const sealed = await sealEntry(good, { type: 'password', value: 'y'.repeat(20) }, await deriveVaultKey(prf()));
  assert.deepEqual(validEntry(sealed), sealed);
  assert.equal(validEntry(null), null);
  assert.equal(validEntry({ ...good, kind: 'files' }), null);
  assert.equal(validEntry({ ...good, id: 'whiteboard:team-room' }), null);
  assert.equal(validEntry({ ...good, roomId: '../x', id: 'chat:../x' }), null);
  assert.equal(validEntry({ ...good, mode: 'ttl-7' }), null);
  assert.equal(validEntry({ ...good, kind: 'whiteboard', id: 'whiteboard:team-room', mode: 'ttl-60' }), null);
  assert.equal(validEntry({ ...good, label: 'x'.repeat(65) }), null);
  assert.equal(validEntry({ ...good, label: 'a\u0000b' }), null);
  assert.equal(validEntry({ ...good, lastSeen: -1 }), null);
  assert.equal(validEntry({ ...good, secret: { iv: new Uint8Array(8), ciphertext: new Uint8Array(32) } }), null);
  assert.equal(validEntry({ ...good, secret: 'plain-password' }), null);
  assert.equal(validEntry({ ...good, extra: 'dropped' })?.hasOwnProperty('extra'), false);
});

test('labels are cleaned and fall back to the room name', () => {
  assert.equal(cleanLabel('  Team \n  room ', 'x'), 'Team room');
  assert.equal(cleanLabel('‮', 'fallback'), 'fallback');
  assert.equal([...cleanLabel('ž'.repeat(100), 'x')].length, 64);
  const updated = buildEntry({ kind: 'chat', roomId: 'team-room', mode: 'live' }, 5000, entry());
  assert.equal(updated?.label, 'Team');
  assert.equal(updated?.createdAt, 1000);
  assert.equal(updated?.lastSeen, 5000);
  assert.equal(buildEntry({ kind: 'chat', roomId: 'team room', mode: 'live' }, 1), null);
});

test('without a vault key only names are stored', async () => {
  const secret: RoomSecret = { type: 'password', value: 'Never-Stored-In-Clear-123' };
  const plain = await sealEntry(entry(), secret, null);
  assert.equal(plain.secret, undefined);
  const withOld = await sealEntry({ ...entry(), secret: { iv: new Uint8Array(12), ciphertext: new Uint8Array(32) } }, secret, null);
  assert.equal(withOld.secret, undefined);
  assert.ok(!JSON.stringify(plain).includes(secret.value));
});

test('the vault falls back to names only without WebAuthn or PRF', async () => {
  const ref = { credentialId: new Uint8Array(32), salt: new Uint8Array(32), createdAt: 1 };
  assert.equal(vaultStateFor({ webauthn: false, namesOnly: false, ref, unlocked: false }), 'names');
  assert.equal(vaultStateFor({ webauthn: true, namesOnly: true, ref: null, unlocked: false }), 'names');
  assert.equal(vaultStateFor({ webauthn: true, namesOnly: false, ref: null, unlocked: false }), 'new');
  assert.equal(vaultStateFor({ webauthn: true, namesOnly: false, ref, unlocked: false }), 'locked');
  assert.equal(vaultStateFor({ webauthn: true, namesOnly: false, ref, unlocked: true }), 'unlocked');
  assert.equal(await vaultState(), 'names');
});

test('opening hands secrets over outside the address bar', () => {
  assert.deepEqual(openTarget('chat', 'team-room', 'en', { type: 'password', value: 'pw' }), { href: '/chat/team-room', handoff: ['chat-password', 'pw'] });
  assert.deepEqual(openTarget('chat', 'abc', 'cs', { type: 'key', value: KEY }), { href: '/cs/chat/abc', handoff: ['chat-link-key:abc', KEY] });
  assert.deepEqual(openTarget('whiteboard', 'b1', 'de', { type: 'password', value: 'pw' }), { href: '/de/whiteboard/b1', handoff: ['whiteboard-password', 'pw'] });
  assert.deepEqual(openTarget('whiteboard', 'b1', 'en', null), { href: '/whiteboard/b1', handoff: null });
});

test('relative visit times pick the largest whole unit', () => {
  assert.deepEqual(relativeTime(0, 30_000), { value: 0, unit: 'second' });
  assert.deepEqual(relativeTime(0, 5 * 60_000), { value: -5, unit: 'minute' });
  assert.deepEqual(relativeTime(0, 3 * 86_400_000), { value: -3, unit: 'day' });
  assert.deepEqual(relativeTime(10, 0), { value: 0, unit: 'second' });
});
