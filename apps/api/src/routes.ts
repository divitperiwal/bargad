import { Hono } from 'hono';
import { authRoutes } from '#modules/accounts/auth/auth.route';
import { passkeyRoutes } from '#modules/accounts/passkey/passkey.route';
import { sendSuccess } from './utils/http/response.util';

export const routes = new Hono()
  .get('/health', (c) => sendSuccess(c, { status: 'ok' }))
  .route('/auth', authRoutes)
  .route('/passkeys', passkeyRoutes);
