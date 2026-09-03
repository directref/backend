import { db } from '../../config/db';
import { env } from '../../config/env';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AppError } from '../../middleware/errorHandler';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../services/email';
import { generateInviteCode } from '../invites/invites.service';
import { grantSignupCredits } from '../credits/credits.service';
import type { RegisterDto } from './auth.schemas';
import type { InferSelectModel } from 'drizzle-orm';

export type User = InferSelectModel<typeof users>;

/** Strip sensitive fields before returning user to client */
export function sanitizeUser(user: User | Express.User) {
  const {
    passwordHash: _, emailVerifyToken: __, resetToken: ___, resetTokenExp: ____,
    workEmailVerifyToken: _____, workEmailVerifyTokenExp: ______,
    ...safe
  } = user as User;
  return safe;
}

export async function register(dto: RegisterDto): Promise<User> {
  const existing = await db.select().from(users).where(eq(users.email, dto.email.toLowerCase())).limit(1);
  if (existing.length > 0) {
    throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(dto.password, 12);
  const emailVerifyToken = crypto.randomBytes(32).toString('hex');
  const inviteCode = generateInviteCode(dto.fullName);

  const hasEmailService = !!env.RESEND_API_KEY && env.RESEND_API_KEY !== 're_xxxxxxxxxxxxxxxxxxxx';

  const [user] = await db.insert(users).values({
    email: dto.email.toLowerCase(),
    passwordHash,
    fullName: dto.fullName,
    isReferrer: dto.isReferrer,
    emailVerifyToken: hasEmailService ? emailVerifyToken : null,
    emailVerified: !hasEmailService, // auto-verify if no email service
    inviteCode,
  }).returning();

  await grantSignupCredits(user.id);

  // Only send verification email if Resend is configured
  if (hasEmailService) {
    sendVerificationEmail(user.email, emailVerifyToken, user.fullName).catch((err) =>
      console.error('[email] verification send failed:', err),
    );
  }

  return user;
}

export async function verifyEmail(token: string): Promise<void> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.emailVerifyToken, token))
    .limit(1);

  if (!user) {
    throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
  }
  if (user.emailVerified) {
    return; // idempotent
  }

  await db.update(users).set({
    emailVerified: true,
    emailVerifyToken: null,
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));
}

export async function forgotPassword(email: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
  // Always return success to prevent email enumeration
  if (!user || !user.passwordHash) return;

  const resetToken = crypto.randomBytes(32).toString('hex');
  const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  await db.update(users).set({ resetToken, resetTokenExp, updatedAt: new Date() }).where(eq(users.id, user.id));
  sendPasswordResetEmail(user.email, resetToken).catch((err) =>
    console.error('[email] reset send failed:', err),
  );
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.resetToken, token)).limit(1);

  if (!user || !user.resetTokenExp || user.resetTokenExp < new Date()) {
    throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired reset token');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await db.update(users).set({
    passwordHash,
    resetToken: null,
    resetTokenExp: null,
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));
}

/** Completes work-email verification (see users.service.ts requestWorkEmailVerification
 *  for how the token is issued). No auth required — clicking the emailed
 *  link, which only the mailbox owner could receive, is the proof. */
export async function verifyWorkEmail(token: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.workEmailVerifyToken, token)).limit(1);

  if (!user || !user.workEmailVerifyTokenExp || user.workEmailVerifyTokenExp < new Date()) {
    throw new AppError(400, 'INVALID_TOKEN', 'Invalid or expired verification token');
  }

  await db.update(users).set({
    workEmailVerified: true,
    workEmailVerifyToken: null,
    workEmailVerifyTokenExp: null,
    updatedAt: new Date(),
  }).where(eq(users.id, user.id));
}

/** Find-or-create a user from a verified LinkedIn OIDC profile, mirroring
 *  the Google strategy's logic in config/passport.ts: match by provider id
 *  first, then by email (linking the account), then create a new user. */
export async function findOrCreateFromLinkedIn(profile: {
  linkedinId: string;
  email: string | null;
  fullName: string;
  avatarUrl: string | null;
}): Promise<User> {
  const [byLinkedinId] = await db.select().from(users).where(eq(users.linkedinId, profile.linkedinId)).limit(1);
  if (byLinkedinId) {
    await db.update(users).set({ avatarUrl: profile.avatarUrl, updatedAt: new Date() }).where(eq(users.id, byLinkedinId.id));
    return byLinkedinId;
  }

  if (profile.email) {
    const [byEmail] = await db.select().from(users).where(eq(users.email, profile.email)).limit(1);
    if (byEmail) {
      await db.update(users).set({
        linkedinId: profile.linkedinId,
        avatarUrl: profile.avatarUrl,
        emailVerified: true,
        updatedAt: new Date(),
      }).where(eq(users.id, byEmail.id));
      return byEmail;
    }
  }

  const [newUser] = await db.insert(users).values({
    email: profile.email ?? `linkedin_${profile.linkedinId}@placeholder.directref`,
    fullName: profile.fullName,
    linkedinId: profile.linkedinId,
    avatarUrl: profile.avatarUrl,
    emailVerified: true,
  }).returning();

  await grantSignupCredits(newUser.id);

  return newUser;
}

/** Link a verified LinkedIn profile to an already-authenticated user (the
 *  Settings "Connect" flow) — never creates or switches accounts. Throws if
 *  that LinkedIn identity is already linked to a different DirectRef user. */
export async function linkLinkedInToUser(
  userId: string,
  profile: { linkedinId: string; avatarUrl: string | null },
): Promise<User> {
  const [existing] = await db.select().from(users).where(eq(users.linkedinId, profile.linkedinId)).limit(1);
  if (existing && existing.id !== userId) {
    throw new AppError(409, 'LINKEDIN_ALREADY_LINKED', 'This LinkedIn account is already linked to another DirectRef account');
  }

  const [updated] = await db.update(users).set({
    linkedinId: profile.linkedinId,
    avatarUrl: profile.avatarUrl,
    updatedAt: new Date(),
  }).where(eq(users.id, userId)).returning();

  if (!updated) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return updated;
}

export async function getUserById(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}
