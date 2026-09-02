import { db } from '../config/db';
import { applications, jobs, users, applicationMessages } from '../db/schema';
import { eq, and, lte, gt, isNull, inArray } from 'drizzle-orm';
import { env } from '../config/env';
import { ESCALATION_MS, SUBMIT_ESCALATION_MS } from '../config/escalation';
import { createNotification } from '../modules/notifications/notifications.service';
import { refundCredit } from '../modules/credits/credits.service';
import {
  sendReminderEmail,
  sendSecondReminderEmail,
  sendSubmitReminderEmail,
  // sendSubmitFollowupEmail, // paused — see the commented call site below
  sendExpiredEmail,
  // sendReferrerExpiredEmail, // paused — see the commented call sites below
} from '../services/email';

const PENDING_STATUSES = ['submitted', 'viewed'] as const;

/** Has the seeker already DMed the referrer on this application? A real
 *  conversation underway pauses auto-cancel — we don't cut it off silently. */
async function seekerHasMessaged(applicationId: string, seekerId: string): Promise<boolean> {
  const [msg] = await db
    .select({ id: applicationMessages.id })
    .from(applicationMessages)
    .where(and(
      eq(applicationMessages.applicationId, applicationId),
      eq(applicationMessages.senderId, seekerId),
    ))
    .limit(1);
  return !!msg;
}

// ── Clock A — from CV sent, while status is submitted/viewed ──────────────────

/** Day 1 — nudge the referrer on every application still awaiting a decision.
 *  Only fires inside the Day-1→Day-2 window: an application already old enough
 *  for the stronger Day-2 reminder (first sweep after downtime, or pre-existing
 *  data) skips straight there instead of getting both nudges at once. */
async function sendDay1Reminders(): Promise<number> {
  const cutoff = new Date(Date.now() - ESCALATION_MS.REMINDER);
  const escalateCutoff = new Date(Date.now() - ESCALATION_MS.ESCALATE);
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
      gt(applications.createdAt, escalateCutoff),
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

/** Day 2 — a stronger reminder to the referrer, with a deadline. Replaces the
 *  old Day-3 seeker notice; the seeker just isn't told until it resolves. */
async function sendDay2SecondReminders(): Promise<number> {
  const cutoff = new Date(Date.now() - ESCALATION_MS.ESCALATE);
  // Past the auto-cancel line this email would contradict the cancellation
  // notice, so the window closes there.
  const autoCancelCutoff = new Date(Date.now() - ESCALATION_MS.AUTO_CANCEL);
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
      gt(applications.createdAt, autoCancelCutoff),
      isNull(applications.escalatedAt),
    ));

  for (const row of rows) {
    try {
      const [seeker] = await db.select().from(users).where(eq(users.id, row.application.seekerId)).limit(1);
      const [referrer] = await db.select().from(users).where(eq(users.id, row.application.referrerId)).limit(1);
      if (!seeker || !referrer) continue;

      const inboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
      await createNotification(
        referrer.id,
        'cv_escalated',
        `${seeker.fullName}'s CV resets in 3 days — please respond`,
        `Still no decision on their CV for ${row.job.title} at ${row.job.companyName}. If nothing happens by day 5, it resets and their credit is refunded.`,
        inboxUrl,
      ).catch(() => {});
      await sendSecondReminderEmail(referrer.email, referrer.fullName, seeker.fullName, row.job.title, row.job.companyName, inboxUrl)
        .catch((err) => console.error('[escalation] Day 2 second reminder email failed:', err));

      await db.update(applications).set({ escalatedAt: new Date() }).where(eq(applications.id, row.application.id));
    } catch (err) {
      console.error('[escalation] Day 2 second reminder failed for application', row.application.id, err);
    }
  }
  return rows.length;
}

