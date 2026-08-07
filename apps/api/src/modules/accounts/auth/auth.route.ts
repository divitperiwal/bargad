import { Hono } from 'hono';
import { RATE_LIMITS } from '#constant';
import { requireUser } from '#middlewares/auth.middleware';
import { rateLimit } from '#middlewares/ratelimit.middleware';
import { PasskeyController } from '#modules/accounts/passkey/passkey.controller';
import type { AuthEnv } from '#types/hono.types';
import { AuthController } from './auth.controller';

export const authRoutes = new Hono<AuthEnv>()
  .post('/signup', rateLimit(RATE_LIMITS.signup), ...AuthController.signup)
  .post('/login', rateLimit(RATE_LIMITS.login), ...AuthController.login)
  .post('/logout', requireUser, ...AuthController.logout)
  .post('/password/forgot', rateLimit(RATE_LIMITS.passwordForgot), ...AuthController.forgotPassword)
  .post('/password/reset', rateLimit(RATE_LIMITS.passwordReset), ...AuthController.resetPassword)
  .post('/passkey/options', rateLimit(RATE_LIMITS.passkeyOptions), ...PasskeyController.loginOptions)
  .post('/passkey/login', rateLimit(RATE_LIMITS.passkeyLogin), ...PasskeyController.login)
  .get('/me', requireUser, ...AuthController.me);
