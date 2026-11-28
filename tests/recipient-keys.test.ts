import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CARD_MAX_BYTES, KEM_PUBLIC_BYTES, cardFromInput, cardLink, cardToText, cleanName, contactId, deriveIdentity, fingerprint, parseCard,
  renameIdentity, sameKeys,
} from '../src/lib/identity';
import {
  NotForThisKey, RECIPIENT_HEADER_BYTES, RECIPIENT_SLOTS, isRecipientEnvelope, openRecipientEnvelope, recipientOverhead, sealForRecipients,
} from '../src/lib/recipientEnvelope';
import { decryptData, decryptForRecipient, encryptForRecipients } from '../src/lib/ghost/crypto';
import { padme } from '../src/lib/padding';
import { formatShareFragment, parseShareFragment } from '../src/lib/shareLink';

const seed = (byte?: number) => (byte === undefined ? crypto.getRandomValues(new Uint8Array(32)) : new Uint8Array(32).fill(byte));
const text = (value: string) => new TextEncoder().encode(value);

test('one seed always gives the same identity and different seeds different ones', async () => {
  const a = await deriveIdentity(seed(7), 'Pepa');
  const b = await deriveIdentity(seed(7), 'Pepa');
  const c = await deriveIdentity(seed(8), 'Pepa');
  assert.equal(a.card.kemPub.length, KEM_PUBLIC_BYTES);
  assert.equal(a.card.signPub.length, 32);
  assert.equal(a.kemSecret.length, 32);
  assert.deepEqual(a.card.bytes, b.card.bytes);
  assert.ok(!sameKeys(a.card, c.card));
  assert.equal(await fingerprint(a.card), await fingerprint(b.card));
  assert.notEqual(await fingerprint(a.card), await fingerprint(c.card));
  assert.match(await fingerprint(a.card), /^\d{5} \d{5} \d{5} \d{5} \d{5}$/);
  assert.equal((await contactId(a.card)).length, 22);
  assert.equal(a.signKey.extractable, false);
  await assert.rejects(deriveIdentity(new Uint8Array(31), 'x'));
});

test('a card round-trips through its link and rejects any change', async () => {
  const { card } = await deriveIdentity(seed(), 'Žluťoučký kůň');
  assert.ok(card.bytes.length <= CARD_MAX_BYTES);
  const parsed = await cardFromInput(cardLink(card, 'https://encrypt.click', '/cs/keys'));
  assert.ok(parsed);
  assert.equal(parsed.name, 'Žluťoučký kůň');
  assert.ok(sameKeys(parsed, card));
  assert.ok(await cardFromInput(`  ${cardToText(card)}\n`));

  for (const index of [0, 1, 40, 600, card.bytes.length - 70, card.bytes.length - 1]) {
    const tampered = card.bytes.slice();
    tampered[index] ^= 1;
    assert.equal(await parseCard(tampered), null, `byte ${index}`);
  }
  assert.equal(await parseCard(card.bytes.subarray(0, card.bytes.length - 1)), null);
  assert.equal(await parseCard(new Uint8Array([...card.bytes, 0])), null);
  assert.equal(await cardFromInput('not a card'), null);
  assert.equal(await cardFromInput('https://encrypt.click/keys#'), null);
});

test('a card cannot pair one signing key with somebody else’s receiving key', async () => {
  const mine = await deriveIdentity(seed(), 'Me');
  const theirs = await deriveIdentity(seed(), 'Them');
  const forged = mine.card.bytes.slice();
  forged.set(theirs.card.kemPub, 33);
  assert.equal(await parseCard(forged), null);
});

test('names are cleaned and fit the card', async () => {
  assert.equal(cleanName('  Pepa \n\u202E Novák  '), 'Pepa Novák');
  const long = cleanName('ř'.repeat(40));
  assert.equal(new TextEncoder().encode(long).length, 32);
  assert.equal(cleanName(long), long);
  const identity = await deriveIdentity(seed(3), 'Old');
  const renamed = await renameIdentity(identity, 'New');
  assert.equal(renamed.card.name, 'New');
  assert.ok(await parseCard(renamed.card.bytes));
  assert.equal(await fingerprint(renamed.card), await fingerprint(identity.card));
});

test('every recipient opens the file, nobody else does', async () => {
  const sender = await deriveIdentity(seed(), 'Sender');
  const people = await Promise.all([1, 2, 3].map(() => deriveIdentity(seed(), 'R')));
  const stranger = await deriveIdentity(seed(), 'Stranger');
  const content = text('hello recipients');
  const sealed = await sealForRecipients(content, [...people.map((p) => p.card.kemPub), sender.card.kemPub], { signer: sender });
  assert.ok(isRecipientEnvelope(sealed));
  assert.equal(sealed.length, RECIPIENT_HEADER_BYTES + padme(4 + 1 + 2 + sender.card.bytes.length + 64 + content.length) + 16);
  for (const person of [...people, sender]) {
    const opened = await openRecipientEnvelope(sealed, person.kemSecret);
    assert.deepEqual(opened.content, content);
    assert.ok(opened.sender && sameKeys(opened.sender, sender.card));
    assert.equal(opened.sender.name, 'Sender');
  }
  await assert.rejects(openRecipientEnvelope(sealed, stranger.kemSecret), NotForThisKey);
});

