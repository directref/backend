import { pgTable, uuid, varchar, text, boolean, timestamp, numeric, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceUrl: text('source_url').notNull(),
    title: varchar('title', { length: 300 }).notNull(),
    companyName: varchar('company_name', { length: 200 }).notNull(),
    location: varchar('location', { length: 200 }),
    description: text('description'),
    jobType: varchar('job_type', { length: 50 }),
    workMode: varchar('work_mode', { length: 20 }),
    salaryRange: varchar('salary_range', { length: 100 }),
    bonusAmount: numeric('bonus_amount', { precision: 12, scale: 2 }),
    bonusCurrency: varchar('bonus_currency', { length: 10 }).default('USD'),
    bonusNotes: text('bonus_notes'),
    isActive: boolean('is_active').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    // Deletion clock: set the moment isActive flips to false, cleared the
    // moment it's reactivated — so re-deactivating later always starts a
    // fresh 30 days. The cleanup sweep (see scheduler/jobCleanupSweep.ts)
    // emails a 3-day warning, then permanently deletes the posting (and,
    // via cascade, its applications/messages) once deactivatedAt is 30+
    // days old. deletionWarningEmailSentAt makes that warning idempotent.
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deletionWarningEmailSentAt: timestamp('deletion_warning_email_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    index('jobs_referrer_id_idx').on(t.referrerId),
    index('jobs_company_name_idx').on(t.companyName),
    index('jobs_is_active_created_idx').on(t.isActive, t.createdAt),
    index('jobs_is_active_deactivated_at_idx').on(t.isActive, t.deactivatedAt),
  ],
);
