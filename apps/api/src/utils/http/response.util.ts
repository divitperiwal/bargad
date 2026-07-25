import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Every success body is { success: true, data }; errorHandler sends { success: false, error, issues? }.
export function sendSuccess<T, S extends ContentfulStatusCode = 200>(c: Context, data: T, status: S = 200 as S) {
  return c.json({ success: true as const, data }, status);
}
