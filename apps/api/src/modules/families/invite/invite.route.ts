import { Hono } from 'hono';
import { RATE_LIMITS } from '#constant';
import { requireUser } from '#middlewares/auth.middleware';
import { rateLimit } from '#middlewares/ratelimit.middleware';
import type { AuthEnv } from '#types/hono.types';
import { InviteController } from './invite.controller';

export const familyInviteRoutes = new Hono<AuthEnv>()
  .post('/', ...InviteController.send)
  .get('/', ...InviteController.listPending)
  .delete('/:id', ...InviteController.revoke);

export const inviteRoutes = new Hono<AuthEnv>()
  .get('/:token', rateLimit(RATE_LIMITS.invitePreview), ...InviteController.preview)
  .post('/:token/acceptance', requireUser, ...InviteController.accept);
