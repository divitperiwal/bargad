import { z } from 'zod';
import { paiseSchema } from './common';

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(200) });

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(80),
    monthlyIncomePaise: paiseSchema.nullable(),
    monthlyExpensesPaise: paiseSchema.nullable(),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
