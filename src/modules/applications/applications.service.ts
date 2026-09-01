import path from 'path';
import fs from 'fs';
import { db } from '../../config/db';
import { applications, applicationMessages, jobs, users } from '../../db/schema';
import { eq, and, desc, ne, inArray, isNotNull } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { areFriends } from '../connections/connections.service';
import { createNotification } from '../notifications/notifications.service';
import {
  sendCVNotificationEmail,
  sendForwardedToHREmail,
  sendCVViewedEmail,
  sendCVForwardedEmail,
  sendCVDownloadedEmail,
  sendInternallySubmittedEmail,
  sendNewMessageEmail,
} from '../../services/email';
import { env } from '../../config/env';
import { spendCredit } from '../credits/credits.service';
import type { SubmitApplicationDto, ForwardToHRDto } from './applications.schemas';

/** Submit a CV to a referrer for a specific job */
export async function submitApplication(
  seekerId: string,
  dto: SubmitApplicationDto,
  file: Express.Multer.File,
) {
  // 1. Load the job
  const [job] = await db.select().from(jobs).where(eq(jobs.id, dto.jobId)).limit(1);
  if (!job || !job.isActive) {
    // Clean up uploaded file if job doesn't exist
    fs.unlink(file.path, () => {});
    throw new AppError(404, 'JOB_NOT_FOUND', 'Job not found or no longer active');
  }

  // 2. Can't apply to your own posting
  if (job.referrerId === seekerId) {
    fs.unlink(file.path, () => {});
    throw new AppError(400, 'SELF_APPLICATION', 'You cannot apply to your own job posting');
  }

  // 3. No duplicate applications — across this exact posting AND any sibling
  //    posting of the same real-world listing (same sourceUrl) by a different
  //    referrer. Picking another referrer on what's visually the same grouped
  //    card still counts as "already applied" to that job.
  const siblingJobs = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.sourceUrl, job.sourceUrl));
  const siblingJobIds = siblingJobs.map((j) => j.id);

  const [existing] = await db
    .select()
    .from(applications)
    .where(and(inArray(applications.jobId, siblingJobIds), eq(applications.seekerId, seekerId)))
    .limit(1);

  if (existing) {
    fs.unlink(file.path, () => {});
    throw new AppError(409, 'ALREADY_APPLIED', 'You have already sent your CV for this job');
  }

  // 4. Spend a credit — free first, then purchased. Throws OUT_OF_CREDITS
  //    (402) if the seeker has neither, same shared balance as posting a job.
  try {
    await spendCredit(seekerId);
  } catch (err) {
    fs.unlink(file.path, () => {});
    throw err;
  }

  // 5. Insert application
  const [application] = await db.insert(applications).values({
    jobId: dto.jobId,
    seekerId,
    referrerId: job.referrerId,
    cvFilename: file.filename,
    cvOriginalName: file.originalname,
    cvMimetype: file.mimetype,
    cvSizeBytes: file.size,
    coverNote: dto.coverNote,
  }).returning();

  // 6. Notify referrer — in-app + email (fire-and-forget)
  const [referrer] = await db.select().from(users).where(eq(users.id, job.referrerId)).limit(1);
  const [seeker] = await db.select().from(users).where(eq(users.id, seekerId)).limit(1);

  if (referrer && seeker) {
    const dashboardUrl = `${env.FRONTEND_URL}/applications/inbox`;
    // In-app notification
    createNotification(
      referrer.id,
      'cv_received',
      `${seeker.fullName} sent you their CV`,
      `Applied for ${job.title} at ${job.companyName}.`,
      dashboardUrl,
    ).catch(() => {});
    // Email
    sendCVNotificationEmail(
      referrer.email,
      referrer.fullName,
      seeker.fullName,
      job.title,
      job.companyName,
      dashboardUrl,
    ).catch((err) => console.error('[email] CV notification failed:', err));
  }

  return application;
}

