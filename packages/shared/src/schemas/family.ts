import { z } from 'zod';
import { uuidSchema } from './common';

const email = z.string().trim().toLowerCase().pipe(z.email());

export const relationshipSchema = z.enum([
  'spouse',
  'dependent_child',
  'dependent_parent',
  'other',
]);

export const createFamilySchema = z.object({ name: z.string().trim().min(1).max(60) });

export const inviteMemberSchema = z.object({ email, relationship: relationshipSchema });

export const handoverSchema = z.object({ toMemberId: uuidSchema });

export const declareRelationshipSchema = z.object({ relationship: relationshipSchema });

export const inviteTokenParam = z.object({ token: z.string().min(20).max(200) });

export type CreateFamilyInput = z.infer<typeof createFamilySchema>;
export type HandoverInput = z.infer<typeof handoverSchema>;
export type DeclareRelationshipInput = z.infer<typeof declareRelationshipSchema>;
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;
