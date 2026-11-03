import { Hono } from 'hono';
import { authRoutes } from '#modules/accounts/auth/auth.route';
import { passkeyRoutes } from '#modules/accounts/passkey/passkey.route';
import { userRoutes } from '#modules/accounts/user/user.route';
import { feedRoutes } from '#modules/core/feed/feed.route';
import { familyRoutes } from '#modules/families/family/family.route';
import { inviteRoutes } from '#modules/families/invite/invite.route';
import { ledgerRoutes } from '#modules/household/ledger/ledger.route';
import { overviewRoutes } from '#modules/household/overview/overview.route';
import { brokerRoutes } from '#modules/trading/broker/broker.route';
import { instrumentRoutes } from '#modules/trading/instrument/instrument.route';
import { sendSuccess } from './utils/http/response.util';

export const routes = new Hono()
  .get('/health', (c) => sendSuccess(c, { status: 'ok' }))
  .route('/auth', authRoutes)
  .route('/passkeys', passkeyRoutes)
  .route('/broker-accounts', brokerRoutes)
  .route('/families', familyRoutes)
  .route('/invites', inviteRoutes)
  .route('/feed', feedRoutes)
  .route('/household', overviewRoutes)
  .route('/instruments', instrumentRoutes)
  .route('/ledger-entries', ledgerRoutes)
  .route('/users', userRoutes);
