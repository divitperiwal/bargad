import type { Context, MiddlewareHandler } from 'hono';
import { getConnInfo } from 'hono/bun';
import { ApiError } from '#utils/http/error.util';

type Window = { count: number; resetAt: number };

const MAX_KEYS = 10_000;
const SWEEP_EVERY_MS = 60_000;

const windows = new Map<string, Window>();
let nextSweepAt = 0;

function sweep(now: number): void {
  for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
  nextSweepAt = now + SWEEP_EVERY_MS;
}

// Test hook: forget every counter so each test starts with a full budget.
export function resetRateLimits(): void {
  windows.clear();
  nextSweepAt = 0;
}

export function rateLimitSize(): number {
  return windows.size;
}

// The first X-Forwarded-For hop (we sit behind Caddy), else the socket address, so a proxy
// that drops the header does not put every visitor in one bucket.
function clientOf(c: Context): string {
  const forwarded = c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
  if (forwarded) return forwarded;
  try {
    return getConnInfo(c).remote.address ?? 'local';
  } catch {
    return 'local'; // app.request() in tests has no server behind it
  }
}

// In-memory fixed window per limiter name and client; counters live in this process only.
// Expired windows are swept once a minute and the map is capped, so spoofed keys cannot exhaust memory.
export function rateLimit(options: { name: string; limit: number; windowMs: number }): MiddlewareHandler {
  return async (c, next) => {
    const key = `${options.name}:${clientOf(c)}`;
    const now = Date.now();

    if (now >= nextSweepAt) sweep(now);

    let entry = windows.get(key);
    if (!entry || entry.resetAt <= now) {
      if (windows.size >= MAX_KEYS) windows.delete(windows.keys().next().value as string);
      entry = { count: 0, resetAt: now + options.windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;

    const resetSeconds = Math.ceil(entry.resetAt / 1000);
    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.limit - entry.count)));
    c.header('X-RateLimit-Reset', String(resetSeconds));

    if (entry.count > options.limit) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      throw new ApiError(429, 'Too many requests, try again soon');
    }
    await next();
  };
}
