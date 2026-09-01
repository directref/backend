import { db } from '../config/db';
import { applications, jobs, users, applicationMessages } from '../db/schema';
import { eq, and, lte, isNull, inArray } from 'drizzle-orm';
import { env } from '../config/env';
import { ESCALATION_MS } from '../config/escalation';
import { createNotification } from '../modules/notifications/notifications.service';
import { refundCredit } from '../modules/credits/credits.service';
import { sendReminderEmail, sendEscalationEmail, sendExpiredEmail } from '../services/email';

const PENDING_STATUSES = ['submitted', 'viewed'] as const;

/** Day 1 — nudge the referrer on every application still awaiting a decision. */
async function sendDay1Reminders(): Promise<number> {
  const cutoff = new Date(Date.now() - ESCALATION_MS.REMINDER);
  const rows = await db
    .select({
      application: applications,
      job: { title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(
      inArray(applications.status, PENDING_STATUSES),
      lte(applications.createdAt, cutoff),
      isNull(applications.reminderSentAt),
    ));

  for (const row of rows) {
    try {
      const [seeker] = await db.select().from(users).where(eq(users.id, row.application.seekerId)).limit(1);
      const [referrer] = await db.select().from(users).where(eq(users.id, row.application.referrerId)).limit(1);
      if (!seeker || !referrer) continue;

      const inboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
      await createNotification(
        referrer.id,
        'cv_reminder',
        `Reminder: ${seeker.fullName}'s CV is waiting on you`,
        `You haven't responded to their CV for ${row.job.title} at ${row.job.companyName} yet.`,
        inboxUrl,
      ).catch(() => {});
      await sendReminderEmail(referrer.email, referrer.fullName, seeker.fullName, row.job.title, row.job.companyName, inboxUrl)
        .catch((err) => console.error('[escalation] Day 1 reminder email failed:', err));

      await db.update(applications).set({ reminderSentAt: new Date() }).where(eq(applications.id, row.application.id));
    } catch (err) {
      console.error('[escalation] Day 1 reminder failed for application', row.application.id, err);
    }
  }
  return rows.length;
}

/** Day 3 — tell the seeker their referrer still hasn't acted. Never silence. */
async function sendDay3Escalations(): Promise<number> {
  const cutoff = new Date(Date.now() - ESCALATION_MS.ESCALATE);
  const rows = await db
    .select({
      application: applications,
      job: { title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(
      inArray(applications.status, PENDING_STATUSES),
      lte(applications.createdAt, cutoff),
      isNull(applications.escalatedAt),
    ));

  for (const row of rows) {
    try {
      const [seeker] = await db.select().from(users).where(eq(users.id, row.application.seekerId)).limit(1);
      const [referrer] = await db.select().from(users).where(eq(users.id, row.application.referrerId)).limit(1);
      if (!seeker || !referrer) continue;

      const appsUrl = `${env.FRONTEND_URL}/applications`;
      await createNotification(
        seeker.id,
        'cv_escalated',
        `Still waiting to hear from ${referrer.fullName}`,
        `No response yet for ${row.job.title} at ${row.job.companyName} — we've reminded them. You can message them directly.`,
        appsUrl,
      ).catch(() => {});
      await sendEscalationEmail(seeker.email, seeker.fullName, referrer.fullName, row.job.title, row.job.companyName, appsUrl)
        .catch((err) => console.error('[escalation] Day 3 escalation email failed:', err));

      await db.update(applications).set({ escalatedAt: new Date() }).where(eq(applications.id, row.application.id));
    } catch (err) {
      console.error('[escalation] Day 3 escalation failed for application', row.application.id, err);
    }
  }
  return rows.length;
}

/** Day 5 — auto-cancel and refund, unless the seeker has already messaged the referrer (that counts as engagement, so we don't cut it off mid-conversation). */
async function sendDay5AutoCancellations(): Promise<number> {
  const cutoff = new Date(Date.now() - ESCALATION_MS.AUTO_CANCEL);
  const rows = await db
    .select({
      application: applications,
      job: { title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(
      inArray(applications.status, PENDING_STATUSES),
      lte(applications.createdAt, cutoff),
      isNull(applications.autoCancelledAt),
    ));

  let cancelled = 0;
  for (const row of rows) {
    try {
      const [seekerMessage] = await db
        .select({ id: applicationMessages.id })
        .from(applicationMessages)
        .where(and(
          eq(applicationMessages.applicationId, row.application.id),
          eq(applicationMessages.senderId, row.application.seekerId),
        ))
        .limit(1);
      // The seeker DMing the referrer pauses the clock — a real conversation is
      // underway, so we don't cut it off silently. Revisit once they go quiet again.
      if (seekerMessage) continue;

      const [seeker] = await db.select().from(users).where(eq(users.id, row.application.seekerId)).limit(1);
      const [referrer] = await db.select().from(users).where(eq(users.id, row.application.referrerId)).limit(1);
      if (!seeker || !referrer) continue;

      await db.update(applications)
        .set({ status: 'expired', autoCancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(applications.id, row.application.id));

      await refundCredit(seeker.id);

      const appsUrl = `${env.FRONTEND_URL}/applications`;
      await createNotification(
        seeker.id,
        'cv_expired',
        `No response from ${referrer.fullName} — your credit was refunded`,
        `Your application for ${row.job.title} at ${row.job.companyName} closed after 5 days with no response.`,
        appsUrl,
      ).catch(() => {});
      await sendExpiredEmail(seeker.email, seeker.fullName, referrer.fullName, row.job.title, row.job.companyName, appsUrl)
        .catch((err) => console.error('[escalation] Day 5 expired email failed:', err));

      // Referrer just gets an in-app note that it's off their plate — they've
      // already had a Day 1 reminder and a Day 3 notice; another email would pile on.
      await createNotification(
        referrer.id,
        'cv_expired',
        `${seeker.fullName}'s application expired`,
        `No decision was made within 5 days for ${row.job.title}, so it's been removed from your inbox.`,
        `${env.FRONTEND_URL}/applications/inbox`,
      ).catch(() => {});

      cancelled += 1;
    } catch (err) {
      console.error('[escalation] Day 5 auto-cancel failed for application', row.application.id, err);
    }
  }
  return cancelled;
}

/** Runs the full Day 1 / Day 3 / Day 5 escalation ladder once. Safe to call
 *  repeatedly — every step is idempotent per application (guarded by its own
 *  *_At column), so re-running never double-sends. */
export async function runEscalationSweep(): Promise<void> {
  try {
    const [reminded, escalated, cancelled] = await Promise.all([
      sendDay1Reminders(),
      sendDay3Escalations(),
      sendDay5AutoCancellations(),
    ]);
    if (reminded || escalated || cancelled) {
      console.log(`[escalation] sweep: ${reminded} reminded, ${escalated} escalated, ${cancelled} auto-cancelled`);
    }
  } catch (err) {
    console.error('[escalation] sweep failed:', err);
  }
}
