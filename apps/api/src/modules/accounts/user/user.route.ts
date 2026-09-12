import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { UserController } from './user.controller';

export const userRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/me', ...UserController.profile)
  .patch('/me', ...UserController.update)
  .delete('/me', ...UserController.remove);
