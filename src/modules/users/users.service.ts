import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { db } from '../../config/db';
import { users } from '../../db/schema';
import { eq, ilike, or, and, ne } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { sanitizeUser } from '../auth/auth.service';
import { extractEmailDomain, isPersonalEmailDomain } from '../../services/companyMatch';
import { sendWorkEmailVerificationEmail } from '../../services/email';
import { env } from '../../config/env';
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

// ── Profile CV (CV of record) ────────────────────────────────────────────────
// A CV kept on the profile, separate from any application's CV. Applying to a
// job can reuse it, but always by copying it into a new file for that
// application (see applications.service.ts submitApplication) — so later
// replacing or removing an application's CV never touches this one, or any
// other application that also started from it.

export async function uploadProfileCv(userId: string, file: Express.Multer.File) {
  const [existing] = await db.select({ cvFilename: users.cvFilename }).from(users).where(eq(users.id, userId)).limit(1);

  const [updated] = await db.update(users).set({
    cvFilename: file.filename,
    cvOriginalName: file.originalname,
    cvMimetype: file.mimetype,
    cvSizeBytes: file.size,
    updatedAt: new Date(),
  }).where(eq(users.id, userId)).returning();

  if (existing?.cvFilename) {
    fs.unlink(path.resolve(env.UPLOADS_DIR, 'cvs', existing.cvFilename), () => {});
  }

  return sanitizeUser(updated);
}

export async function removeProfileCv(userId: string) {
  const [existing] = await db.select({ cvFilename: users.cvFilename }).from(users).where(eq(users.id, userId)).limit(1);
  if (!existing) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const [updated] = await db.update(users).set({
    cvFilename: null,
    cvOriginalName: null,
    cvMimetype: null,
    cvSizeBytes: null,
    updatedAt: new Date(),
  }).where(eq(users.id, userId)).returning();

  if (existing.cvFilename) {
    fs.unlink(path.resolve(env.UPLOADS_DIR, 'cvs', existing.cvFilename), () => {});
  }

  return sanitizeUser(updated);
}

async function getOwnCvFile(userId: string) {
  const [user] = await db
    .select({ cvFilename: users.cvFilename, cvOriginalName: users.cvOriginalName, cvMimetype: users.cvMimetype })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user?.cvFilename) throw new AppError(404, 'NO_CV_ON_FILE', 'No CV on file');

  const filePath = path.resolve(env.UPLOADS_DIR, 'cvs', user.cvFilename);
  if (!fs.existsSync(filePath)) throw new AppError(404, 'FILE_NOT_FOUND', 'CV file not found on server');

  return { filePath, originalName: user.cvOriginalName!, mimeType: user.cvMimetype! };
}

export async function getProfileCvPath(userId: string) {
  const { filePath, originalName } = await getOwnCvFile(userId);
  return { filePath, originalName };
}

export async function getProfileCvPreviewPath(userId: string) {
  const { filePath, mimeType } = await getOwnCvFile(userId);
  return { filePath, mimeType };
}