// ── Response-time scoring ────────────────────────────────────────────────────
// "Response time" = time from the seeker clicking Send (applications.createdAt)
// to the referrer downloading/opening the CV (applications.viewedAt) — the
// moment we assume they've actually looked at it. Not tracked past that point.
//
// Hours → 0-100 score, banded so it can be colored in the UI:
//   0–24h  → green,  score 80–100
//   24–48h → orange, score 50–80
//   >48h   → red,    score 0–50 (floors at 0 by 96h)
// Slower average response = lower score, by design.

export type ResponseBand = 'green' | 'orange' | 'red';
export interface ResponseStats {
  score: number;
  band: ResponseBand;
  avgHours: number;
}

function computeResponseScore(hours: number): { score: number; band: ResponseBand } {
  let score: number;
  if (hours <= 24) score = 100 - (hours / 24) * 20;
  else if (hours <= 48) score = 80 - ((hours - 24) / 24) * 30;
  else score = Math.max(0, 50 - ((hours - 48) / 48) * 50);
  score = Math.round(score);
  const band: ResponseBand = score >= 80 ? 'green' : score >= 50 ? 'orange' : 'red';
  return { score, band };
}

/** Average response score per referrer, from every application of theirs that's
 *  been viewed. Referrers with no viewed applications yet are simply absent
 *  from the returned map — there's no track record to score. */
export async function getResponseStatsForReferrers(referrerIds: string[]): Promise<Map<string, ResponseStats>> {
  const result = new Map<string, ResponseStats>();
  if (referrerIds.length === 0) return result;

  const rows = await db
    .select({ referrerId: applications.referrerId, createdAt: applications.createdAt, viewedAt: applications.viewedAt })
    .from(applications)
    .where(and(inArray(applications.referrerId, referrerIds), isNotNull(applications.viewedAt)));

  const hoursByReferrer = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.viewedAt) continue;
    const hours = (row.viewedAt.getTime() - row.createdAt.getTime()) / 3_600_000;
    const list = hoursByReferrer.get(row.referrerId) ?? [];
    list.push(hours);
    hoursByReferrer.set(row.referrerId, list);
  }

  for (const [referrerId, hoursList] of hoursByReferrer) {
    const avgHours = hoursList.reduce((a, b) => a + b, 0) / hoursList.length;
    const { score, band } = computeResponseScore(avgHours);
    result.set(referrerId, { score, band, avgHours });
  }
  return result;
}

