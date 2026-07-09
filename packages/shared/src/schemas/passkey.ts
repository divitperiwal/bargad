import { z } from 'zod';

// The browser's PublicKeyCredential as JSON; the WebAuthn library checks the rest.
const credentialSchema = z.looseObject({
  id: z.string(),
  rawId: z.string(),
  type: z.literal('public-key'),
  response: z.looseObject({}),
});

const passkeyName = z.string().trim().min(1).max(60);

export const assertionSchema = z.object({ challengeId: z.uuid(), response: credentialSchema });

export const registerPasskeySchema = z.object({
  challengeId: z.uuid(),
  response: credentialSchema,
  name: passkeyName,
});

export const renamePasskeySchema = z.object({ name: passkeyName });

// Once a user has a passkey, adding or removing one needs a step-up from an existing passkey.
export const managePasskeySchema = z.object({ assertion: assertionSchema.optional() });

export const stepUpPurposes = ['approve', 'credentials', 'grant', 'passkey_manage'] as const;
export type StepUpPurpose = (typeof stepUpPurposes)[number];

export const stepUpChallengeSchema = z.object({
  purpose: z.enum(stepUpPurposes),
  targetId: z.uuid(),
});

export const passkeyLoginSchema = assertionSchema.extend({ client: z.enum(['web', 'app']) });

export type AssertionInput = z.infer<typeof assertionSchema>;
export type RegisterPasskeyInput = z.infer<typeof registerPasskeySchema>;
export type ManagePasskeyInput = z.infer<typeof managePasskeySchema>;
export type RenamePasskeyInput = z.infer<typeof renamePasskeySchema>;
export type StepUpChallengeInput = z.infer<typeof stepUpChallengeSchema>;
export type PasskeyLoginInput = z.infer<typeof passkeyLoginSchema>;
