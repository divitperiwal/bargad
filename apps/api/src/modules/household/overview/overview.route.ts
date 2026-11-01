import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { OverviewController } from './overview.controller';

export const overviewRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/', ...OverviewController.get)
  .get('/members/:userId', ...OverviewController.member);
