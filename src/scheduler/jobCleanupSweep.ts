import path from 'path';
import fs from 'fs';
import { db } from '../config/db';
import { jobs, applications, users } from '../db/schema';
import { eq, and, lte, isNull, isNotNull } from 'drizzle-orm';
import { env } from '../config/env';
import { JOB_CLEANUP_MS } from '../config/escalation';
import { createNotification } from '../modules/notifications/notifications.service';
import { sendJobDeletionWarningEmail } from '../services/email';

/** Day 27 from deactivation — warn the referrer the posting will be deleted in 3 days. */
async function sendDeletionWarnings(): Promise<number> {
  const cutoff = new Date(Date.now() - JOB_CLEANUP_MS.DELETION_WARNING);
  const rows = await db
    .select({ job: jobs })
    .from(jobs)
    .where(and(
      eq(jobs.isActive, false),
      isNotNull(jobs.deactivatedAt),
      lte(jobs.deactivatedAt, cutoff),
      isNull(jobs.deletionWarningEmailSentAt),
    ));

  let warned = 0;
  for (const { job } of rows) {
    try {
      const [referrer] = await db.select().from(users).where(eq(users.id, job.referrerId)).limit(1);
      if (!referrer) continue;

      await db.update(jobs)
        .set({ deletionWarningEmailSentAt: new Date() })
        .where(eq(jobs.id, job.id));

      const jobsUrl = `${env.FRONTEND_URL}/jobs/post`;
      await createNotification(
        referrer.id,
        'job_deletion_warning',
        `${job.title} will be deleted in 3 days`,
        `This posting has been inactive for 27 days. Reactivate it before then or it — and every application sent to it — will be permanently deleted.`,
        jobsUrl,
      ).catch(() => {});
      await sendJobDeletionWarningEmail(referrer.email, referrer.fullName, job.title, job.companyName, jobsUrl)
        .catch((err) => console.error('[job-cleanup] deletion warning email failed:', err));

      warned += 1;
    } catch (err) {
      console.error('[job-cleanup] deletion warning failed for job', job.id, err);
    }
  }
  return warned;
}

/** Day 30 from deactivation — permanently delete the posting, its applications
 *  (cascade), and the CV files those applications reference on disk. */
async function deleteExpiredInactiveJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - JOB_CLEANUP_MS.DELETE);
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(
      eq(jobs.isActive, false),
      isNotNull(jobs.deactivatedAt),
      lte(jobs.deactivatedAt, cutoff),
    ));

  let deleted = 0;
  for (const { id: jobId } of rows) {
    try {
      const cvFiles = await db
        .select({ cvFilename: applications.cvFilename })
        .from(applications)
        .where(eq(applications.jobId, jobId));

      // Row first: applications/messages cascade-delete in the DB regardless
      // of whether a given file is still on disk, and a failed unlink below
      // shouldn't leave the job undeleted.
      await db.delete(jobs).where(eq(jobs.id, jobId));

      for (const { cvFilename } of cvFiles) {
        const filePath = path.join(process.cwd(), env.UPLOADS_DIR, 'cvs', cvFilename);
        await fs.promises.unlink(filePath).catch((err) => {
          if (err.code !== 'ENOENT') console.error('[job-cleanup] failed to delete CV file', filePath, err);
        });
      }

      deleted += 1;
    } catch (err) {
      console.error('[job-cleanup] deletion failed for job', jobId, err);
    }
  }
  return deleted;
}

export async function runJobCleanupSweep(): Promise<void> {
  try {
    const deleted = await deleteExpiredInactiveJobs();
    const warned = await sendDeletionWarnings();
    if (deleted || warned) {
      console.log(`[job-cleanup] sweep: ${warned} deletion warning(s) sent, ${deleted} job(s) permanently deleted`);
    }
  } catch (err) {
    console.error('[job-cleanup] sweep failed:', err);
  }
}