/** Day 5 — auto-cancel and refund, unless the seeker has already messaged the referrer. */
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
      if (await seekerHasMessaged(row.application.id, row.application.seekerId)) continue;

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

      // Referrer gets an in-app note. The matching email (sendReferrerExpiredEmail)
      // is paused for now — re-enable by uncommenting when we want to test it.
      const referrerInboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
      await createNotification(
        referrer.id,
        'cv_expired',
        `${seeker.fullName}'s application expired`,
        `No decision was made within 5 days for ${row.job.title}, so it's been removed from your inbox.`,
        referrerInboxUrl,
      ).catch(() => {});
      // await sendReferrerExpiredEmail(referrer.email, referrer.fullName, seeker.fullName, row.job.title, row.job.companyName, referrerInboxUrl)
      //   .catch((err) => console.error('[escalation] Day 5 referrer expired email failed:', err));

      cancelled += 1;
    } catch (err) {
      console.error('[escalation] Day 5 auto-cancel failed for application', row.application.id, err);
    }
  }
  return cancelled;
}

// ── Clock B — from download, while status is forwarded and internal ───────────
// ── submission hasn't been confirmed yet ───────────────────────────────────────

/** Day 2 from download — ask the referrer whether they submitted it internally. */
async function sendSubmitReminders(): Promise<number> {
  const cutoff = new Date(Date.now() - SUBMIT_ESCALATION_MS.REMINDER);
  // Same windowing as Clock A: past the followup line, skip straight to it.
  const followupCutoff = new Date(Date.now() - SUBMIT_ESCALATION_MS.FOLLOWUP);
  const rows = await db
    .select({
      application: applications,
      job: { title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(
      eq(applications.status, 'forwarded'),
      lte(applications.forwardedAt, cutoff),
      gt(applications.forwardedAt, followupCutoff),
      isNull(applications.submitReminderSentAt),
    ));

  for (const row of rows) {
    try {
      const [seeker] = await db.select().from(users).where(eq(users.id, row.application.seekerId)).limit(1);
      const [referrer] = await db.select().from(users).where(eq(users.id, row.application.referrerId)).limit(1);
      if (!seeker || !referrer) continue;

      const inboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
      await createNotification(
        referrer.id,
        'cv_submit_reminder',
        `Did you submit ${seeker.fullName}'s CV internally yet?`,
        `You downloaded their CV for ${row.job.title} at ${row.job.companyName} — let them know once it's in your system.`,
        inboxUrl,
      ).catch(() => {});
      await sendSubmitReminderEmail(referrer.email, referrer.fullName, seeker.fullName, row.job.title, row.job.companyName, inboxUrl)
        .catch((err) => console.error('[escalation] submit reminder email failed:', err));

      await db.update(applications).set({ submitReminderSentAt: new Date() }).where(eq(applications.id, row.application.id));
    } catch (err) {
      console.error('[escalation] submit reminder failed for application', row.application.id, err);
    }
  }
  return rows.length;
}

/** Day 3 from download — a final reminder before this heads toward auto-cancel. */
async function sendSubmitFollowups(): Promise<number> {
  const cutoff = new Date(Date.now() - SUBMIT_ESCALATION_MS.FOLLOWUP);
  const autoCancelCutoff = new Date(Date.now() - SUBMIT_ESCALATION_MS.AUTO_CANCEL);
  const rows = await db
    .select({
      application: applications,
      job: { title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(
      eq(applications.status, 'forwarded'),
      lte(applications.forwardedAt, cutoff),
      gt(applications.forwardedAt, autoCancelCutoff),
      isNull(applications.submitFollowupSentAt),
    ));

  for (const row of rows) {
    try {
      const [seeker] = await db.select().from(users).where(eq(users.id, row.application.seekerId)).limit(1);
      const [referrer] = await db.select().from(users).where(eq(users.id, row.application.referrerId)).limit(1);
      if (!seeker || !referrer) continue;

      const inboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
      await createNotification(
        referrer.id,
        'cv_submit_followup',
        `Last check: did ${seeker.fullName}'s CV get submitted?`,
        `This resets in 2 days if we don't hear back for ${row.job.title} at ${row.job.companyName}.`,
        inboxUrl,
      ).catch(() => {});
      // Day-3 followup email paused — one post-download reminder (day 2) is enough.
      // await sendSubmitFollowupEmail(referrer.email, referrer.fullName, seeker.fullName, row.job.title, row.job.companyName, inboxUrl)
      //   .catch((err) => console.error('[escalation] submit followup email failed:', err));

      await db.update(applications).set({ submitFollowupSentAt: new Date() }).where(eq(applications.id, row.application.id));
    } catch (err) {
      console.error('[escalation] submit followup failed for application', row.application.id, err);
    }
  }
  return rows.length;
}

/** Day 5 from download — still not confirmed, so it resets like Clock A does:
 *  auto-cancel and refund, unless the seeker has already messaged the referrer. */
async function sendSubmitAutoCancellations(): Promise<number> {
  const cutoff = new Date(Date.now() - SUBMIT_ESCALATION_MS.AUTO_CANCEL);
  const rows = await db
    .select({
      application: applications,
      job: { title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(and(
      eq(applications.status, 'forwarded'),
      lte(applications.forwardedAt, cutoff),
      isNull(applications.autoCancelledAt),
    ));

  let cancelled = 0;
  for (const row of rows) {
    try {
      if (await seekerHasMessaged(row.application.id, row.application.seekerId)) continue;

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
        `No confirmation from ${referrer.fullName} — your credit was refunded`,
        `${referrer.fullName} downloaded your CV for ${row.job.title} at ${row.job.companyName} but never confirmed it was submitted, so we've closed this out and refunded your credit.`,
        appsUrl,
      ).catch(() => {});
      await sendExpiredEmail(seeker.email, seeker.fullName, referrer.fullName, row.job.title, row.job.companyName, appsUrl)
        .catch((err) => console.error('[escalation] submit auto-cancel expired email failed:', err));

      // Referrer email paused here too (see note in sendDay5AutoCancellations).
      const referrerInboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
      await createNotification(
        referrer.id,
        'cv_expired',
        `${seeker.fullName}'s application expired`,
        `No confirmation within 5 days of download for ${row.job.title}, so it's been removed from your inbox.`,
        referrerInboxUrl,
      ).catch(() => {});
      // await sendReferrerExpiredEmail(referrer.email, referrer.fullName, seeker.fullName, row.job.title, row.job.companyName, referrerInboxUrl)
      //   .catch((err) => console.error('[escalation] submit auto-cancel referrer expired email failed:', err));

      cancelled += 1;
    } catch (err) {
      console.error('[escalation] submit auto-cancel failed for application', row.application.id, err);
    }
  }
  return cancelled;
}

/** Runs both escalation ladders once. Safe to call repeatedly — every step is
 *  idempotent per application (guarded by its own *_At column), so re-running
 *  never double-sends.
 *
 *  Phases run sequentially, cancellations first: an application past the
 *  auto-cancel line must be expired before the reminder queries run, so its
 *  status flips out of PENDING_STATUSES/forwarded and it can't also receive a
 *  "please respond" the same tick. */
export async function runEscalationSweep(): Promise<void> {
  try {
    const cancelled = await sendDay5AutoCancellations();
    const submitCancelled = await sendSubmitAutoCancellations();
    const escalated = await sendDay2SecondReminders();
    const reminded = await sendDay1Reminders();
    const submitFollowedUp = await sendSubmitFollowups();
    const submitReminded = await sendSubmitReminders();
    const total = reminded + escalated + cancelled + submitReminded + submitFollowedUp + submitCancelled;
    if (total) {
      console.log(
        `[escalation] sweep: A[${reminded} reminded, ${escalated} escalated, ${cancelled} auto-cancelled] ` +
        `B[${submitReminded} reminded, ${submitFollowedUp} followed up, ${submitCancelled} auto-cancelled]`,
      );
    }
  } catch (err) {
    console.error('[escalation] sweep failed:', err);
  }
}
