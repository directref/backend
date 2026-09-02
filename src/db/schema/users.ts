import { pgTable, uuid, varchar, boolean, timestamp, text, integer, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    email: varchar('email', { length: 320 }).notNull().unique(),
    passwordHash: varchar('password_hash', { length: 255 }),
    fullName: varchar('full_name', { length: 200 }).notNull(),
    headline: varchar('headline', { length: 400 }),
    avatarUrl: text('avatar_url'),
    googleId: varchar('google_id', { length: 100 }).unique(),
    linkedinId: varchar('linkedin_id', { length: 100 }).unique(),
    companyName: varchar('company_name', { length: 200 }),
    isReferrer: boolean('is_referrer').notNull().default(false),
    isSeeker: boolean('is_seeker').notNull().default(true),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifyToken: varchar('email_verify_token', { length: 64 }),
    resetToken: varchar('reset_token', { length: 64 }),
    resetTokenExp: timestamp('reset_token_exp', { withTimezone: true }),
    // Job-matching preferences (seeker)
    desiredRole: varchar('desired_role', { length: 200 }),
    preferredLocation: varchar('preferred_location', { length: 200 }),
    yearsOfExperience: integer('years_of_experience'),
    employmentType: varchar('employment_type', { length: 20 }), // 'full-time' | 'part-time'
    seniority: varchar('seniority', { length: 20 }), // 'junior' | 'mid' | 'senior' | 'lead' | 'manager'
    // Credits — every user gets 3 on signup, then +1/month thereafter (see
    // credits.service.ts), one shared balance for both sending a C.V. and
    // posting a job. All actual grants (signup, monthly, refunds) live as
    // rows in credit_purchases; freeCreditsMonth here is just the 'YYYY-MM'
    // this user last received their recurring monthly grant, so the sweep
    // that hands it out never double-grants in the same month.
    // freeCreditsUsed is unused/deprecated — left in place, no schema
    // migration, from the old "1 free credit that resets monthly" model.
    freeCreditsMonth: varchar('free_credits_month', { length: 7 }),
    freeCreditsUsed: boolean('free_credits_used').notNull().default(false),
    // Onboarding + invite
    onboarded: boolean('onboarded').notNull().default(false),
    inviteCode: varchar('invite_code', { length: 16 }).unique(),
    invitedById: uuid('invited_by_id'), // FK set below via relations
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex('users_email_idx').on(t.email),
    uniqueIndex('users_google_id_idx').on(t.googleId),
    uniqueIndex('users_linkedin_id_idx').on(t.linkedinId),
    uniqueIndex('users_invite_code_idx').on(t.inviteCode),
    index('users_company_name_idx').on(t.companyName),
  ],
);
