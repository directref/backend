import { pgTable, uuid, varchar, boolean, timestamp, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const notifications = pgTable('notifications', {
  id:        uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type:      varchar('type', { length: 50 }).notNull(),  // 'cv_viewed' | 'cv_forwarded' | 'cv_received' | 'cv_rejected' | 'connection_request' | 'connection_accepted'
  title:     varchar('title', { length: 200 }).notNull(),
  body:      text('body').notNull(),
  linkUrl:   text('link_url'),
  isRead:    boolean('is_read').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
});
