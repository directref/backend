import { db } from '../../config/db';
import { savedJobs, jobs, users } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';

/** Save a job for a user — idempotent */
export async function saveJob(userId: string, jobId: string) {
  await db.insert(savedJobs).values({ userId, jobId }).onConflictDoNothing();
}

/** Unsave a job */
export async function unsaveJob(userId: string, jobId: string) {
  await db.delete(savedJobs).where(and(eq(savedJobs.userId, userId), eq(savedJobs.jobId, jobId)));
}

/** Get all saved jobs for a user, with job + referrer info */
export async function getSavedJobs(userId: string) {
  return db
    .select({
      savedAt: savedJobs.createdAt,
      job: jobs,
      referrer: {
        id:          users.id,
        fullName:    users.fullName,
        avatarUrl:   users.avatarUrl,
        companyName: users.companyName,
        headline:    users.headline,
      },
    })
    .from(savedJobs)
    .innerJoin(jobs,  eq(jobs.id,  savedJobs.jobId))
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(eq(savedJobs.userId, userId))
    .orderBy(desc(savedJobs.createdAt));
}

/** Check which of a list of jobIds are saved by the user */
export async function getSavedJobIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ jobId: savedJobs.jobId })
    .from(savedJobs)
    .where(eq(savedJobs.userId, userId));
  return rows.map(r => r.jobId);
}
