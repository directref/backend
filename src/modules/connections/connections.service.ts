import { db } from '../../config/db';
import { connections, users } from '../../db/schema';
import { eq, or, and } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { createNotification } from '../notifications/notifications.service';

export async function sendRequest(requesterId: string, addresseeId: string) {
  if (requesterId === addresseeId) {
    throw new AppError(400, 'INVALID_REQUEST', 'You cannot connect with yourself');
  }

  const [existing] = await db
    .select()
    .from(connections)
    .where(
      or(
        and(eq(connections.requesterId, requesterId), eq(connections.addresseeId, addresseeId)),
        and(eq(connections.requesterId, addresseeId), eq(connections.addresseeId, requesterId)),
      ),
    )
    .limit(1);

  if (existing) {
    throw new AppError(409, 'CONNECTION_EXISTS', `A connection request already exists (status: ${existing.status})`);
  }

  const [connection] = await db.insert(connections).values({ requesterId, addresseeId }).returning();

  // Notify the addressee of the new request
  const [requester] = await db.select().from(users).where(eq(users.id, requesterId)).limit(1);
  if (requester) {
    createNotification(
      addresseeId,
      'connection_request',
      `${requester.fullName} wants to connect`,
      'Accept their request to see jobs at their company.',
      '/network',
    ).catch(() => {});
  }

  return connection;
}

export async function listConnections(userId: string, status?: string, direction?: string) {
  const baseWhere = or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId));

  // Fetch raw connection rows first
  const rows = await db
    .select()
    .from(connections)
    .where(baseWhere);

  const filtered = rows.filter((r) => {
    if (status && r.status !== status) return false;
    if (direction === 'sent' && r.requesterId !== userId) return false;
    if (direction === 'received' && r.addresseeId !== userId) return false;
    return true;
  });

  // For each connection, look up the OTHER person (not the viewer)
  const result = await Promise.all(
    filtered.map(async (conn) => {
      const otherId = conn.requesterId === userId ? conn.addresseeId : conn.requesterId;
      const [other] = await db
        .select({
          id: users.id,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
          companyName: users.companyName,
          headline: users.headline,
        })
        .from(users)
        .where(eq(users.id, otherId))
        .limit(1);
      return {
        id: conn.id,
        requesterId: conn.requesterId,
        addresseeId: conn.addresseeId,
        status: conn.status,
        createdAt: conn.createdAt,
        // Always expose the other person as "requester" so the frontend can display them
        requester: other ?? null,
      };
    }),
  );

  return result;
}

export async function updateConnection(connectionId: string, userId: string, status: 'accepted' | 'rejected') {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new AppError(404, 'NOT_FOUND', 'Connection not found');
  if (conn.addresseeId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'Only the addressee can accept or reject a connection request');
  }
  if (conn.status !== 'pending') {
    throw new AppError(400, 'INVALID_STATE', 'Connection request has already been handled');
  }

  const [updated] = await db
    .update(connections)
    .set({ status, updatedAt: new Date() })
    .where(eq(connections.id, connectionId))
    .returning();

  // Notify the original requester when accepted
  if (status === 'accepted') {
    const [accepter] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (accepter) {
      createNotification(
        conn.requesterId,
        'connection_accepted',
        `${accepter.fullName} accepted your connection`,
        'You can now see their job postings and send your CV.',
        '/network',
      ).catch(() => {});
    }
  }

  return updated;
}

export async function removeConnection(connectionId: string, userId: string): Promise<void> {
  const [conn] = await db.select().from(connections).where(eq(connections.id, connectionId)).limit(1);
  if (!conn) throw new AppError(404, 'NOT_FOUND', 'Connection not found');
  if (conn.requesterId !== userId && conn.addresseeId !== userId) {
    throw new AppError(403, 'FORBIDDEN', 'You are not part of this connection');
  }
  await db.delete(connections).where(eq(connections.id, connectionId));
}

export async function getMutualInfo(userId: string, targetId: string) {
  const [conn] = await db
    .select()
    .from(connections)
    .where(
      and(
        or(
          and(eq(connections.requesterId, userId), eq(connections.addresseeId, targetId)),
          and(eq(connections.requesterId, targetId), eq(connections.addresseeId, userId)),
        ),
        eq(connections.status, 'accepted'),
      ),
    )
    .limit(1);

  return { isFriend: !!conn, connectionId: conn?.id ?? null };
}

/**
 * Returns true if userA and userB have an accepted connection in either direction.
 * Used internally by the applications service.
 */
export async function areFriends(userAId: string, userBId: string): Promise<boolean> {
  const { isFriend } = await getMutualInfo(userAId, userBId);
  return isFriend;
}
