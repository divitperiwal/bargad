import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { PasskeyController } from './passkey.controller';

export const passkeyRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .post('/registration-options', ...PasskeyController.registrationOptions)
  .post('/', ...PasskeyController.register)
  .post('/challenges', ...PasskeyController.stepUpChallenge)
  .get('/', ...PasskeyController.list)
  .patch('/:id', ...PasskeyController.rename)
  .delete('/:id', ...PasskeyController.remove);
