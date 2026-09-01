import { pgTable, uuid, varchar, text, integer, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { jobs } from './jobs';

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    seekerId: uuid('seeker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    referrerId: uuid('referrer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // CV file metadata — cv_filename is the internal disk filename, never exposed
    cvFilename: varchar('cv_filename', { length: 255 }).notNull(),
    cvOriginalName: varchar('cv_original_name', { length: 255 }).notNull(),
    cvMimetype: varchar('cv_mimetype', { length: 80 }).notNull(),
    cvSizeBytes: integer('cv_size_bytes').notNull(),
    coverNote: text('cover_note'),
    status: varchar('status', { length: 30 }).notNull().default('submitted'),
    referrerNote: text('referrer_note'),
    hrEmail: varchar('hr_email', { length: 320 }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    forwardedAt: timestamp('forwarded_at', { withTimezone: true }),
    // Clock A — from CV sent, while status is submitted/viewed. Day 1 first
    // reminder, Day 2 stronger reminder (escalatedAt — name predates this
    // meaning but the column is reused rather than migrated for a rename),
    // Day 5 auto-cancel.
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    escalatedAt: timestamp('escalated_at', { withTimezone: true }),
    // Clock B — from download (forwardedAt), while status is forwarded and
    // internal submission hasn't been confirmed yet. Day 2 reminder, Day 3
    // final reminder, Day 5 auto-cancel (shares autoCancelledAt with Clock A
    // since a given application can only ever be processed by one clock).
    submitReminderSentAt: timestamp('submit_reminder_sent_at', { withTimezone: true }),
    submitFollowupSentAt: timestamp('submit_followup_sent_at', { withTimezone: true }),
    autoCancelledAt: timestamp('auto_cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('applications_job_seeker_idx').on(t.jobId, t.seekerId),
    index('applications_job_id_idx').on(t.jobId),
    index('applications_seeker_id_idx').on(t.seekerId),
    index('applications_referrer_status_idx').on(t.referrerId, t.status),
    check(
      'applications_status_check',
      // 'expired' — set only by the escalation sweep when a referrer hasn't
      // acted by Day 5; never user-settable via the status PATCH endpoint.
      // 'internally_submitted' — referrer confirms they submitted a
      // downloaded CV into their company's internal system; only reachable
      // from 'forwarded' (enforced in the service layer, not here).
      sql`${t.status} IN ('submitted', 'viewed', 'forwarded', 'rejected', 'expired', 'internally_submitted')`,
    ),
  ],
);
