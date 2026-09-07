import { db } from '../config/db';
import { jobs } from '../db/schema';
import { and, eq, or, isNull, lt, asc } from 'drizzle-orm';
import { JOB_LIVENESS_CHECK_MS, JOB_LIVENESS_BATCH_SIZE } from '../config/escalation';
import { checkJobLiveness } from '../services/jobScraper';
import { deletionClockFields, notifyPendingSeekersOfDeactivation } from '../modules/jobs/jobs.service';

/** Once a day per job (batched — see JOB_LIVENESS_BATCH_SIZE), re-checks
 *  whether an active posting's source link is still live and auto-
 *  deactivates it on a confirmed-dead signal (404/410, or a JSON-LD
 *  validThrough date in the past — see checkJobLiveness). Deliberately
 *  conservative: an inconclusive check (2xx with no closure signal, a
 *  timeout, a 5xx) leaves the job untouched rather than guessing — a false
 *  "dead" kills a real posting and any pending seeker's application for no
 *  reason, so silence/ambiguity is never treated as evidence. */
export async function runJobLivenessSweep(): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - JOB_LIVENESS_CHECK_MS);
    const due = await db
      .select({ id: jobs.id, sourceUrl: jobs.sourceUrl, title: jobs.title, companyName: jobs.companyName })
      .from(jobs)
      .where(and(
        eq(jobs.isActive, true),
        or(isNull(jobs.lastLivenessCheckAt), lt(jobs.lastLivenessCheckAt, cutoff)),
      ))
      .orderBy(asc(jobs.lastLivenessCheckAt))
      .limit(JOB_LIVENESS_BATCH_SIZE);

    let deactivated = 0;
    for (const job of due) {
      try {
        const result = await checkJobLiveness(job.sourceUrl);

        await db.update(jobs)
          .set({ lastLivenessCheckAt: new Date() })
          .where(eq(jobs.id, job.id));

        if (result === 'dead') {
          const [existing] = await db.select().from(jobs).where(eq(jobs.id, job.id)).limit(1);
          if (!existing || !existing.isActive) continue; // already deactivated by someone/something else meanwhile

          await db.update(jobs)
            .set({ isActive: false, ...deletionClockFields(existing, false), updatedAt: new Date() })
            .where(eq(jobs.id, job.id));

          await notifyPendingSeekersOfDeactivation(job.id, job.title, job.companyName);
          deactivated += 1;
        }
      } catch (err) {
        console.error('[job-liveness] check failed for job', job.id, err);
      }
    }

    if (due.length > 0) {
      console.log(`[job-liveness] sweep: checked ${due.length} job(s), ${deactivated} deactivated`);
    }
  } catch (err) {
    console.error('[job-liveness] sweep failed:', err);
  }
}
