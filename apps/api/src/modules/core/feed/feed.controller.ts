import { paginationQuerySchema } from '@bargad/shared';
import { validate } from '#middlewares/validate.middleware';
import { createHandlers } from '#utils/http/handler.util';
import { sendSuccess } from '#utils/http/response.util';
import { FeedService } from './feed.service';

export const FeedController = {
  list: createHandlers(validate('query', paginationQuerySchema), async (c) =>
    sendSuccess(c, await FeedService.list(c.var.user.id, c.req.valid('query'))),
  ),

  unreadCount: createHandlers(async (c) => sendSuccess(c, { count: await FeedService.unreadCount(c.var.user.id) })),

  markRead: createHandlers(async (c) => sendSuccess(c, { seenAt: await FeedService.markRead(c.var.user.id) })),
};
