import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from '#constant';
import { AuthRepository } from '#modules/accounts/auth/auth.repository';
import type { AuthEnv } from '#types/hono.types';
import { ApiError } from '#utils/http/error.util';
import { hashToken } from '#utils/security/crypto.util';

// Web sends the token in a cookie, the app as "Authorization: Bearer <token>".
function readSessionToken(c: Context) {
  const cookie = getCookie(c, SESSION_COOKIE);
  if (cookie) return cookie;

  const header = c.req.header('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

export const requireUser = createMiddleware<AuthEnv>(async (c, next) => {
  const token = readSessionToken(c);
  if (!token) throw new ApiError(401, 'Not signed in');

  const sessionHash = hashToken(token);
  const user = await AuthRepository.findUserBySessionHash(sessionHash);
  if (!user) throw new ApiError(401, 'Not signed in');

  c.set('user', user);
  c.set('sessionHash', sessionHash);
  await next();
});
