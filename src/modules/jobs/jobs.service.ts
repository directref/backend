import { db } from '../../config/db';
import { jobs, connections, users } from '../../db/schema';
import { eq, and, or, ilike, desc, inArray } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { scrapeJobUrl } from '../../services/jobScraper';
import type { CreateJobDto, UpdateJobDto } from './jobs.schemas';

/** Create a new job posting */
export async function createJob(referrerId: string, dto: CreateJobDto) {
  const [job] = await db.insert(jobs).values({
    referrerId,
    ...dto,
    bonusAmount: dto.bonusAmount ? String(dto.bonusAmount) : undefined,
  }).returning();
  return job;
}

/** Get a single job with referrer info */
export async function getJobById(jobId: string) {
  const [row] = await db
    .select({
      job: jobs,
      referrer: {
        id: users.id,
        fullName: users.fullName,
        headline: users.headline,
        avatarUrl: users.avatarUrl,
        companyName: users.companyName,
      },
    })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(eq(jobs.id, jobId))
    .limit(1);

  if (!row) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  return row;
}

/** Jobs from the user's accepted connections — the personalized feed */
export async function getJobFeed(seekerId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;

  // Get all accepted connection partner IDs
  const acceptedConns = await db
    .select({ requesterId: connections.requesterId, addresseeId: connections.addresseeId })
    .from(connections)
    .where(
      and(
        or(eq(connections.requesterId, seekerId), eq(connections.addresseeId, seekerId)),
        eq(connections.status, 'accepted'),
      ),
    );

  const friendIds = acceptedConns.map((c) =>
    c.requesterId === seekerId ? c.addresseeId : c.requesterId,
  );

  if (friendIds.length === 0) return { data: [], total: 0 };

  const feed = await db
    .select({
      job: jobs,
      referrer: {
        id: users.id,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        companyName: users.companyName,
        headline: users.headline,
      },
    })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(and(inArray(jobs.referrerId, friendIds), eq(jobs.isActive, true)))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);

  return { data: feed, total: feed.length };
}

/** Search all active jobs by title, company, or referrer name */
export async function searchJobs(
  q: string | undefined,
  company: string | undefined,
  page: number,
  limit: number,
) {
  const offset = (page - 1) * limit;

  const conditions = [eq(jobs.isActive, true)];
  if (q) conditions.push(or(ilike(jobs.title, `%${q}%`), ilike(jobs.companyName, `%${q}%`))!);
  if (company) conditions.push(ilike(jobs.companyName, `%${company}%`));

  const results = await db
    .select({
      job: jobs,
      referrer: {
        id: users.id,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        companyName: users.companyName,
      },
    })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);

  return results;
}

/** Jobs posted by the current user */
export async function getMyJobs(referrerId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.referrerId, referrerId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function updateJob(jobId: string, referrerId: string, dto: UpdateJobDto) {
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!existing) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  if (existing.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'You do not own this job posting');

  const [updated] = await db
    .update(jobs)
    .set({ ...dto, bonusAmount: dto.bonusAmount ? String(dto.bonusAmount) : undefined, updatedAt: new Date() })
    .where(eq(jobs.id, jobId))
    .returning();
  return updated;
}

export async function deleteJob(jobId: string, referrerId: string): Promise<void> {
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!existing) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  if (existing.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'You do not own this job posting');
  await db.update(jobs).set({ isActive: false, updatedAt: new Date() }).where(eq(jobs.id, jobId));
}

export async function scrapeJob(url: string) {
  return scrapeJobUrl(url);
}
