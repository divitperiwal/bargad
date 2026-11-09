import { sql } from 'drizzle-orm';
import { grants } from '#database/schema';
import { headSeesRecord } from '#modules/families/family/visibility.query';
import { toIso, toIsoOrNull } from '#utils/time/time.util';

// Status by the database clock, so every caller agrees on when a grant ends.
export const status = sql<'active' | 'expired' | 'revoked'>`case
  when ${grants.revokedAt} is not null then 'revoked'
  when ${grants.expiresAt} <= now() then 'expired'
  else 'active' end`;

export const grantColumns = {
  id: grants.id,
  familyId: grants.familyId,
  grantorUserId: grants.grantorUserId,
  granteeUserId: grants.granteeUserId,
  brokerAccountId: grants.brokerAccountId,
  allowedInstrumentIds: grants.allowedInstrumentIds,
  startsAt: grants.startsAt,
  expiresAt: grants.expiresAt,
  buyCapPaise: grants.buyCapPaise,
  sellCapPaise: grants.sellCapPaise,
  perOrderCapPaise: grants.perOrderCapPaise,
  buySpentPaise: grants.buySpentPaise,
  sellSpentPaise: grants.sellSpentPaise,
  revokedAt: grants.revokedAt,
  revokeReason: grants.revokeReason,
  status,
};

export type GrantRow = {
  startsAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

export const toGrant = <T extends GrantRow>(row: T) => ({
  ...row,
  startsAt: toIso(row.startsAt),
  expiresAt: toIso(row.expiresAt),
  revokedAt: toIsoOrNull(row.revokedAt),
});

export type NewGrant = {
  familyId: string;
  grantorUserId: string;
  granteeUserId: string;
  brokerAccountId?: string;
  allowedInstrumentIds?: string[];
  buyCapPaise: number;
  sellCapPaise: number;
  perOrderCapPaise: number;
};

// The viewer still heads the grant's family, the grantor is still in it, and the grant is from their current membership.
export const headSeesGrant = (viewerId: string) =>
  headSeesRecord(viewerId, {
    familyId: grants.familyId,
    ownerUserId: grants.grantorUserId,
    createdAt: grants.createdAt,
  });

export type RevokeReason = 'member' | 'admin';
