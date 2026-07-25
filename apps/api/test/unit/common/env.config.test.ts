import { describe, expect, test } from 'bun:test';
import { parseEnv } from '#config/env.config';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/bargad' };
const production = {
  ...base,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_test',
  RP_ID: 'bargad.in',
  WEB_ORIGIN: 'https://bargad.in',
};

describe('parseEnv', () => {
  test('fills development defaults', () => {
    expect(parseEnv(base)).toMatchObject({ NODE_ENV: 'development', RP_ID: 'localhost', API_PORT: 4000 });
  });

  test('accepts a complete production environment', () => {
    expect(parseEnv(production).NODE_ENV).toBe('production');
  });

  test.each([
    ['no Resend key', { RESEND_API_KEY: undefined }],
    ['RP_ID localhost', { RP_ID: 'localhost' }],
    ['an http web origin', { WEB_ORIGIN: 'http://bargad.in' }],
  ])('refuses production with %s', (_name, change) => {
    expect(() => parseEnv({ ...production, ...change })).toThrow();
  });
});
