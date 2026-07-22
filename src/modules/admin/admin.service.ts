import { db } from '../../config/db';
import { users, jobs, applications, connections, invites } from '../../db/schema';
import { eq, gte, desc, count, and, sql } from 'drizzle-orm';

export async function getStats() {
  const now = new Date();
  const today     = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thisWeek  = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
  const thisMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Users
  const [totalUsers]     = await db.select({ count: count() }).from(users);
  const [newToday]       = await db.select({ count: count() }).from(users).where(gte(users.createdAt, today));
  const [newThisWeek]    = await db.select({ count: count() }).from(users).where(gte(users.createdAt, thisWeek));
  const [newThisMonth]   = await db.select({ count: count() }).from(users).where(gte(users.createdAt, thisMonth));

  // Jobs
  const [totalJobs]  = await db.select({ count: count() }).from(jobs);
  const [activeJobs] = await db.select({ count: count() }).from(jobs).where(eq(jobs.isActive, true));

  // Applications
  const [totalApps]     = await db.select({ count: count() }).from(applications);
  const [viewedApps]    = await db.select({ count: count() }).from(applications).where(eq(applications.status, 'viewed'));
  const [downloadedApps]= await db.select({ count: count() }).from(applications).where(eq(applications.status, 'forwarded'));
  const [rejectedApps]  = await db.select({ count: count() }).from(applications).where(eq(applications.status, 'rejected'));

  // Connections
  const [totalConns]    = await db.select({ count: count() }).from(connections);
  const [acceptedConns] = await db.select({ count: count() }).from(connections).where(eq(connections.status, 'accepted'));

  // Invites
  const [totalInvites] = await db.select({ count: count() }).from(invites);
  const [usedInvites]  = await db.select({ count: count() }).from(invites).where(sql`${invites.usedAt} IS NOT NULL`);

  // Top companies
  const topCompanies = await db
    .select({ company: users.companyName, count: count() })
    .from(users)
    .where(sql`${users.companyName} IS NOT NULL`)
    .groupBy(users.companyName)
    .orderBy(desc(count()))
    .limit(10);

  // Users over time (last 30 days by day)
  const userGrowth = await db
    .select({
      date: sql<string>`DATE(${users.createdAt})`,
      count: count(),
    })
    .from(users)
    .where(gte(users.createdAt, thisMonth))
    .groupBy(sql`DATE(${users.createdAt})`)
    .orderBy(sql`DATE(${users.createdAt})`);

  return {
    users: {
      total:     totalUsers.count,
      today:     newToday.count,
      thisWeek:  newThisWeek.count,
      thisMonth: newThisMonth.count,
    },
    jobs: {
      total:  totalJobs.count,
      active: activeJobs.count,
    },
    applications: {
      total:      totalApps.count,
      viewed:     viewedApps.count,
      downloaded: downloadedApps.count,
      rejected:   rejectedApps.count,
      pending:    totalApps.count - viewedApps.count - downloadedApps.count - rejectedApps.count,
    },
    connections: {
      total:    totalConns.count,
      accepted: acceptedConns.count,
    },
    invites: {
      total: totalInvites.count,
      used:  usedInvites.count,
    },
    topCompanies,
    userGrowth,
  };
}

export async function getRecentActivity() {
  // Recent users
  const recentUsers = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      email: users.email,
      companyName: users.companyName,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(10);

  // Recent applications
  const recentApps = await db
    .select({
      id: applications.id,
      status: applications.status,
      createdAt: applications.createdAt,
      seeker: { fullName: users.fullName },
      jobTitle: jobs.title,
      company: jobs.companyName,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.seekerId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .orderBy(desc(applications.createdAt))
    .limit(10);

  // Recent jobs
  const recentJobs = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      companyName: jobs.companyName,
      isActive: jobs.isActive,
      createdAt: jobs.createdAt,
      referrer: { fullName: users.fullName },
    })
    .from(jobs)
    .innerJoin(users, eq(users.id, jobs.referrerId))
    .orderBy(desc(jobs.createdAt))
    .limit(10);

  return { recentUsers, recentApps, recentJobs };
}
