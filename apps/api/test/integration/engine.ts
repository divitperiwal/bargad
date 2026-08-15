// Imported by setup.ts before the API config reads process.env: gives the API a public key whose private half the tests hold.
import sodium from 'libsodium-wrappers';

await sodium.ready;
const { publicKey, privateKey } = sodium.crypto_box_keypair();
process.env.ENGINE_PUBLIC_KEY = Buffer.from(publicKey).toString('base64');

export const openSealed = async (sealed: Uint8Array): Promise<Uint8Array> => {
  await sodium.ready;
  return sodium.crypto_box_seal_open(sealed, publicKey, privateKey);
};
