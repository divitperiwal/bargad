import { alias } from 'drizzle-orm/pg-core';
import { users } from '#database/schema';

export type FeedCursor = { at: string; id: string };

export const actor = alias(users, 'actor');
