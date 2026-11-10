import { Hono } from 'hono';
import { requireAdmin } from '#middlewares/admin.middleware';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { AdminController } from './admin.controller';

export const adminRoutes = new Hono<AuthEnv>()
  .use(requireUser, requireAdmin)
  .get('/kill-switches', ...AdminController.listKillSwitches)
  .put('/kill-switches', ...AdminController.setKillSwitch)
  .delete('/broker-accounts/:id/credentials', ...AdminController.revokeCredentials);
