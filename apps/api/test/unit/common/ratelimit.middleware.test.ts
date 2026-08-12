import { beforeEach, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { errorHandler } from '#middlewares/error.middleware';
import { rateLimit, rateLimitSize, resetRateLimits } from '#middlewares/ratelimit.middleware';

const app = new Hono()
  .onError(errorHandler)
  .get('/a', rateLimit({ name: 't', limit: 2, windowMs: 60_000 }), (c) => c.text('ok'))
  .get('/b', rateLimit({ name: 'other', limit: 2, windowMs: 60_000 }), (c) => c.text('ok'));

const hit = (path = '/a', ip?: string) => app.request(path, { headers: ip ? { 'X-Forwarded-For': ip } : {} });

beforeEach(resetRateLimits);

test('requests within the limit pass and report the remaining budget', async () => {
  const first = await hit();
  expect(first.status).toBe(200);
  expect(first.headers.get('X-RateLimit-Limit')).toBe('2');
  expect(first.headers.get('X-RateLimit-Remaining')).toBe('1');

  const second = await hit();
  expect(second.status).toBe(200);
  expect(second.headers.get('X-RateLimit-Remaining')).toBe('0');
});

test('the request over the limit is a 429 with retry headers', async () => {
  await hit();
  await hit();
  const res = await hit();

  expect(res.status).toBe(429);
  expect(await res.json()).toMatchObject({ success: false, code: 'rate_limited' });
  expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  const reset = Number(res.headers.get('X-RateLimit-Reset'));
  expect(reset).toBeGreaterThan(Date.now() / 1000);
});

test('each client has its own budget, keyed by the first forwarded hop', async () => {
  await hit('/a', '1.1.1.1, 9.9.9.9');
  await hit('/a', '1.1.1.1');
  expect((await hit('/a', '1.1.1.1')).status).toBe(429);
  expect((await hit('/a', '2.2.2.2, 9.9.9.9')).status).toBe(200);
});

test('resetRateLimits gives everyone a fresh budget', async () => {
  await hit();
  await hit();
  expect((await hit()).status).toBe(429);

  resetRateLimits();
  expect((await hit()).status).toBe(200);
});

test('limiters with different names do not share a budget', async () => {
  await hit('/a');
  await hit('/a');
  expect((await hit('/a')).status).toBe(429);
  expect((await hit('/b')).status).toBe(200);
});

test('expired windows are swept so the counter map does not grow without bound', async () => {
  const realNow = Date.now;
  let now = realNow();
  Date.now = () => now;
  try {
    for (const ip of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) await hit('/a', ip);
    expect(rateLimitSize()).toBe(3);

    now += 2 * 60_000;
    await hit('/a', '4.4.4.4');
    expect(rateLimitSize()).toBe(1);
  } finally {
    Date.now = realNow;
  }
});

test('the counter map is capped even when no window has expired', async () => {
  for (let i = 0; i < 10_050; i++) await hit('/a', `10.0.${i >> 8}.${i & 255}`);
  expect(rateLimitSize()).toBeLessThanOrEqual(10_000);
});
