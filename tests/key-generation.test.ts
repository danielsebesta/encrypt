import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createPublicKey } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as openpgp from 'openpgp';
import { DEFAULT_RSA_BITS, RSA_BIT_LENGTHS, generateRSAKeyPair, generateSSHKeyPair } from '../src/lib/rsaKeys';
import { generatePGPKeyPair } from '../src/lib/pgpKeys';

const decoder = new TextDecoder();

class Reader {
  offset = 0;
  constructor(readonly bytes: Uint8Array) {}
  get remaining() { return this.bytes.length - this.offset; }
  take(length: number): Uint8Array {
    assert.ok(this.offset + length <= this.bytes.length, 'read past the end');
    const out = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }
  uint32(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4);
    this.offset += 4;
    return view.getUint32(0);
  }
  string(): Uint8Array { return this.take(this.uint32()); }
  text(): string { return decoder.decode(this.string()); }
}

const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

function parseOpenSshPrivateKey(pem: string) {
  assert.match(pem, /^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
  assert.match(pem, /\n-----END OPENSSH PRIVATE KEY-----\n$/);
  const lines = pem.trimEnd().split('\n').slice(1, -1);
  for (const line of lines.slice(0, -1)) assert.equal(line.length, 70);
  assert.ok(lines[lines.length - 1].length <= 70);
  const file = new Reader(fromBase64(lines.join('')));
  assert.equal(decoder.decode(file.take(15)), 'openssh-key-v1\0');
  const result = {
    cipher: file.text(),
    kdf: file.text(),
    kdfOptions: file.string(),
    keyCount: file.uint32(),
    publicBlob: file.string(),
    section: file.string(),
  };
  assert.equal(file.remaining, 0);
  return result;
}

function parseEd25519Section(section: Uint8Array) {
  assert.equal(section.length % 8, 0);
  const reader = new Reader(section);
  const parsed = {
    check1: reader.uint32(),
    check2: reader.uint32(),
    type: reader.text(),
    publicKey: reader.string(),
    secret: reader.string(),
    comment: reader.text(),
    padding: reader.take(reader.remaining),
  };
  return parsed;
}

function ed25519Blob(blob: Uint8Array) {
  const reader = new Reader(blob);
  const parsed = { type: reader.text(), publicKey: reader.string() };
  assert.equal(reader.remaining, 0);
  return parsed;
}

function findTool(candidates: string[], probe: string[]): string | null {
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
    const run = spawnSync(candidate, probe, { stdio: 'ignore' });
    if (!run.error) return candidate;
  }
  return null;
}

const sshKeygen = findTool(['ssh-keygen', 'C:\\Program Files\\Git\\usr\\bin\\ssh-keygen.exe'], ['-?']);
const gpg = findTool(['gpg', 'C:\\Program Files\\Git\\usr\\bin\\gpg.exe'], ['--version']);

test('RSA key lengths are 2048, 3072 and 4096 with 3072 as the default', async () => {
  assert.deepEqual([...RSA_BIT_LENGTHS], [2048, 3072, 4096]);
  assert.equal(DEFAULT_RSA_BITS, 3072);
  const { publicKey, privateKey } = await generateRSAKeyPair();
  assert.match(publicKey, /^-----BEGIN PUBLIC KEY-----\n[\s\S]+\n-----END PUBLIC KEY-----$/);
  assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----$/);
  assert.equal(createPublicKey(publicKey).asymmetricKeyDetails?.modulusLength, 3072);
});

test('1024-bit and other unsupported RSA lengths are rejected', async () => {
  for (const bits of [512, 1024, 1536, 2047, 8192]) {
    await assert.rejects(generateRSAKeyPair(bits), RangeError, String(bits));
    await assert.rejects(generateSSHKeyPair({ type: 'rsa', bits }), RangeError, String(bits));
  }
});

