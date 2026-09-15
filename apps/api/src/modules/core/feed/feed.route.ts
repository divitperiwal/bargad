import { Hono } from 'hono';
import { requireUser } from '#middlewares/auth.middleware';
import type { AuthEnv } from '#types/hono.types';
import { FeedController } from './feed.controller';

export const feedRoutes = new Hono<AuthEnv>()
  .use(requireUser)
  .get('/', ...FeedController.list)
  .get('/unread-count', ...FeedController.unreadCount)
  .put('/read-marker', ...FeedController.markRead);
