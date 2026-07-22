import { pgTable, uuid, text, boolean, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { applications } from './applications';

export const applicationMessages = pgTable(
  'application_messages',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index('appmsg_application_id_idx').on(t.applicationId),
    index('appmsg_sender_id_idx').on(t.senderId),
  ],
);
