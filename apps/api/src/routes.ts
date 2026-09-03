import { Hono } from 'hono';
import { authRoutes } from '#modules/accounts/auth/auth.route';
import { passkeyRoutes } from '#modules/accounts/passkey/passkey.route';
import { familyRoutes } from '#modules/families/family/family.route';
import { inviteRoutes } from '#modules/families/invite/invite.route';
import { sendSuccess } from './utils/http/response.util';

export const routes = new Hono()
  .get('/health', (c) => sendSuccess(c, { status: 'ok' }))
  .route('/auth', authRoutes)
  .route('/passkeys', passkeyRoutes)
  .route('/families', familyRoutes)
  .route('/invites', inviteRoutes);
