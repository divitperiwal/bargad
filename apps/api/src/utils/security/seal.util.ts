import sodium from 'libsodium-wrappers';

// Seals to the engine's public key (libsodium sealed box); only the engine's private key can open it.
export async function sealForEngine(plaintext: Uint8Array, publicKey: Uint8Array): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal(plaintext, publicKey);
}
