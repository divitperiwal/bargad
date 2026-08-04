// Only a token's hash is stored, so a leaked table can't sign anyone in.
export const hashToken = (token: string) => new Bun.CryptoHasher('sha256').update(token).digest();
