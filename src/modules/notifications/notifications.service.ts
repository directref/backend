import { db } from '../../config/db';
import { notifications } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export type NotificationType =
  | 'cv_viewed'
  | 'cv_forwarded'
  | 'cv_received'
  | 'cv_rejected'
  | 'cv_reminder'              // Clock A Day 1 — nudges the referrer, who hasn't acted yet
  | 'cv_escalated'             // Clock A Day 2 — stronger reminder to the referrer, with a deadline
  | 'cv_expired'               // Day 5 — application auto-closed with no response (either clock)
  | 'cv_submit_reminder'       // Clock B Day 2 from download — did you submit this internally?
  | 'cv_submit_followup'       // Clock B Day 3 from download — final reminder
  | 'cv_internally_submitted'  // referrer confirmed they submitted the CV internally
  | 'application_message'
  | 'connection_request'
  | 'connection_accepted'
  | 'job_deletion_warning';   // inactive job posting will be permanently deleted in 3 days

/** Create a notification for a user */
export async function createNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  linkUrl?: string,
) {
  const [n] = await db.insert(notifications).values({ userId, type, title, body, linkUrl }).returning();
  return n;
}

/** Get all notifications for a user, newest first */
export async function getNotifications(userId: string, limit = 50) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/** Count unread notifications */
export async function getUnreadCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  return rows.length;
}

/** Mark a single notification as read */
export async function markRead(notificationId: string, userId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

/** Mark all notifications as read */
export async function markAllRead(userId: string) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}
