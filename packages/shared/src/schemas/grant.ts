import { z } from 'zod';
import { paiseSchema, uuidSchema } from './common';
import { assertionSchema } from './passkey';

// A member's time-limited, rupee-capped consent for the head to place baskets without asking each time.
export const createGrantSchema = z.object({
  durationMinutes: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 60),
  buyCapPaise: paiseSchema,
  sellCapPaise: paiseSchema,
  perOrderCapPaise: paiseSchema.min(1),
  brokerAccountId: uuidSchema.optional(),
  allowedInstrumentIds: z
    .array(uuidSchema)
    .min(1)
    .max(200)
    .refine((ids) => new Set(ids).size === ids.length, 'List each instrument once')
    .optional(),
  assertion: assertionSchema,
});

// role picks the grants the caller gave (grantor) or received (grantee).
export const listGrantsQuerySchema = z.object({
  role: z.enum(['grantor', 'grantee']).default('grantor'),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type CreateGrantInput = z.infer<typeof createGrantSchema>;
export type ListGrantsQuery = z.infer<typeof listGrantsQuerySchema>;
