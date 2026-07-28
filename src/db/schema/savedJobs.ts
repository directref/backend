import { pgTable, uuid, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { jobs } from './jobs';

export const savedJobs = pgTable(
  'saved_jobs',
  {
    id:        uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    userId:    uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    jobId:     uuid('job_id').notNull().references(() => jobs.id,  { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('saved_jobs_user_job_idx').on(t.userId, t.jobId),
  ],
);
