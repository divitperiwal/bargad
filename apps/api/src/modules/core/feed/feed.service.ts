import { toPage } from '#utils/http/pagination.util';
import { parseCursor } from './feed.helper';
import { FeedRepository } from './feed.repository';

export const FeedService = {
  list: async (userId: string, query: { limit: number; cursor?: string }) => {
    const after = query.cursor ? parseCursor(query.cursor) : undefined;
    const rows = await FeedRepository.findPage(userId, query.limit, after);
    return toPage(rows, query.limit);
  },

  unreadCount: (userId: string) => FeedRepository.countUnread(userId),

  markRead: (userId: string) => FeedRepository.markSeen(userId),
};
