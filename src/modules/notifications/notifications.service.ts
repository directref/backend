import { db } from '../../config/db';
import { notifications } from '../../db/schema';
import { eq, and, desc } from 'drizzle-orm';

export type NotificationType = 'cv_viewed' | 'cv_forwarded' | 'cv_received' | 'connection_request' | 'connection_accepted';

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