test('Ed25519 is the default SSH key type and produces an OpenSSH public key line', async () => {
  const { publicKey } = await generateSSHKeyPair({ comment: 'alice@laptop' });
  const [type, blob, ...comment] = publicKey.split(' ');
  assert.equal(type, 'ssh-ed25519');
  assert.match(blob, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(comment.join(' '), 'alice@laptop');
  const parsed = ed25519Blob(fromBase64(blob));
  assert.equal(parsed.type, 'ssh-ed25519');
  assert.equal(parsed.publicKey.length, 32);
  assert.equal(blob.length, 68);
});

test('Ed25519 private keys use the openssh-key-v1 layout and match the public key', async () => {
  const { publicKey, privateKey } = await generateSSHKeyPair({ type: 'ed25519', comment: 'alice@laptop' });
  const file = parseOpenSshPrivateKey(privateKey);
  assert.equal(file.cipher, 'none');
  assert.equal(file.kdf, 'none');
  assert.equal(file.kdfOptions.length, 0);
  assert.equal(file.keyCount, 1);
  assert.equal(Buffer.from(file.publicBlob).toString('base64'), publicKey.split(' ')[1]);

  const section = parseEd25519Section(file.section);
  assert.equal(section.check1, section.check2);
  assert.equal(section.type, 'ssh-ed25519');
  assert.equal(section.comment, 'alice@laptop');
  assert.deepEqual(section.publicKey, ed25519Blob(file.publicBlob).publicKey);
  assert.equal(section.secret.length, 64);
  assert.deepEqual(section.secret.slice(32), section.publicKey);
  assert.ok(section.padding.length < 8);
  assert.deepEqual(Array.from(section.padding), Array.from(section.padding, (_, i) => i + 1));

  const pkcs8 = new Uint8Array([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20, ...section.secret.slice(0, 32)]);
  const signer = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
  const verifier = await crypto.subtle.importKey('raw', new Uint8Array(section.publicKey), { name: 'Ed25519' }, false, ['verify']);
  const message = new TextEncoder().encode('sshsig');
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, signer, message);
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, verifier, signature, message));
});

test('Ed25519 keys without a comment have no trailing text and fresh randomness each time', async () => {
  const first = await generateSSHKeyPair();
  const second = await generateSSHKeyPair();
  assert.equal(first.publicKey.split(' ').length, 2);
  assert.notEqual(first.publicKey, second.publicKey);
  assert.notEqual(first.privateKey, second.privateKey);
  assert.equal(parseEd25519Section(parseOpenSshPrivateKey(first.privateKey).section).comment, '');
});

test('SSH comments cannot smuggle extra lines or fields into the key files', async () => {
  const { publicKey, privateKey } = await generateSSHKeyPair({ comment: 'a@b\nssh-rsa AAAA evil\r\n\u0000x' });
  assert.equal(publicKey.split('\n').length, 1);
  assert.match(publicKey, /^ssh-ed25519 \S+ a@b ssh-rsa AAAA evil x$/);
  assert.equal(parseEd25519Section(parseOpenSshPrivateKey(privateKey).section).comment, 'a@b ssh-rsa AAAA evil x');
});

test('RSA SSH keys keep the ssh-rsa line and a PKCS#8 private key', async () => {
  const { publicKey, privateKey } = await generateSSHKeyPair({ type: 'rsa', bits: 2048, comment: 'ci' });
  const [type, blob, comment] = publicKey.split(' ');
  assert.equal(type, 'ssh-rsa');
  assert.equal(comment, 'ci');
  const reader = new Reader(fromBase64(blob));
  assert.equal(reader.text(), 'ssh-rsa');
  assert.deepEqual([...reader.string()], [1, 0, 1]);
  const modulus = reader.string();
  assert.equal(modulus[0], 0);
  assert.equal(modulus.length, 257);
  assert.equal(reader.remaining, 0);
  assert.match(privateKey, /^-----BEGIN PRIVATE KEY-----\n[\s\S]+\n-----END PRIVATE KEY-----\n$/);
});

