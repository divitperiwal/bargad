import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default('Bargad <onboarding@resend.dev>'),
  RP_ID: z.string().default('localhost'),
  RP_NAME: z.string().default('Bargad'),
  WEBAUTHN_ORIGINS: z.string().optional(),
  ENGINE_PUBLIC_KEY: z
    .string()
    .refine((key) => Buffer.from(key, 'base64').length === 32, 'must be base64 of 32 bytes')
    .optional(),
  ENGINE_KEY_VERSION: z.coerce.number().default(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export function parseEnv(source: Record<string, string | undefined>) {
  const env = schema.parse(source);
  const unsafe = !env.RESEND_API_KEY || env.RP_ID === 'localhost' || !env.WEB_ORIGIN.startsWith('https://');
  if (env.NODE_ENV === 'production' && unsafe) {
    throw new Error('Production needs RESEND_API_KEY, a real RP_ID and an https WEB_ORIGIN');
  }
  return env;
}

export const env = parseEnv(process.env);