/** Referrer's inbox — CVs they received */
export async function getInbox(referrerId: string, status: string | undefined, page: number, limit: number) {
  const offset = (page - 1) * limit;

  const conditions = [eq(applications.referrerId, referrerId)];
  if (status) conditions.push(eq(applications.status, status));

  return db
    .select({
      application: {
        id: applications.id,
        status: applications.status,
        coverNote: applications.coverNote,
        createdAt: applications.createdAt,
        cvOriginalName: applications.cvOriginalName,
        cvSizeBytes: applications.cvSizeBytes,
      },
      job: { id: jobs.id, title: jobs.title, companyName: jobs.companyName },
      seeker: {
        id: users.id,
        fullName: users.fullName,
        avatarUrl: users.avatarUrl,
        headline: users.headline,
        yearsOfExperience: users.yearsOfExperience,
      },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(users, eq(users.id, applications.seekerId))
    .where(and(...conditions))
    .orderBy(desc(applications.createdAt))
    .limit(limit)
    .offset(offset);
}

/** Seeker's sent applications */
export async function getMineApplications(seekerId: string, page: number, limit: number) {
  const offset = (page - 1) * limit;
  return db
    .select({
      application: {
        id: applications.id,
        status: applications.status,
        coverNote: applications.coverNote,
        createdAt: applications.createdAt,
      },
      job: { id: jobs.id, title: jobs.title, companyName: jobs.companyName },
      referrer: { id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(users, eq(users.id, applications.referrerId))
    .where(eq(applications.seekerId, seekerId))
    .orderBy(desc(applications.createdAt))
    .limit(limit)
    .offset(offset);
}

/** Get single application — accessible by seeker or referrer */
export async function getApplicationById(applicationId: string, userId: string) {
  const [row] = await db
    .select({
      application: applications,
      job: { id: jobs.id, title: jobs.title, companyName: jobs.companyName },
    })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .where(eq(applications.id, applicationId))
    .limit(1);

  if (!row) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (row.application.seekerId !== userId && row.application.referrerId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Strip internal cv_filename before returning
  const { cvFilename: _, ...safeApplication } = row.application;
  return { ...row, application: safeApplication };
}

export async function updateStatus(
  applicationId: string,
  referrerId: string,
  status: 'viewed' | 'forwarded' | 'rejected' | 'internally_submitted',
) {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  // Confirming internal submission only makes sense after the CV was actually
  // downloaded — that's what starts Clock B in the first place.
  if (status === 'internally_submitted' && app.status !== 'forwarded') {
    throw new AppError(400, 'NOT_DOWNLOADED', 'Download the CV before confirming internal submission');
  }

  const [updated] = await db
    .update(applications)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === 'viewed' && !app.viewedAt ? { viewedAt: new Date() } : {}),
      ...(status === 'forwarded' && !app.forwardedAt ? { forwardedAt: new Date() } : {}),
    })
    .where(eq(applications.id, applicationId))
    .returning();

  // Notify seeker of the referrer's decision
  if (status === 'rejected' || status === 'forwarded' || status === 'internally_submitted') {
    const [job]      = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
    const [referrer] = await db.select().from(users).where(eq(users.id, referrerId)).limit(1);
    const [seeker]   = await db.select().from(users).where(eq(users.id, app.seekerId)).limit(1);
    if (job && referrer && seeker) {
      const appsUrl = `${env.FRONTEND_URL}/applications`;
      if (status === 'rejected') {
        createNotification(
          app.seekerId,
          'cv_rejected',
          `${referrer.fullName} couldn't move forward with your CV`,
          `Your application for ${job.title} at ${job.companyName} wasn't the right fit this time.`,
          appsUrl,
        ).catch(() => {});
      } else if (status === 'forwarded') {
        createNotification(
          app.seekerId,
          'cv_forwarded',
          `${referrer.fullName} downloaded your CV`,
          `Your application for ${job.title} at ${job.companyName} was accepted — they'll be applying with your CV.`,
          appsUrl,
        ).catch(() => {});
        sendCVDownloadedEmail(seeker.email, seeker.fullName, referrer.fullName, job.title, job.companyName, appsUrl)
          .catch((err) => console.error('[email] CV downloaded notify failed:', err));
      } else {
        createNotification(
          app.seekerId,
          'cv_internally_submitted',
          `${referrer.fullName} submitted your CV internally`,
          `Great news — your CV for ${job.title} at ${job.companyName} was submitted into their internal system.`,
          appsUrl,
        ).catch(() => {});
        sendInternallySubmittedEmail(seeker.email, seeker.fullName, referrer.fullName, job.title, job.companyName, appsUrl)
          .catch((err) => console.error('[email] internally submitted notify failed:', err));
      }
    }
  }

  return updated;
}

export async function forwardToHR(applicationId: string, referrerId: string, dto: ForwardToHRDto) {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'Access denied');
  if (app.status === 'forwarded') throw new AppError(400, 'ALREADY_FORWARDED', 'This application has already been forwarded');

  const [job] = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
  const [referrerUser] = await db.select().from(users).where(eq(users.id, referrerId)).limit(1);
  const [seekerUser] = await db.select().from(users).where(eq(users.id, app.seekerId)).limit(1);

  const cvViewUrl = `${env.FRONTEND_URL}/applications/${applicationId}/cv`;

  await sendForwardedToHREmail(
    dto.hrEmail,
    referrerUser.fullName,
    dto.referrerNote ?? null,
    seekerUser.fullName,
    job.title,
    job.companyName,
    cvViewUrl,
  );

  // Notify the seeker that their CV was forwarded to HR
  const appsUrl = `${env.FRONTEND_URL}/applications`;
  createNotification(
    seekerUser.id,
    'cv_forwarded',
    `🎉 Your CV was forwarded to HR at ${job.companyName}`,
    `${referrerUser.fullName} sent your CV for ${job.title} to the HR team.`,
    appsUrl,
  ).catch(() => {});
  sendCVForwardedEmail(
    seekerUser.email,
    seekerUser.fullName,
    referrerUser.fullName,
    job.title,
    job.companyName,
    appsUrl,
  ).catch((err) => console.error('[email] CV forwarded notify failed:', err));

  const [updated] = await db
    .update(applications)
    .set({
      status: 'forwarded',
      hrEmail: dto.hrEmail,
      referrerNote: dto.referrerNote,
      forwardedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(applications.id, applicationId))
    .returning();

  return updated;
}

/** Stream CV file inline (for viewing in browser) */
export async function getCVPreviewPath(applicationId: string, userId: string): Promise<{ filePath: string; mimeType: string }> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.seekerId !== userId && app.referrerId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const filePath = path.join(process.cwd(), env.UPLOADS_DIR, 'cvs', app.cvFilename);
  if (!fs.existsSync(filePath)) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'CV file not found on server');
  }

  // Auto-mark as viewed when referrer previews
  if (app.referrerId === userId && app.status === 'submitted') {
    db.update(applications)
      .set({ status: 'viewed', viewedAt: new Date(), updatedAt: new Date() })
      .where(eq(applications.id, applicationId))
      .execute()
      .then(async () => {
        const [job]      = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
        const [seeker]   = await db.select().from(users).where(eq(users.id, app.seekerId)).limit(1);
        const [referrer] = await db.select().from(users).where(eq(users.id, app.referrerId)).limit(1);
        if (job && seeker && referrer) {
          const appsUrl = `${env.FRONTEND_URL}/applications`;
          createNotification(seeker.id, 'cv_viewed', `${referrer.fullName} viewed your CV`, `Your CV for ${job.title} at ${job.companyName} was opened.`, appsUrl).catch(() => {});
          sendCVViewedEmail(seeker.email, seeker.fullName, referrer.fullName, job.title, job.companyName, appsUrl).catch(() => {});
        }
      }).catch(() => {});
  }

  return { filePath, mimeType: app.cvMimetype };
}

