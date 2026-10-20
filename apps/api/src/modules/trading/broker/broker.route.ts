import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { BrokerController } from './broker.controller';

export const brokerRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/', ...BrokerController.list)
  .post('/', ...BrokerController.link)
  .patch('/:id', ...BrokerController.update)
  .put('/:id/credentials', ...BrokerController.setCredentials)
  .delete('/:id/credentials', ...BrokerController.removeCredentials);
