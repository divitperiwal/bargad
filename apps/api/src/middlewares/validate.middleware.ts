import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';
import { ApiError } from '#utils/http/error.util';

type Target = keyof ValidationTargets;

// Checks one part of the request (json, query, param...) against a schema; read the result with c.req.valid(target).
export function validate<T extends Target, S extends z.ZodType>(target: T, schema: S) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ApiError(400, 'Invalid request', { issues: z.flattenError(result.error).fieldErrors });
    }
  });
}
