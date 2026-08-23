import { passkeys } from '#database/schema';
import { toIso, toIsoOrNull } from '#utils/time/time.util';

export const publicPasskey = {
  id: passkeys.id,
  name: passkeys.name,
  createdAt: passkeys.createdAt,
  lastUsedAt: passkeys.lastUsedAt,
};

export const storedCredential = {
  id: passkeys.id,
  credentialId: passkeys.credentialId,
  publicKey: passkeys.publicKey,
  signCount: passkeys.signCount,
  transports: passkeys.transports,
};

export const toPublic = (row: { id: string; name: string; createdAt: string; lastUsedAt: string | null }) => ({
  ...row,
  createdAt: toIso(row.createdAt),
  lastUsedAt: toIsoOrNull(row.lastUsedAt),
});

export type ChallengeMatch = { id: string; userId: string | null; purpose: string; targetId: string | null };
