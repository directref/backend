import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const invites = pgTable(
  'invites',
  {
    id:          uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    inviterId:   uuid('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    token:       varchar('token', { length: 64 }).notNull().unique(),
    email:       varchar('email', { length: 320 }),  // optional — if sent to a specific email
    usedAt:      timestamp('used_at', { withTimezone: true }),
    usedByUserId: uuid('used_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt:   timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index('invites_inviter_id_idx').on(t.inviterId),
    index('invites_token_idx').on(t.token),
  ],
);
