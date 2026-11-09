import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { GrantController } from './grant.controller';

export const grantRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/', ...GrantController.list)
  .post('/', ...GrantController.create)
  .delete('/:id', ...GrantController.revoke);
