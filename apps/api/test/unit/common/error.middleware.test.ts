import { expect, spyOn, test } from 'bun:test';
import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '#config/logger.config';
import { errorHandler, notFoundHandler } from '#middlewares/error.middleware';
import { validate } from '#middlewares/validate.middleware';
import { ApiError } from '#utils/http/error.util';
import { sendSuccess } from '#utils/http/response.util';

const app = new Hono()
  .onError(errorHandler)
  .notFound(notFoundHandler)
  .post('/echo', validate('json', z.object({ n: z.number() })), (c) => sendSuccess(c, c.req.valid('json'), 201))
  .get('/teapot', () => {
    throw new ApiError(418, 'short and stout');
  })
  .get('/duplicate', () => {
    throw new Error('insert failed', { cause: { errno: '23505' } });
  })
  .get('/taken', () => {
    throw new ApiError(409, 'Taken', { code: 'email_taken' });
  })
  .get('/boom', () => {
    throw new Error('secret detail');
  });

const post = (body: string) =>
  app.request('/echo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });

test('successes use one envelope', async () => {
  const res = await post(JSON.stringify({ n: 1 }));
  expect(res.status).toBe(201);
  expect(await res.json()).toEqual({ success: true, data: { n: 1 } });
});

test('errors use one envelope and hide internals', async () => {
  const notFound = await app.request('/nowhere');
  expect(notFound.status).toBe(404);
  expect(await notFound.json()).toEqual({ success: false, error: 'Not found', code: 'not_found' });

  const teapot = await app.request('/teapot');
  expect(teapot.status).toBe(418);
  expect(await teapot.json()).toEqual({ success: false, error: 'short and stout', code: 'internal' });

  const duplicate = await app.request('/duplicate');
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toEqual({ success: false, error: 'That already exists', code: 'conflict' });

  const boom = await app.request('/boom');
  expect(boom.status).toBe(500);
  const boomBody = await boom.json();
  expect(JSON.stringify(boomBody)).not.toContain('secret');
  expect(boomBody).toMatchObject({ success: false, code: 'internal' });
});

test('an explicit code overrides the one derived from the status', async () => {
  const res = await app.request('/taken');
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ success: false, error: 'Taken', code: 'email_taken' });
});

test('an unexpected error is logged with the error itself', async () => {
  const boom = new Error('kaput');
  const failing = new Hono().onError(errorHandler).get('/fail', () => {
    throw boom;
  });
  const spy = spyOn(logger, 'error');

  try {
    expect((await failing.request('/fail')).status).toBe(500);
    expect(spy).toHaveBeenCalledWith({ err: boom }, 'unhandled error');
  } finally {
    spy.mockRestore();
  }
});

test('bad input is a 400 with field issues, including malformed JSON', async () => {
  const invalid = await post(JSON.stringify({ n: 'one' }));
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({
    success: false,
    error: 'Invalid request',
    code: 'invalid_request',
    issues: { n: expect.any(Array) },
  });

  const malformed = await post('{');
  expect(malformed.status).toBe(400);
  expect(await malformed.json()).toMatchObject({ success: false });
});
