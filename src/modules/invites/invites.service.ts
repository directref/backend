import crypto from 'crypto';
import { db } from '../../config/db';
import { invites, users, connections } from '../../db/schema';
import { eq, and, or } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';
import { env } from '../../config/env';
import { createNotification } from '../notifications/notifications.service';

/** Generate a unique invite token */
function generateToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

/** Generate a short invite code from name (e.g. "maya-x7k2") */
export function generateInviteCode(fullName: string): string {
  const first = fullName.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${first}-${suffix}`;
}

/** Get or create the user's personal invite link token */
export async function getOrCreateInviteLink(inviterId: string): Promise<string> {
  // Check for existing unused invite (re-use the same one)
  const [existing] = await db
    .select()
    .from(invites)
    .where(and(eq(invites.inviterId, inviterId), eq(invites.usedAt, null as unknown as Date)))
    .limit(1);

  if (existing) {
    return `${env.FRONTEND_URL}/join/${existing.token}`;
  }

  const token = generateToken();
  await db.insert(invites).values({ inviterId, token });
  return `${env.FRONTEND_URL}/join/${token}`;
}

/** Validate a token before signup — returns inviter info */
export async function getInviteInfo(token: string) {
  const [invite] = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
  if (!invite) throw new AppError(404, 'INVITE_NOT_FOUND', 'Invalid or expired invite link');
  if (invite.usedAt) throw new AppError(400, 'INVITE_USED', 'This invite link has already been used');

  const [inviter] = await db.select({
    id: users.id,
    fullName: users.fullName,
    companyName: users.companyName,
    avatarUrl: users.avatarUrl,
  }).from(users).where(eq(users.id, invite.inviterId)).limit(1);

  if (!inviter) throw new AppError(404, 'INVITE_NOT_FOUND', 'Inviter not found');
  return { inviter, token };
}

/** Redeem an invite after signup — auto-connect inviter + new user */
export async function redeemInvite(token: string, newUserId: string): Promise<void> {
  const [invite] = await db.select().from(invites).where(eq(invites.token, token)).limit(1);
  if (!invite || invite.usedAt) return; // silently ignore

  // Mark invite as used
  await db.update(invites).set({ usedAt: new Date(), usedByUserId: newUserId }).where(eq(invites.id, invite.id));

  // Mark new user as invited by
  await db.update(users).set({ invitedById: invite.inviterId, updatedAt: new Date() }).where(eq(users.id, newUserId));

  // Check if connection already exists
  const [existingConn] = await db.select().from(connections).where(
    or(
      and(eq(connections.requesterId, invite.inviterId), eq(connections.addresseeId, newUserId)),
      and(eq(connections.requesterId, newUserId), eq(connections.addresseeId, invite.inviterId)),
    ),
  ).limit(1);

  if (!existingConn) {
    // Auto-create an accepted connection — no pending step needed for invite
    await db.insert(connections).values({
      requesterId: invite.inviterId,
      addresseeId: newUserId,
      status: 'accepted',
    });
  }

  // Notify inviter
  const [newUser] = await db.select().from(users).where(eq(users.id, newUserId)).limit(1);
  if (newUser) {
    createNotification(
      invite.inviterId,
      'connection_accepted',
      `${newUser.fullName} joined via your invite`,
      `You're now connected — you can see each other's job postings.`,
      '/network',
    ).catch(() => {});
  }
}

/** Get colleagues — users at the same company, not yet connected */
export async function getColleagues(userId: string, companyName: string) {
  if (!companyName.trim()) return [];

  // Get all user IDs already connected
  const existingConns = await db.select({
    requesterId: connections.requesterId,
    addresseeId: connections.addresseeId,
  }).from(connections).where(
    or(eq(connections.requesterId, userId), eq(connections.addresseeId, userId)),
  );

  const connectedIds = new Set<string>();
  existingConns.forEach((c) => {
    connectedIds.add(c.requesterId === userId ? c.addresseeId : c.requesterId);
  });
  connectedIds.add(userId); // exclude self

  // Find users at same company
  const colleagues = await db.select({
    id: users.id,
    fullName: users.fullName,
    headline: users.headline,
    avatarUrl: users.avatarUrl,
    companyName: users.companyName,
  }).from(users).where(eq(users.companyName, companyName)).limit(20);

  return colleagues.filter((u) => !connectedIds.has(u.id));
}
