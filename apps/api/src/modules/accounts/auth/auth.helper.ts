import type { Context } from 'hono';
import { setCookie } from 'hono/cookie';
import { IS_PRODUCTION, SESSION_COOKIE, SESSION_COOKIE_OPTIONS, SESSION_MAX_AGE_SECONDS } from '#constant';
import type { User } from '#types/hono.types';
import { sendSuccess } from '#utils/http/response.util';

// Web gets the token as an HttpOnly cookie, the app gets it in the body.
export function respondSignedIn(c: Context, client: 'web' | 'app', signedIn: SignedIn, status: 200 | 201) {
  const { user, token } = signedIn;
  if (client === 'app') return sendSuccess(c, { user, token }, status);

  setCookie(c, SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    secure: IS_PRODUCTION,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return sendSuccess(c, { user }, status);
}

export type SignedIn = { user: User; token: string; expiresAt: Date };

// Verified when the email is unknown, so a miss costs as much as a wrong password.
export const dummyHash = await Bun.password.hash('not-a-real-password', 'argon2id');
