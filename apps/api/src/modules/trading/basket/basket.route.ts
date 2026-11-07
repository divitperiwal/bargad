import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { BasketController } from './basket.controller';

export const basketRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/', ...BasketController.list)
  .get('/:id', ...BasketController.get)
  .post('/', ...BasketController.create)
  .post('/:id/approval', ...BasketController.approve)
  .post('/:id/rejection', ...BasketController.reject)
  .delete('/:id', ...BasketController.cancel);