test('ssh-keygen accepts the generated Ed25519 key and derives the same public key', { skip: sshKeygen ? false : 'ssh-keygen is not installed' }, async () => {
  const { publicKey, privateKey } = await generateSSHKeyPair({ comment: 'interop' });
  const dir = mkdtempSync(path.join(tmpdir(), 'encrypt-ssh-'));
  try {
    const keyFile = path.join(dir, 'id_ed25519');
    writeFileSync(keyFile, privateKey, { mode: 0o600 });
    const derived = spawnSync(sshKeygen!, ['-y', '-f', keyFile], { encoding: 'utf8' });
    assert.equal(derived.status, 0, derived.stderr);
    assert.equal(derived.stdout.trim(), publicKey);
    const fingerprint = spawnSync(sshKeygen!, ['-l', '-f', keyFile], { encoding: 'utf8' });
    assert.equal(fingerprint.status, 0, fingerprint.stderr);
    assert.match(fingerprint.stdout, /^256 SHA256:\S+ interop \(ED25519\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PGP keys default to Curve25519: EdDSA primary key and X25519 subkey in the version 4 format', async () => {
  const { publicKey, privateKey } = await generatePGPKeyPair({ name: 'Alice Example', email: 'alice@example.com' });
  assert.match(publicKey, /^-----BEGIN PGP PUBLIC KEY BLOCK-----/);
  assert.match(privateKey, /^-----BEGIN PGP PRIVATE KEY BLOCK-----/);

  const pub = await openpgp.readKey({ armoredKey: publicKey });
  assert.equal(pub.isPrivate(), false);
  assert.equal(pub.keyPacket.version, 4);
  assert.deepEqual(pub.getAlgorithmInfo(), { algorithm: 'eddsaLegacy', curve: 'ed25519Legacy' });
  assert.equal(pub.subkeys.length, 1);
  assert.deepEqual(pub.subkeys[0].getAlgorithmInfo(), { algorithm: 'ecdh', curve: 'curve25519Legacy' });
  assert.deepEqual(pub.getUserIDs(), ['Alice Example <alice@example.com>']);
  assert.equal(await pub.getExpirationTime(), Infinity);

  const secret = await openpgp.readPrivateKey({ armoredKey: privateKey });
  assert.equal(secret.isDecrypted(), true);
  assert.equal(secret.getKeyIDs()[0].toHex(), pub.getKeyIDs()[0].toHex());

  const encrypted = await openpgp.encrypt({ message: await openpgp.createMessage({ text: 'hello' }), encryptionKeys: pub });
  const decrypted = await openpgp.decrypt({ message: await openpgp.readMessage({ armoredMessage: encrypted }), decryptionKeys: secret });
  assert.equal(decrypted.data, 'hello');

  const signed = await openpgp.sign({ message: await openpgp.createMessage({ text: 'signed' }), signingKeys: secret });
  const verified = await openpgp.verify({ message: await openpgp.readMessage({ armoredMessage: signed }), verificationKeys: pub });
  assert.equal(await verified.signatures[0].verified, true);
});

test('a PGP passphrase protects the private key', async () => {
  const { privateKey } = await generatePGPKeyPair({ name: 'Bob', email: 'bob@example.com', passphrase: 'correct horse battery' });
  const secret = await openpgp.readPrivateKey({ armoredKey: privateKey });
  assert.equal(secret.isDecrypted(), false);
  await assert.rejects(openpgp.decryptKey({ privateKey: secret, passphrase: 'wrong' }));
  assert.equal((await openpgp.decryptKey({ privateKey: secret, passphrase: 'correct horse battery' })).isDecrypted(), true);
});

test('PGP RSA stays available with the chosen strength', async () => {
  const { publicKey } = await generatePGPKeyPair({ name: 'Carol', email: 'carol@example.com', type: 'rsa', rsaBits: 2048 });
  const pub = await openpgp.readKey({ armoredKey: publicKey });
  assert.deepEqual(pub.getAlgorithmInfo(), { algorithm: 'rsaEncryptSign', bits: 2048 });
  assert.equal(pub.keyPacket.version, 4);
});

test('GnuPG imports the Curve25519 key as EdDSA and cv25519', { skip: gpg ? false : 'gpg is not installed' }, async () => {
  const { publicKey, privateKey } = await generatePGPKeyPair({ name: 'Dave', email: 'dave@example.com' });
  const home = mkdtempSync(path.join(tmpdir(), 'encrypt-gpg-'));
  try {
    const imported = spawnSync(gpg!, ['--homedir', '.', '--batch', '--import'], { cwd: home, input: `${publicKey}\n${privateKey}`, encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    const listed = spawnSync(gpg!, ['--homedir', '.', '--batch', '--list-keys', '--with-colons'], { cwd: home, encoding: 'utf8' });
    assert.equal(listed.status, 0, listed.stderr);
    const rows = listed.stdout.split('\n').map((line) => line.split(':'));
    const primary = rows.find((row) => row[0] === 'pub');
    const subkey = rows.find((row) => row[0] === 'sub');
    assert.equal(primary?.[3], '22');
    assert.equal(primary?.[16], 'ed25519');
    assert.equal(subkey?.[3], '18');
    assert.equal(subkey?.[16], 'cv25519');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
