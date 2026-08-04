// 32 random bytes as base64url: the raw session token handed to the client.
export function generateToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}
