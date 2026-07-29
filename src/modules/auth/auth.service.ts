import { db } from '../../config/db';
import { env } from '../../config/env';
import { users } from '../../db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AppError } from '../../middleware/errorHandler';
import { sendVerificationEmail, sendPasswordResetEmail } from '../../services/email';
import { generateInviteCode } from '../invites/invites.service';
import type { RegisterDto } from './auth.schemas';
import type { InferSelectModel } from 'drizzle-orm';

export type User = InferSelectModel<typeof users>;

/** Strip sensitive fields before returning user to client */
export function sanitizeUser(user: User | Express.User) {
  const { passwordHash: _, emailVerifyToken: __, resetToken: ___, resetTokenExp: ____, ...safe } = user as User;
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

export async function getUserById(id: string): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return user;
}