/** Stream CV file — accessible by seeker (uploader) or referrer */
export async function getCVPath(applicationId: string, userId: string): Promise<{ filePath: string; originalName: string }> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.seekerId !== userId && app.referrerId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const filePath = path.join(process.cwd(), env.UPLOADS_DIR, 'cvs', app.cvFilename);
  if (!fs.existsSync(filePath)) {
    throw new AppError(404, 'FILE_NOT_FOUND', 'CV file not found on server');
  }

  // Auto-mark as viewed when referrer downloads — and notify the seeker
  if (app.referrerId === userId && app.status === 'submitted') {
    db.update(applications)
      .set({ status: 'viewed', viewedAt: new Date(), updatedAt: new Date() })
      .where(eq(applications.id, applicationId))
      .execute()
      .then(async () => {
        // Notify the seeker that their CV was viewed
        const [job]        = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
        const [seeker]     = await db.select().from(users).where(eq(users.id, app.seekerId)).limit(1);
        const [referrer]   = await db.select().from(users).where(eq(users.id, app.referrerId)).limit(1);
        if (job && seeker && referrer) {
          const appsUrl = `${env.FRONTEND_URL}/applications`;
          // In-app notification
          createNotification(
            seeker.id,
            'cv_viewed',
            `${referrer.fullName} viewed your CV`,
            `Your CV for ${job.title} at ${job.companyName} was opened.`,
            appsUrl,
          ).catch(() => {});
          // Email
          sendCVViewedEmail(
            seeker.email,
            seeker.fullName,
            referrer.fullName,
            job.title,
            job.companyName,
            appsUrl,
          ).catch((err) => console.error('[email] CV viewed notify failed:', err));
        }
      })
      .catch(() => {});
  }

  return { filePath, originalName: app.cvOriginalName };
}

// ── Messaging ─────────────────────────────────────────────────────────────────

