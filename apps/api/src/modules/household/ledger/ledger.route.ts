import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { LedgerController } from './ledger.controller';

export const ledgerRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/', ...LedgerController.list)
  .post('/', ...LedgerController.create)
  .patch('/:id', ...LedgerController.update)
  .delete('/:id', ...LedgerController.remove);
