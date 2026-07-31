import * as openpgp from 'openpgp';

export async function generatePGPKeyPair(options: {
  name: string;
  email: string;
  passphrase?: string;
  rsaBits?: number;
}): Promise<{ publicKey: string; privateKey: string }> {
  const { name, email, passphrase, rsaBits = 4096 } = options;

  const { privateKey, publicKey } = await openpgp.generateKey({
    type: 'rsa',
    rsaBits,
    userIDs: [{ name, email }],
    passphrase: passphrase && passphrase.length > 0 ? passphrase : undefined,
  } as any);

  return { publicKey, privateKey };
}
