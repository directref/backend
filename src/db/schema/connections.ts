import { pgTable, uuid, varchar, timestamp, check, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: uuid('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('connections_pair_idx').on(t.requesterId, t.addresseeId),
    index('connections_requester_status_idx').on(t.requesterId, t.status),
    index('connections_addressee_status_idx').on(t.addresseeId, t.status),
    check('connections_status_check', sql`${t.status} IN ('pending', 'accepted', 'rejected')`),
  ],
);
