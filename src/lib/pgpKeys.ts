import * as openpgp from 'openpgp';

export type PGPKeyType = 'curve25519' | 'rsa';

export async function generatePGPKeyPair(options: {
  name: string;
  email: string;
  passphrase?: string;
  type?: PGPKeyType;
  rsaBits?: number;
}): Promise<{ publicKey: string; privateKey: string }> {
  const { name, email, passphrase, type = 'curve25519', rsaBits = 4096 } = options;

  const keyOptions = type === 'rsa'
    ? { type: 'rsa' as const, rsaBits }
    : { type: 'ecc' as const, curve: 'curve25519Legacy' as const };

  const { privateKey, publicKey } = await openpgp.generateKey({
    ...keyOptions,
    userIDs: [{ name, email }],
    passphrase: passphrase && passphrase.length > 0 ? passphrase : undefined,
  });

  return { publicKey, privateKey };
}
