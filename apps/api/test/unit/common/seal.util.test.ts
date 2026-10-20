import { describe, expect, test } from 'bun:test';
import sodium from 'libsodium-wrappers';
import { sealForEngine } from '#utils/security/seal.util';

describe('sealForEngine', () => {
  test('seals bytes only the matching private key can open', async () => {
    await sodium.ready;
    const { publicKey, privateKey } = sodium.crypto_box_keypair();
    const plaintext = new TextEncoder().encode('{"pin":"1234"}');

    const sealed = await sealForEngine(plaintext, publicKey);

    expect(sodium.crypto_box_seal_open(sealed, publicKey, privateKey)).toEqual(plaintext);
  });

  test('produces different bytes on every call', async () => {
    await sodium.ready;
    const { publicKey } = sodium.crypto_box_keypair();
    const plaintext = new TextEncoder().encode('same');

    const first = await sealForEngine(plaintext, publicKey);
    const second = await sealForEngine(plaintext, publicKey);

    expect(first).not.toEqual(second);
  });
});
