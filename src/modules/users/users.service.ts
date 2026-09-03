import crypto from 'crypto';
import { db } from '../../config/db';
import { users } from '../../db/schema';
import { eq, ilike, or, and, ne } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { sanitizeUser } from '../auth/auth.service';
import { extractEmailDomain, isPersonalEmailDomain } from '../../services/companyMatch';
import { sendWorkEmailVerificationEmail } from '../../services/email';
import type { UpdateProfileDto } from './users.schemas';

export async function getProfile(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return sanitizeUser(user);
}

export async function updateProfile(userId: string, dto: UpdateProfileDto) {
  const [updated] = await db
    .update(users)
    .set({ ...dto, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  return sanitizeUser(updated);
}

/** Submits (or replaces) a work email and sends a confirmation link. Doesn't
 *  mark it verified until the link is clicked (see auth.service.ts verifyWorkEmail). */
export async function requestWorkEmailVerification(userId: string, workEmail: string): Promise<void> {
  const normalized = workEmail.trim().toLowerCase();
  const domain = extractEmailDomain(normalized);
  if (isPersonalEmailDomain(domain)) {
    throw new AppError(400, 'PERSONAL_EMAIL', 'Please use your work email, not a personal email provider');
  }

  const [user] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const token = crypto.randomBytes(32).toString('hex');
  const tokenExp = new Date(Date.now() + 60 * 60 * 1000); // 1 hour, same window as password reset

  await db.update(users).set({
    workEmail: normalized,
    workEmailVerified: false,
    workEmailVerifyToken: token,
    workEmailVerifyTokenExp: tokenExp,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  await sendWorkEmailVerificationEmail(normalized, user.fullName, token);
}

export async function searchUsers(q: string, page: number, limit: number, requesterId: string) {
  const offset = (page - 1) * limit;

  // If no query — return all users except self (for "People you may know")
  const whereClause = q.trim()
    ? and(
        or(ilike(users.fullName, `%${q}%`), ilike(users.companyName, `%${q}%`)),
        ne(users.id, requesterId),
      )
    : ne(users.id, requesterId);

  const results = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      headline: users.headline,
      avatarUrl: users.avatarUrl,
      companyName: users.companyName,
      isReferrer: users.isReferrer,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(whereClause)
    .limit(limit)
    .offset(offset);
  return results;
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
