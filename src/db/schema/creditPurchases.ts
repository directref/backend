import { pgTable, uuid, varchar, integer, numeric, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const creditPurchases = pgTable(
  'credit_purchases',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    packageId: varchar('package_id', { length: 40 }).notNull(),
    credits: integer('credits').notNull(),
    remainingCredits: integer('remaining_credits').notNull(),
    pricePaid: numeric('price_paid', { precision: 10, scale: 2 }).notNull(),
    currency: varchar('currency', { length: 10 }).notNull().default('ILS'),
    purchasedAt: timestamp('purchased_at', { withTimezone: true }).notNull().default(sql`now()`),
    // Purchased credits are valid 12 months from purchase; the free monthly
    // credit (tracked on users) never expires this way, it just resets.
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('credit_purchases_user_id_idx').on(t.userId),
    index('credit_purchases_user_expiry_idx').on(t.userId, t.expiresAt),
  ],
);
