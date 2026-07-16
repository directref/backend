import { pgTable, uuid, varchar, boolean, timestamp, text, index, uniqueIndex } from 'drizzle-orm/pg-core';
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
    companyName: varchar('company_name', { length: 200 }),
    isReferrer: boolean('is_referrer').notNull().default(false),
    isSeeker: boolean('is_seeker').notNull().default(true),
    emailVerified: boolean('email_verified').notNull().default(false),
    emailVerifyToken: varchar('email_verify_token', { length: 64 }),
    resetToken: varchar('reset_token', { length: 64 }),
    resetTokenExp: timestamp('reset_token_exp', { withTimezone: true }),
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
    uniqueIndex('users_invite_code_idx').on(t.inviteCode),
    index('users_company_name_idx').on(t.companyName),
  ],
);
