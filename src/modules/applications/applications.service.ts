import path from 'path';
import fs from 'fs';
import { db } from '../../config/db';
import { applications, jobs, users } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { areFriends } from '../connections/connections.service';
import { createNotification } from '../notifications/notifications.service';
import { sendCVNotificationEmail, sendForwardedToHREmail, sendCVViewedEmail, sendCVForwardedEmail } from '../../services/email';
import { env } from '../../config/env';
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

  // 3. No duplicate applications
  const [existing] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.jobId, dto.jobId), eq(applications.seekerId, seekerId)))
    .limit(1);

  if (existing) {
    fs.unlink(file.path, () => {});
    throw new AppError(409, 'ALREADY_APPLIED', 'You have already sent your CV for this job');
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
      seeker: { id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl, headline: users.headline },
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

export async function updateStatus(applicationId: string, referrerId: string, status: 'viewed' | 'rejected') {
  const [app] = await db.select().from(applications).where(eq(applications.id, applicationId)).limit(1);
  if (!app) throw new AppError(404, 'NOT_FOUND', 'Application not found');
  if (app.referrerId !== referrerId) throw new AppError(403, 'FORBIDDEN', 'Access denied');

  const [updated] = await db
    .update(applications)
    .set({ status, updatedAt: new Date() })
    .where(eq(applications.id, applicationId))
    .returning();

  // Notify seeker when declined
  if (status === 'rejected') {
    const [job]      = await db.select().from(jobs).where(eq(jobs.id, app.jobId)).limit(1);
    const [referrer] = await db.select().from(users).where(eq(users.id, referrerId)).limit(1);
    if (job && referrer) {
      createNotification(
        app.seekerId,
        'cv_rejected',
        `${referrer.fullName} couldn't move forward with your CV`,
        `Your application for ${job.title} at ${job.companyName} wasn't the right fit this time.`,
        `${env.FRONTEND_URL}/applications`,
      ).catch(() => {});
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
      .set({ status: 'viewed', updatedAt: new Date() })
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
      .set({ status: 'viewed', updatedAt: new Date() })
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
