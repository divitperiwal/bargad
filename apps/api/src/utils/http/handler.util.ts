import { createFactory } from 'hono/factory';
import type { AuthEnv } from '#types/hono.types';

export const { createHandlers } = createFactory<AuthEnv>();
