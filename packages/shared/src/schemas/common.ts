import { z } from 'zod';

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// Money is always integer paise.
export const paiseSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const uuidSchema = z.uuid();
