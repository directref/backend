import { db } from '../../config/db';
import { users } from '../../db/schema';
import { eq, ilike, or, and, ne } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { sanitizeUser } from '../auth/auth.service';
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

export async function searchUsers(q: string, page: number, limit: number, requesterId: string) {
  const offset = (page - 1) * limit;
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
    .where(
      and(
        or(ilike(users.fullName, `%${q}%`), ilike(users.companyName, `%${q}%`)),
        ne(users.id, requesterId),
      ),
    )
    .limit(limit)
    .offset(offset);
  return results;
}

export async function deleteAccount(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId));
}
