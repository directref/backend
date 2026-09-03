import { db } from '../../config/db';
import { jobs, connections, users } from '../../db/schema';
import { eq, and, or, ilike, desc, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { scrapeJobUrl } from '../../services/jobScraper';
import { getResponseStatsForReferrers, type ResponseStats } from '../applications/applications.service';
import { spendCredit } from '../credits/credits.service';
import type { CreateJobDto, UpdateJobDto } from './jobs.schemas';

type JobRow = typeof jobs.$inferSelect;
interface ReferrerRow {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  companyName: string | null;
  headline?: string | null;
}
interface JobReferrerRow { job: JobRow; referrer: ReferrerRow }
type ReferrerWithStats = ReferrerRow & { jobId: string; responseStats?: ResponseStats };
export interface GroupedJob {
  job: JobRow;
  /** Back-compat single referrer (the top-scoring one, or the canonical
   *  posting's referrer if the group has no active postings) — existing
   *  consumers that only show one referrer (Home's matched-jobs card, the
   *  Browse Jobs referrer filter facets) keep working unchanged. */
  referrer: ReferrerWithStats;
  /** Full group of active referrers for this listing, each carrying the
   *  specific underlying job row id an application must submit against. */
  referrers: ReferrerWithStats[];
}

/** Multiple referrers can each independently post the same real-world listing
 *  (same sourceUrl) as their own `jobs` row. Rather than a many-to-many
 *  schema, we group those rows by sourceUrl at query time so the UI shows
 *  one card with a referrer picker instead of duplicate cards.
 *
 *  Known simplification: this only merges *exact* sourceUrl matches — two
 *  referrers pasting slightly different URLs for the same listing won't
 *  merge. No fuzzy matching. */
async function groupBySourceUrl(rows: JobReferrerRow[]): Promise<GroupedJob[]> {
  const groups = new Map<string, JobReferrerRow[]>();
  for (const row of rows) {
    const list = groups.get(row.job.sourceUrl) ?? [];
    list.push(row);
    groups.set(row.job.sourceUrl, list);
  }

  const referrerIds = [...new Set(rows.map((r) => r.referrer.id))];
  const statsByReferrer = await getResponseStatsForReferrers(referrerIds);

  const grouped: GroupedJob[] = [];
  for (const groupRows of groups.values()) {
    const activeRows = groupRows.filter((r) => r.job.isActive);
    // If every posting for this listing was closed, fall back to showing it
    // (as closed) rather than dropping it silently.
    const candidateRows = activeRows.length > 0 ? activeRows : groupRows;
    const canonical = candidateRows.reduce((latest, r) => (r.job.createdAt > latest.job.createdAt ? r : latest));

    const seenReferrerIds = new Set<string>();
    const referrers = activeRows
      .filter((r) => {
        if (seenReferrerIds.has(r.referrer.id)) return false;
        seenReferrerIds.add(r.referrer.id);
        return true;
      })
      .map((r) => ({ ...r.referrer, jobId: r.job.id, responseStats: statsByReferrer.get(r.referrer.id) }))
      .sort((a, b) => (b.responseStats?.score ?? -1) - (a.responseStats?.score ?? -1));

    const primaryReferrer = referrers[0] ?? { ...canonical.referrer, jobId: canonical.job.id };

    grouped.push({
      job: { ...canonical.job, isActive: activeRows.length > 0 },
      referrer: primaryReferrer,
      referrers,
    });
  }

  grouped.sort((a, b) => b.job.createdAt.getTime() - a.job.createdAt.getTime());
  return grouped;
}

/** Create a new job posting — costs 1 credit, same shared balance as sending a C.V. */
export async function createJob(referrerId: string, dto: CreateJobDto) {
  await spendCredit(referrerId);

  const [job] = await db.insert(jobs).values({
    referrerId,
    ...dto,
    bonusAmount: dto.bonusAmount ? String(dto.bonusAmount) : undefined,
  }).returning();
  return job;
}

const referrerSelect = {
  id: users.id,
  fullName: users.fullName,
  headline: users.headline,
  avatarUrl: users.avatarUrl,
  companyName: users.companyName,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Get a single job (grouped with every other active posting of the same
 *  real-world listing, i.e. same sourceUrl, by any referrer).
 *
 *  Accepts either the real UUID (old links keep working) or the frontend's
 *  slug URL ("some-job-title-{8 hex chars}") — the trailing 8 hex chars are
 *  matched against the id, no separate slug column needed. */
export async function getJobById(idOrSlug: string): Promise<GroupedJob> {
  const suffix = idOrSlug.match(/([0-9a-f]{8})$/i)?.[1];
  const whereClause = UUID_RE.test(idOrSlug)
    ? eq(jobs.id, idOrSlug)
    : suffix
      ? sql`replace(${jobs.id}::text, '-', '') ILIKE ${'%' + suffix}`
      : undefined;

  if (!whereClause) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const [row] = await db
    .select({ job: jobs, referrer: referrerSelect })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(whereClause)
    .limit(1);

  if (!row) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');

  const siblings = await db
    .select({ job: jobs, referrer: referrerSelect })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(eq(jobs.sourceUrl, row.job.sourceUrl));

  const [grouped] = await groupBySourceUrl(siblings.length > 0 ? siblings : [row]);
  return grouped;
}

/** Jobs feed — all active jobs except your own, grouped by listing */
export async function getJobFeed(seekerId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;

  const rows = await db
    .select({ job: jobs, referrer: referrerSelect })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(and(eq(jobs.isActive, true), ne(jobs.referrerId, seekerId)))
    .orderBy(desc(jobs.createdAt));

  // Group before paginating — grouping can only reduce the row count, and
  // pagination needs to apply to grouped cards, not raw posting rows.
  const grouped = await groupBySourceUrl(rows);
  const page_ = grouped.slice(offset, offset + limit);

  return { data: page_, total: grouped.length };
}

/** Search all active jobs by title, company, or referrer name — grouped by listing */
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

  const rows = await db
    .select({ job: jobs, referrer: referrerSelect })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(and(...conditions))
    .orderBy(desc(jobs.createdAt));

  const grouped = await groupBySourceUrl(rows);
  return grouped.slice(offset, offset + limit);
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

/** isActive flipping off starts the 30-day deletion clock; flipping back on
 *  cancels it, so a later re-deactivation always gets a fresh 30 days. */
function deletionClockFields(existing: JobRow, nextIsActive: boolean | undefined): Partial<JobRow> {
  if (nextIsActive === false && existing.isActive) {
    return { deactivatedAt: new Date(), deletionWarningEmailSentAt: null };
  }
  if (nextIsActive === true && !existing.isActive) {
    return { deactivatedAt: null, deletionWarningEmailSentAt: null };
  }
  return {};
}

export async function updateJob(jobId: string, referrerId: string, dto: UpdateJobDto) {
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!existing) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  if (existing.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'You do not own this job posting');

  const [updated] = await db
    .update(jobs)
    .set({
      ...dto,
      bonusAmount: dto.bonusAmount ? String(dto.bonusAmount) : undefined,
      ...deletionClockFields(existing, dto.isActive),
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, jobId))
    .returning();
  return updated;
}

export async function deleteJob(jobId: string, referrerId: string): Promise<void> {
  const [existing] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!existing) throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found');
  if (existing.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'You do not own this job posting');
  await db.update(jobs)
    .set({ isActive: false, ...deletionClockFields(existing, false), updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
}

export async function scrapeJob(url: string) {
  return scrapeJobUrl(url);
}
