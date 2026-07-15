import type { MiddlewareHandler } from 'hono';
import { logger } from '#config/logger.config';

// Probes hit this every few seconds; logging them buries real traffic.
const QUIET_PATHS = new Set(['/health']);

export const requestLogger: MiddlewareHandler = async (c, next) => {
  if (QUIET_PATHS.has(c.req.path)) return next();

  const start = performance.now();
  await next();

  const { status } = c.res;
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  // Path only, never the query string, which can carry tokens.
  logger[level](
    { method: c.req.method, path: c.req.path, status, durationMs: Math.round(performance.now() - start) },
    'request completed',
  );
};