test('the envelope hides how many recipients there are', async () => {
  const one = await deriveIdentity(seed(), 'A');
  const many = await Promise.all(Array.from({ length: RECIPIENT_SLOTS }, () => deriveIdentity(seed(), 'B')));
  const content = text('same size');
  const a = await sealForRecipients(content, [one.card.kemPub]);
  const b = await sealForRecipients(content, many.map((p) => p.card.kemPub));
  assert.equal(a.length, b.length);
  await assert.rejects(sealForRecipients(content, [...many, one].map((p) => p.card.kemPub)), /recipient count/);
  await assert.rejects(sealForRecipients(content, []), /recipient count/);
  await assert.rejects(sealForRecipients(content, [new Uint8Array(10)]), /recipient key/);
  const twice = await sealForRecipients(content, [one.card.kemPub, one.card.kemPub]);
  assert.deepEqual((await openRecipientEnvelope(twice, one.kemSecret)).content, content);
});

test('an unsigned file opens without a sender', async () => {
  const reader = await deriveIdentity(seed(), 'R');
  const sealed = await sealForRecipients([text('a'), text('b')], [reader.card.kemPub]);
  const opened = await openRecipientEnvelope(sealed, reader.kemSecret);
  assert.deepEqual(opened.content, text('ab'));
  assert.equal(opened.sender, null);
});

test('changing any part of the file makes it fail to open', async () => {
  const sender = await deriveIdentity(seed(), 'S');
  const reader = await deriveIdentity(seed(), 'R');
  const sealed = await sealForRecipients(text('tamper me'), [reader.card.kemPub], { signer: sender });
  const offsets = [0, 4, 5, 5 + 1119, 5 + 1120, 5 + 1167, 5 + 1168 * 7 + 3, RECIPIENT_HEADER_BYTES - 32, RECIPIENT_HEADER_BYTES - 1, RECIPIENT_HEADER_BYTES, sealed.length - 17, sealed.length - 1];
  const results = await Promise.all(offsets.map(async (offset) => {
    const tampered = sealed.slice();
    tampered[offset] ^= 1;
    try {
      await openRecipientEnvelope(tampered, reader.kemSecret);
      return `opened after flipping ${offset}`;
    } catch {
      return null;
    }
  }));
  assert.deepEqual(results.filter(Boolean), []);
  await assert.rejects(openRecipientEnvelope(sealed.subarray(0, sealed.length - 1), reader.kemSecret));
  await assert.rejects(openRecipientEnvelope(sealed.subarray(0, RECIPIENT_HEADER_BYTES), reader.kemSecret));
});

test('a recipient cannot re-address a signed file to someone else under the sender’s name', async () => {
  const sender = await deriveIdentity(seed(), 'S');
  const reader = await deriveIdentity(seed(), 'R');
  const third = await deriveIdentity(seed(), 'T');
  const original = await sealForRecipients(text('signed'), [reader.card.kemPub], { signer: sender });
  const resealed = await sealForRecipients(text('signed'), [third.card.kemPub]);
  const opened = await openRecipientEnvelope(original, reader.kemSecret);
  assert.ok(opened.sender);

  const forged = await sealForRecipients(text('signed'), [third.card.kemPub], { signer: reader });
  const forgedOpen = await openRecipientEnvelope(forged, third.kemSecret);
  assert.ok(forgedOpen.sender && sameKeys(forgedOpen.sender, reader.card));
  assert.equal((await openRecipientEnvelope(resealed, third.kemSecret)).sender, null);
});

test('a signature is bound to its own header', async () => {
  const sender = await deriveIdentity(seed(), 'S');
  const reader = await deriveIdentity(seed(), 'R');
  const first = await sealForRecipients(text('one'), [reader.card.kemPub], { signer: sender });
  const second = await sealForRecipients(text('one'), [reader.card.kemPub], { signer: sender });
  const spliced = new Uint8Array(first.length);
  spliced.set(second.subarray(0, RECIPIENT_HEADER_BYTES));
  spliced.set(first.subarray(RECIPIENT_HEADER_BYTES), RECIPIENT_HEADER_BYTES);
  await assert.rejects(openRecipientEnvelope(spliced, reader.kemSecret));
});

test('the ghost payload carries the file name and refuses the password path', async () => {
  const sender = await deriveIdentity(seed(), 'S');
  const reader = await deriveIdentity(seed(), 'R');
  const data = text('file body');
  const sealed = await encryptForRecipients(data, [reader.card.kemPub], sender, 'notes.txt');
  const opened = await decryptForRecipient(sealed, reader.kemSecret);
  assert.deepEqual(opened.data, data);
  assert.equal(opened.name, 'notes.txt');
  assert.ok(opened.sender);
  await assert.rejects(decryptData(sealed, 'password'), /recipient keys/);
  assert.ok(recipientOverhead(true) > recipientOverhead(false));
});

test('recipient share links round-trip and refuse password-only options', () => {
  const payload = 'eyJ2IjozfQ';
  const plain = formatShareFragment({ payload, recipients: true });
  assert.equal(plain, `v=3&m=r&p=${payload}`);
  assert.deepEqual(parseShareFragment(plain), { payload, recipients: true });
  const expiring = formatShareFragment({ payload, recipients: true, expires: 1900000000 });
  assert.equal(expiring, `v=3&m=r&x=1900000000&p=${payload}`);
  assert.deepEqual(parseShareFragment(expiring), { payload, recipients: true, expires: 1900000000 });
  assert.throws(() => formatShareFragment({ payload, recipients: true, burn: true }));
  assert.throws(() => formatShareFragment({ payload, recipients: true, key: 'abc' }));
  for (const bad of [
    `v=3&p=${payload}`,
    `v=3&m=x&p=${payload}`,
    `v=3&m=r&b=1&p=${payload}`,
    `v=3&m=r&k=abc&p=${payload}`,
    `v=3&m=r&x=soon&p=${payload}`,
    `v=3&m=r&m=r&p=${payload}`,
    'v=3&m=r&p=not base64',
  ]) assert.equal(parseShareFragment(bad), null, bad);
});
