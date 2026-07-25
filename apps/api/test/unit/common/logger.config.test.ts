import { expect, test } from 'bun:test';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import { requestId } from 'hono/request-id';
import { createLogger } from '#config/logger.config';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger('info', { write: (line: string) => void lines.push(JSON.parse(line)) });
  return { logger, lines };
}

test('a database error keeps its query and code but not its parameters or detail', () => {
  const { logger, lines } = capture();
  const cause = Object.assign(new Error('duplicate key'), {
    errno: '23505',
    detail: 'Key (email)=(secret@x.com) already exists',
  });
  const err = new Error(
    'Failed query: insert into "users" ("email") values ($1)\nparams: secret@x.com,$argon2id$hash',
    {
      cause,
    },
  );

  logger.error({ err }, 'unhandled error');

  const text = JSON.stringify(lines);
  expect(text).not.toContain('secret@x.com');
  expect(text).not.toContain('argon2id');
  expect(text).toContain('Failed query: insert into');
  expect(text).toContain('23505');
  expect(lines[0]).toMatchObject({ level: 'error', msg: 'unhandled error', service: 'api' });
});

test('secret fields are redacted at the top level and one level down', () => {
  const { logger, lines } = capture();
  logger.info({ password: 'hunter2', body: { token: 'abc', email: 'a@b.test' } }, 'x');

  expect(lines[0]).toMatchObject({ password: '[redacted]', body: { token: '[redacted]', email: 'a@b.test' } });
});

test('lines written during a request carry its id, even from work the handler did not await', async () => {
  const { logger, lines } = capture();
  let background: Promise<void> | undefined;
  const app = new Hono()
    .use(contextStorage())
    .use(requestId())
    .get('/', (c) => {
      background = Promise.resolve().then(() => logger.warn('later'));
      return c.text('ok');
    });

  await app.request('/', { headers: { 'X-Request-Id': 'req-123' } });
  await background;
  logger.info('outside');

  expect(lines[0]).toMatchObject({ msg: 'later', requestId: 'req-123' });
  expect(lines[1]).not.toHaveProperty('requestId');
});
