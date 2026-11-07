import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { InstrumentController } from './instrument.controller';

export const instrumentRoutes = new Hono<AuthEnv>().use(requireUser).get('/', ...InstrumentController.search);
