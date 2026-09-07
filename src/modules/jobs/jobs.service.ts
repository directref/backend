import { db } from '../../config/db';
import { jobs, connections, users, applications } from '../../db/schema';
import { eq, and, or, not, ilike, desc, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { scrapeJobUrl } from '../../services/jobScraper';
import { extractEmailDomain, emailMatchesJob } from '../../services/companyMatch';
import { getResponseStatsForReferrers, type ResponseStats } from '../applications/applications.service';
import { spendCredit } from '../credits/credits.service';
import { createNotification } from '../notifications/notifications.service';
import { env } from '../../config/env';
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
  job: JobRow & { roleType: string | null };
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
      job: { ...canonical.job, isActive: activeRows.length > 0, roleType: deriveRoleType(canonical.job.title) },
      referrer: primaryReferrer,
      referrers,
    });
  }

  grouped.sort((a, b) => b.job.createdAt.getTime() - a.job.createdAt.getTime());
  return grouped;
}

/** Create a new job posting — costs 1 credit (credits currently only gate
 *  this, the referrer side; sending a C.V. doesn't spend one). Also gated
 *  to referrers with a verified work email at the company being posted for
 *  (see services/companyMatch.ts), checked before spending the credit so a
 *  blocked attempt never costs one. */
export async function createJob(referrerId: string, dto: CreateJobDto) {
  const [referrer] = await db
    .select({ workEmail: users.workEmail, workEmailVerified: users.workEmailVerified })
    .from(users)
    .where(eq(users.id, referrerId))
    .limit(1);

  if (!referrer?.workEmailVerified || !referrer.workEmail) {
    throw new AppError(
      403,
      'WORK_EMAIL_REQUIRED',
      'Verify your work email in Settings before posting a job',
    );
  }
  if (!emailMatchesJob(extractEmailDomain(referrer.workEmail), dto.sourceUrl, dto.companyName)) {
    throw new AppError(
      403,
      'COMPANY_MISMATCH',
      `Your verified work email doesn't match ${dto.companyName} — you can only post jobs for the company you work at`,
    );
  }

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

/** Job titles don't carry a structured seniority field, so this is matched
 *  against the title text — the only seniority signal we have. Junior/
 *  Senior/Lead/Manager only match when the title actually says so. "Mid" is
 *  the unmarked default: most real postings for a regular/mid-level role
 *  never write "mid" in the title at all, so requiring the literal word
 *  matched almost nothing. Instead "mid" means "no other level is named" —
 *  i.e. not Senior and not Junior (e.g. "Product Manager" counts as mid,
 *  "Senior Product Manager" and "Junior Product Manager" don't). */
function seniorityCondition(seniority: string) {
  switch (seniority) {
    case 'junior':
      return ilike(jobs.title, '%junior%');
    case 'senior':
      return ilike(jobs.title, '%senior%');
    case 'lead':
      return ilike(jobs.title, '%lead%');
    case 'manager':
      return ilike(jobs.title, '%manager%');
    case 'mid':
      return and(not(ilike(jobs.title, '%senior%')), not(ilike(jobs.title, '%junior%')));
    default:
      return undefined;
  }
}

/** Job postings carry free-text scraped locations ("Herzliya, Israel",
 *  "Petah Tikva, Israel"), while the seeker's preferredLocation is now one of
 *  the 7 regions used on the settings page. A literal ILIKE of the region
 *  name only ever matches "Tel Aviv" and "Jerusalem" postings, so each
 *  region is expanded to the cities it actually covers. City groupings
 *  follow the CBS sub-district split (Central District's Sharon
 *  sub-district vs. its Petah Tikva/Ramla/Rehovot sub-districts) plus the
 *  Tel Aviv District, matching how Israeli tech job boards bucket cities. */
const REGION_CITIES: Record<string, string[]> = {
  'Tel Aviv': ['Tel Aviv', 'Ramat Gan', 'Givatayim', 'Bnei Brak', 'Holon', 'Bat Yam', 'Or Yehuda', 'Kiryat Ono'],
  Central: ['Petah Tikva', 'Rishon LeZion', 'Rehovot', 'Ramla', 'Lod', "Modi'in", 'Ness Ziona', 'Yavne', 'Rosh HaAyin', 'Givat Shmuel'],
  Sharon: ['Netanya', 'Herzliya', 'Kfar Saba', "Ra'anana", 'Hod HaSharon', 'Ramat HaSharon', 'Kfar Yona'],
  Haifa: ['Haifa', 'Kiryat Ata', 'Kiryat Bialik', 'Kiryat Motzkin', 'Kiryat Yam', 'Nesher', 'Tirat Carmel'],
  North: ['Nazareth', 'Afula', 'Tiberias', 'Karmiel', 'Nahariya', 'Kiryat Shmona', 'Safed', 'Tzfat', "Beit She'an", 'Migdal HaEmek', 'Acre', 'Akko'],
  Jerusalem: ['Jerusalem', 'Beit Shemesh', "Ma'ale Adumim", 'Mevaseret Zion'],
  South: ['Beer Sheva', "Be'er Sheva", 'Ashdod', 'Ashkelon', 'Eilat', 'Kiryat Gat', 'Dimona', 'Netivot', 'Sderot', 'Arad', 'Ofakim'],
};

/** OR-ed ILIKE conditions matching any city belonging to a seeker's
 *  preferred region, plus the region name itself (covers "Remote" postings
 *  that still list the region, and any literal match like "Tel Aviv"). */
function locationConditions(preferredLocation: string) {
  const cities = REGION_CITIES[preferredLocation] ?? [];
  return [preferredLocation, ...cities].map((place) => ilike(jobs.location, `%${place}%`));
}

/** The settings page now offers "Desired role" as a dropdown of canonical
 *  titles (see ProfileCard.tsx TECH_ROLES), which rarely appear verbatim in
 *  a real posting's title ("Senior Frontend Engineer" doesn't contain
 *  "Frontend Developer"). Each canonical role expands to the keyword(s) it's
 *  actually phrased as in the wild. A role picked via the "Other" free-text
 *  option won't be in this map — it falls back to matching the raw text
 *  the seeker typed, same as before. */
const ROLE_KEYWORDS: Record<string, string[]> = {
  'Full-Stack Developer': ['full stack', 'full-stack', 'fullstack'],
  'Back-End Developer': ['backend', 'back-end', 'back end'],
  'Front-End Developer': ['frontend', 'front-end', 'front end'],
  'Mobile Developer': ['mobile', 'ios', 'android'],
  'Desktop/Enterprise Developer': ['desktop', 'enterprise application'],
  'Embedded/Devices Developer': ['embedded', 'firmware'],
  'Game/Graphics Developer': ['game developer', 'graphics engineer', 'unity', 'unreal'],
  'QA/Test Engineer': ['qa', 'quality assurance', 'test engineer', 'automation engineer'],
  'DevOps Engineer': ['devops'],
  'Site Reliability Engineer': ['site reliability', 'sre'],
  'Cloud Infrastructure Engineer': ['cloud infrastructure', 'cloud engineer'],
  'Cybersecurity/InfoSec Engineer': ['security engineer', 'cybersecurity', 'infosec'],
  'Software/Solutions Architect': ['architect'],
  'Database Administrator': ['database administrator', 'dba'],
  'System Administrator': ['system administrator', 'sysadmin'],
  'Engineering Manager': ['engineering manager', 'r&d manager', 'r&d team lead'],
  'Data Engineer': ['data engineer'],
  'Data Scientist': ['data scientist'],
  'AI/ML Engineer': ['machine learning', 'ml engineer', 'ai engineer'],
  'Data/Business Analyst': ['data analyst', 'business analyst'],
  'Product Manager': ['product manager'],
  'Project Manager': ['project manager', 'program manager', 'scrum master'],
  'UX/UI Designer': ['ux designer', 'ui designer', 'product designer'],
  'Support Engineer/Analyst': ['support engineer', 'technical support', 'customer support'],
  'Financial Analyst/Engineer': ['financial analyst', 'quant'],
};

/** Classifies a posting's free-text title into one of the canonical roles
 *  above, for the Browse Jobs "Role type" filter — the same keyword map
 *  used to match a seeker's desired role against real postings, reused here
 *  in reverse (title -> role) instead of (role -> title). Returns null when
 *  no canonical role's keywords appear in the title (e.g. "Associate
 *  General Counsel"), same as company/location/employment type facets
 *  already skip a job that has no value for that field. */
function deriveRoleType(title: string): string | null {
  const lower = title.toLowerCase();
  for (const [role, keywords] of Object.entries(ROLE_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) return role;
  }
  return null;
}

/** Jobs matching the seeker's saved profile preferences (desired role,
 *  location, employment type, seniority) — an AND across whichever fields
 *  they've set, so this stays truthful to the privacy policy's "Suggested
 *  for you is a saved search that runs the same filters you set yourself":
 *  a saved search narrows on every criterion, it doesn't surface a job
 *  because it happened to match just one unrelated field. Still no
 *  scoring/ranking — matches are ordered by recency only. */
export async function getSuggestedJobs(seekerId: string, limit: number): Promise<GroupedJob[]> {
  const [seeker] = await db
    .select({
      desiredRole: users.desiredRole,
      preferredLocation: users.preferredLocation,
      employmentType: users.employmentType,
      seniority: users.seniority,
    })
    .from(users)
    .where(eq(users.id, seekerId))
    .limit(1);

  if (!seeker) return [];

  const seniorityCond = seeker.seniority ? seniorityCondition(seeker.seniority) : undefined;

  const andConditions = [eq(jobs.isActive, true), ne(jobs.referrerId, seekerId)];
  let preferenceCount = 0;

  if (seeker.desiredRole) {
    const keywords = ROLE_KEYWORDS[seeker.desiredRole] ?? [seeker.desiredRole];
    andConditions.push(or(...keywords.map((k) => ilike(jobs.title, `%${k}%`)))!);
    preferenceCount++;
  }
  if (seeker.preferredLocation) {
    // Reverted the earlier "blank location passes every region" change —
    // tested against a real posting (Duve, genuinely Ramat Gan but scraped
    // with a blank location) and it showed up for a Sharon search too,
    // which is worse than not showing it: it overrides a filter the seeker
    // explicitly set to something else. An unspecified location isn't
    // "compatible with every region" — it's just unknown, so it should
    // fail the filter like any other non-match. The real fix for a
    // specific posting's blank location is correcting that job's data
    // (scrape improvement or manual backfill), not loosening the filter.
    andConditions.push(or(...locationConditions(seeker.preferredLocation))!);
    preferenceCount++;
  }
  if (seeker.employmentType) {
    andConditions.push(eq(jobs.jobType, seeker.employmentType));
    preferenceCount++;
  }
  if (seniorityCond) {
    andConditions.push(seniorityCond);
    preferenceCount++;
  }
  if (preferenceCount === 0) return [];

  const rows = await db
    .select({ job: jobs, referrer: referrerSelect })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .where(and(...andConditions))
    .orderBy(desc(jobs.createdAt));

  const grouped = await groupBySourceUrl(rows);
  return grouped.slice(0, limit);
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

  // Deactivating (not reactivating) — warn seekers whose CV is still sitting
  // unopened, in-app only (no email, this isn't urgent enough for that).
  // 'submitted'/'viewed' means the referrer hasn't downloaded it yet —
  // once downloaded (status 'forwarded' or later) it's out of their hands
  // either way, so there's nothing actionable left to tell them.
  if (existing.isActive && dto.isActive === false) {
    const pending = await db
      .select({ seekerId: applications.seekerId })
      .from(applications)
      .where(and(eq(applications.jobId, jobId), inArray(applications.status, ['submitted', 'viewed'])));

    for (const { seekerId } of pending) {
      createNotification(
        seekerId,
        'job_deactivated',
        'A job you applied to is no longer active',
        `${updated.title} at ${updated.companyName} was closed by the referrer.`,
        `${env.FRONTEND_URL}/applications`,
      ).catch(() => {});
    }
  }

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
