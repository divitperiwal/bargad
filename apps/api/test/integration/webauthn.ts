// A software passkey for tests: an ES256 authenticator that answers WebAuthn options the way a browser would.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { app } from '#app';

const DEFAULT_ORIGIN = 'http://localhost:3000';
const DEFAULT_RP_ID = 'localhost';

const USER_PRESENT = 0x01;
const USER_VERIFIED = 0x04;
const ATTESTED_CREDENTIAL = 0x40;

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

// Just enough CBOR for an attestation object and a COSE key: ints, byte and text strings, maps.
function cborHead(major: number, length: number): number[] {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  throw new Error('cbor value too long');
}

function cbor(value: Cbor): Uint8Array {
  if (typeof value === 'number') {
    return Uint8Array.from(value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value));
  }
  if (typeof value === 'string') {
    const text = new TextEncoder().encode(value);
    return concat(Uint8Array.from(cborHead(3, text.length)), text);
  }
  if (value instanceof Uint8Array) return concat(Uint8Array.from(cborHead(2, value.length)), value);
  const entries = [...value].flatMap(([key, item]) => [cbor(key), cbor(item)]);
  return concat(Uint8Array.from(cborHead(5, value.size)), ...entries);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  return Uint8Array.from(Buffer.concat(parts));
}

const sha256 = (data: Uint8Array | string) => Uint8Array.from(createHash('sha256').update(data).digest());
const base64url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');

function uint32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
}

function clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): string {
  return JSON.stringify({ type, challenge, origin, crossOrigin: false });
}

export type Authenticator = {
  register(options: PublicKeyCredentialCreationOptionsJSON, call?: { origin?: string }): RegistrationResponseJSON;
  // userVerified: false clears the UV flag, as an authenticator that skipped the PIN or biometric would.
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    call?: { origin?: string; userVerified?: boolean },
  ): AuthenticationResponseJSON;
};

export function createAuthenticator(): Authenticator {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = cbor(
    new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x ?? '', 'base64url')],
      [-3, Buffer.from(jwk.y ?? '', 'base64url')],
    ]),
  );
  const rawId = crypto.getRandomValues(new Uint8Array(32));
  const credentialId = base64url(rawId);
  let userHandle: string | undefined;
  // Like a synced passkey, the sign count stays 0, so only a spent challenge stops a replay.
  const counter = 0;

  return {
    register(options, call = {}) {
      userHandle = options.user.id;
      const clientDataJSON = clientData('webauthn.create', options.challenge, call.origin ?? DEFAULT_ORIGIN);
      const authData = concat(
        sha256(options.rp.id ?? DEFAULT_RP_ID),
        Uint8Array.of(USER_PRESENT | USER_VERIFIED | ATTESTED_CREDENTIAL),
        uint32(counter),
        new Uint8Array(16), // aaguid: none
        Uint8Array.of(rawId.length >> 8, rawId.length & 0xff),
        rawId,
        coseKey,
      );
      const attestationObject = cbor(
        new Map<Cbor, Cbor>([
          ['fmt', 'none'],
          ['attStmt', new Map()],
          ['authData', authData],
        ]),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: base64url(clientDataJSON),
          attestationObject: base64url(attestationObject),
          transports: ['internal'],
        },
      };
    },

    authenticate(options, call = {}) {
      const clientDataJSON = clientData('webauthn.get', options.challenge, call.origin ?? DEFAULT_ORIGIN);
      const authData = concat(
        sha256(options.rpId ?? DEFAULT_RP_ID),
        Uint8Array.of(call.userVerified === false ? USER_PRESENT : USER_PRESENT | USER_VERIFIED),
        uint32(counter),
      );
      // ECDSA over authData || sha256(clientDataJSON); node returns the DER encoding WebAuthn expects.
      const signature = sign('sha256', concat(authData, sha256(clientDataJSON)), privateKey);
      return {
        id: credentialId,
        rawId: credentialId,
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(authData),
          signature: base64url(signature),
          userHandle,
        },
      };
    },
  };
}

async function postJson(path: string, body: unknown, headers: Record<string, string>) {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} answered ${res.status}: ${JSON.stringify(json)}`);
  return json.data;
}

async function userIdOf(headers: Record<string, string>): Promise<string> {
  const res = await app.request('/auth/me', { headers });
  return (await res.json()).data.user.id;
}

// A passkey_manage step-up signed by an existing passkey, for adding or removing another.
export async function signPasskeyManage(headers: Record<string, string>, existing: Authenticator) {
  return signStepUp(headers, existing, 'passkey_manage', await userIdOf(headers));
}

// Drives both registration endpoints as the signed-in user. A user who already has a passkey
// must pass it as `existing`, which signs the passkey_manage step-up.
export async function registerPasskey(
  headers: Record<string, string>,
  authenticator: Authenticator = createAuthenticator(),
  existing?: Authenticator,
): Promise<{ passkeyId: string; authenticator: Authenticator }> {
  const body = existing ? { assertion: await signPasskeyManage(headers, existing) } : {};
  const { challengeId, options } = await postJson('/passkeys/registration-options', body, headers);
  const response = authenticator.register(options);
  const { passkey } = await postJson('/passkeys', { challengeId, response, name: 'Test passkey' }, headers);
  return { passkeyId: passkey.id, authenticator };
}

// Asks for a step-up challenge and signs it, ready to pass to PasskeyService.verifyStepUp.
export async function signStepUp(
  headers: Record<string, string>,
  authenticator: Authenticator,
  purpose: 'approve' | 'credentials' | 'grant' | 'passkey_manage',
  targetId: string,
): Promise<{ challengeId: string; response: unknown }> {
  const { challengeId, options } = await postJson('/passkeys/challenges', { purpose, targetId }, headers);
  return { challengeId, response: authenticator.authenticate(options) };
}
