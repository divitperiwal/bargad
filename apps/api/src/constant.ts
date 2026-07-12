import { env } from '#config/env.config';

export const SESSION_COOKIE = 'session';
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE_OPTIONS = { httpOnly: true, sameSite: 'Lax', path: '/' } as const;

export const PASSWORD_RESET_MINUTES = 30;
export const PASSKEY_CHALLENGE_MS = 5 * 60_000;

const MINUTE = 60_000;
export const RATE_LIMITS = {
  signup: { name: 'signup', limit: 5, windowMs: MINUTE },
  login: { name: 'login', limit: 10, windowMs: MINUTE },
  passwordForgot: { name: 'password-forgot', limit: 3, windowMs: MINUTE },
  passwordReset: { name: 'password-reset', limit: 10, windowMs: MINUTE },
  passkeyOptions: { name: 'passkey-options', limit: 10, windowMs: MINUTE },
  passkeyLogin: { name: 'passkey-login', limit: 10, windowMs: MINUTE },
  invitePreview: { name: 'invite-preview', limit: 20, windowMs: MINUTE },
} as const;

export const RESEND_URL = 'https://api.resend.com/emails';

export const PORT = env.API_PORT;
export const IS_PRODUCTION = env.NODE_ENV === 'production';
export const WEB_ORIGIN = env.WEB_ORIGIN;
export const CORS_OPTIONS = { origin: env.WEB_ORIGIN, credentials: true };
