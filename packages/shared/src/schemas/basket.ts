import { z } from 'zod';
import { paginationQuerySchema, uuidSchema } from './common';
import { assertionSchema } from './passkey';

export const basketModes = ['self', 'approval', 'grant'] as const;

const basketItemSchema = z.object({
  brokerAccountId: uuidSchema,
  instrumentId: uuidSchema,
  side: z.enum(['buy', 'sell']),
  quantity: z.number().int().min(1).max(1_000_000),
});

export const createBasketSchema = z
  .object({
    ownerUserId: uuidSchema,
    mode: z.enum(basketModes),
    grantId: uuidSchema.optional(),
    bandBps: z.number().int().min(1).max(1000).default(100),
    items: z.array(basketItemSchema).min(1).max(50),
  })
  .refine((body) => (body.mode === 'grant') === (body.grantId !== undefined), {
    path: ['grantId'],
    message: 'A grant id goes with grant mode only',
  });

// The price the member saw for each item when approving.
export const approveBasketSchema = z.object({
  assertion: assertionSchema,
  items: z
    .array(
      z.object({
        itemId: uuidSchema,
        refPricePaise: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
      }),
    )
    .min(1)
    .max(50),
});

export const basketStatuses = [
  'proposed',
  'queued',
  'executing',
  'done',
  'rejected',
  'cancelled',
  'expired',
] as const;

// role picks the baskets traded for the caller (owner) or the ones they made (creator).
export const listBasketsQuerySchema = paginationQuerySchema.extend({
  role: z.enum(['owner', 'creator']).default('owner'),
  status: z.enum(basketStatuses).optional(),
});

export const instrumentSearchSchema = z.object({ q: z.string().trim().min(1).max(20) });

export type CreateBasketInput = z.infer<typeof createBasketSchema>;
export type ApproveBasketInput = z.infer<typeof approveBasketSchema>;
export type ListBasketsQuery = z.infer<typeof listBasketsQuerySchema>;
