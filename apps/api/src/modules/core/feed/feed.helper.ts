import { z } from 'zod';
import { ApiError } from '#utils/http/error.util';
import { decodeCursor, isRealTimestamp } from '#utils/http/pagination.util';

export const BIGINT_MAX = 2n ** 63n - 1n;

export const cursorSchema = z.object({
  at: z.string().refine(isRealTimestamp),
  id: z
    .string()
    .regex(/^\d{1,19}$/)
    .refine((id) => BigInt(id) <= BIGINT_MAX),
});

export const parseCursor = (cursor: string) => {
  const parsed = cursorSchema.safeParse(decodeCursor<unknown>(cursor));
  if (!parsed.success) throw new ApiError(400, 'Invalid cursor', { code: 'invalid_cursor' });
  return parsed.data;
};
