import { createMiddleware } from 'hono/factory';
import type { AuthEnv } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';

// Use after requireUser.
export const requireAdmin = createMiddleware<AuthEnv>(async (c, next) => {
  if (!c.var.user.isAdmin) throw new ApiError(403, 'Only admins can do this');
  await next();
});