export interface MessageRow {
  id: string;
  applicationId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  content: string;
  isRead: boolean;
  createdAt: Date;
}

/** Fetch the message thread for an application.
 *  Also marks all messages sent by the OTHER party as read. */
export async function getMessages(
  applicationId: string,
  userId: string,
): Promise<{ messages: MessageRow[]; unreadCount: number }> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.seekerId !== userId && app.referrerId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  // Count unread messages from the other party BEFORE marking them read
  const allMessages = await db
    .select({
      id: applicationMessages.id,
      applicationId: applicationMessages.applicationId,
      senderId: applicationMessages.senderId,
      senderName: users.fullName,
      senderAvatarUrl: users.avatarUrl,
      content: applicationMessages.content,
      isRead: applicationMessages.isRead,
      createdAt: applicationMessages.createdAt,
    })
    .from(applicationMessages)
    .innerJoin(users, eq(users.id, applicationMessages.senderId))
    .where(eq(applicationMessages.applicationId, applicationId))
    .orderBy(applicationMessages.createdAt);

  const unreadCount = allMessages.filter((m) => !m.isRead && m.senderId !== userId).length;

  // Mark the other party's messages as read (fire-and-forget)
  db.update(applicationMessages)
    .set({ isRead: true })
    .where(
      and(
        eq(applicationMessages.applicationId, applicationId),
        ne(applicationMessages.senderId, userId),
        eq(applicationMessages.isRead, false),
      ),
    )
    .execute()
    .catch(() => {});

  return { messages: allMessages, unreadCount };
}

/** Send a message within an application thread */
export async function sendMessage(
  applicationId: string,
  senderId: string,
  content: string,
): Promise<MessageRow> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.seekerId !== senderId && app.referrerId !== senderId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const [inserted] = await db
    .insert(applicationMessages)
    .values({ applicationId, senderId, content })
    .returning();

  // Notify the other party — fire-and-forget
  const recipientId = senderId === app.seekerId ? app.referrerId : app.seekerId;
  const recipientLinkUrl =
    senderId === app.seekerId
      ? `${env.FRONTEND_URL}/applications/inbox`
      : `${env.FRONTEND_URL}/applications`;

  db.select({ fullName: users.fullName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, senderId))
    .limit(1)
    .then(([sender]) => {
      if (!sender) return;
      const preview = content.length > 120 ? `${content.slice(0, 117)}…` : content;
      createNotification(
        recipientId,
        'application_message',
        `${sender.fullName} sent you a message`,
        preview,
        recipientLinkUrl,
      ).catch(() => {});
      db.select({ email: users.email, fullName: users.fullName })
        .from(users)
        .where(eq(users.id, recipientId))
        .limit(1)
        .then(([recipient]) => {
          if (!recipient) return;
          sendNewMessageEmail(recipient.email, recipient.fullName, sender.fullName, preview, recipientLinkUrl)
            .catch((err) => console.error('[email] message notify failed:', err));
        })
        .catch(() => {});
    })
    .catch(() => {});

  // Return with sender info joined
  const [row] = await db
    .select({
      id: applicationMessages.id,
      applicationId: applicationMessages.applicationId,
      senderId: applicationMessages.senderId,
      senderName: users.fullName,
      senderAvatarUrl: users.avatarUrl,
      content: applicationMessages.content,
      isRead: applicationMessages.isRead,
      createdAt: applicationMessages.createdAt,
    })
    .from(applicationMessages)
    .innerJoin(users, eq(users.id, applicationMessages.senderId))
    .where(eq(applicationMessages.id, inserted.id))
    .limit(1);

  return row;
}

/** Get unread message count for an application (for badge display without opening thread) */
export async function getUnreadMessageCount(applicationId: string, userId: string): Promise<number> {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.seekerId !== userId && app.referrerId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  }

  const rows = await db
    .select({ id: applicationMessages.id })
    .from(applicationMessages)
    .where(
      and(
        eq(applicationMessages.applicationId, applicationId),
        ne(applicationMessages.senderId, userId),
        eq(applicationMessages.isRead, false),
      ),
    );

  return rows.length;
}
