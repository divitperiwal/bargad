import { and, isNull } from 'drizzle-orm';
import { families, familyMembers, invites } from '#database/schema';

export type Relationship = 'self' | 'spouse' | 'dependent_child' | 'dependent_parent' | 'other';

export type Membership = {
  memberId: string;
  familyId: string;
  userId: string;
  role: 'head' | 'member';
  relationship: Relationship | null;
  canTrade: boolean;
};

export const membershipColumns = {
  memberId: familyMembers.id,
  familyId: familyMembers.familyId,
  userId: familyMembers.userId,
  role: familyMembers.role,
  relationship: familyMembers.relationship,
  canTrade: familyMembers.canTrade,
};

export const toMembership = (row: {
  memberId: string;
  familyId: string;
  userId: string;
  role: string;
  relationship: string | null;
  canTrade: boolean | null;
}): Membership => ({
  ...row,
  role: row.role as Membership['role'],
  relationship: row.relationship as Relationship | null,
  canTrade: row.canTrade ?? false,
});

export const active = isNull(familyMembers.leftAt);

export const familyColumns = { id: families.id, name: families.name, createdAt: families.createdAt };

export const inviteColumns = {
  id: invites.id,
  email: invites.email,
  relationship: invites.relationship,
  expiresAt: invites.expiresAt,
};

// Pending means not accepted and not revoked, expired or not.
export const pending = and(isNull(invites.acceptedAt), isNull(invites.revokedAt));
