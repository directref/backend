import { db } from '../../config/db';
import { users, creditPurchases } from '../../db/schema';
import { eq, and, gt, asc } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
  featured?: boolean;
}

// Placeholder pricing — no payment processor integrated yet. Swap these
// values (and wire a real processor into purchaseCredits below) once real
// numbers/a provider are decided.
export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'starter', name: 'Starter', credits: 3,  price: 29, currency: 'ILS' },
  { id: 'growth',  name: 'Growth',  credits: 5,  price: 45, currency: 'ILS', featured: true },
  { id: 'bulk',    name: 'Bulk',    credits: 10, price: 80, currency: 'ILS' },
];

export function getPackages(): CreditPackage[] {
  return CREDIT_PACKAGES;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Resets the free credit if the calendar month has rolled over since it was last touched. */
async function ensureFreeCreditMonth(userId: string): Promise<{ freeCreditsUsed: boolean }> {
  const [user] = await db
    .select({ freeCreditsMonth: users.freeCreditsMonth, freeCreditsUsed: users.freeCreditsUsed })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User not found');

  const month = currentMonth();
  if (user.freeCreditsMonth === month) return user;

  await db.update(users)
    .set({ freeCreditsMonth: month, freeCreditsUsed: false, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return { freeCreditsUsed: false };
}

export interface CreditBalance {
  freeAvailable: number; // 0 or 1
  freeTotal: number;     // always 1
  purchased: number;
  total: number;
}

async function purchasedBalance(userId: string): Promise<number> {
  const rows = await db
    .select({ remainingCredits: creditPurchases.remainingCredits })
    .from(creditPurchases)
    .where(and(
      eq(creditPurchases.userId, userId),
      gt(creditPurchases.expiresAt, new Date()),
      gt(creditPurchases.remainingCredits, 0),
    ));
  return rows.reduce((sum, r) => sum + r.remainingCredits, 0);
}

export async function getBalance(userId: string): Promise<CreditBalance> {
  const free = await ensureFreeCreditMonth(userId);
  const purchased = await purchasedBalance(userId);
  const freeAvailable = free.freeCreditsUsed ? 0 : 1;
  return { freeAvailable, freeTotal: 1, purchased, total: freeAvailable + purchased };
}

/**
 * Spends exactly one credit for the given user — free credit first, then
 * the oldest non-expired purchase (FIFO). Throws OUT_OF_CREDITS if neither
 * is available. Used by both "Send My C.V." and "Post a job" — one shared
 * balance, no separate allowance per action.
 */
export async function spendCredit(userId: string): Promise<{ source: 'free' | 'purchased' }> {
  const free = await ensureFreeCreditMonth(userId);
  if (!free.freeCreditsUsed) {
    await db.update(users).set({ freeCreditsUsed: true, updatedAt: new Date() }).where(eq(users.id, userId));
    return { source: 'free' };
  }

  const [oldest] = await db
    .select({ id: creditPurchases.id, remainingCredits: creditPurchases.remainingCredits })
    .from(creditPurchases)
    .where(and(
      eq(creditPurchases.userId, userId),
      gt(creditPurchases.expiresAt, new Date()),
      gt(creditPurchases.remainingCredits, 0),
    ))
    .orderBy(asc(creditPurchases.purchasedAt))
    .limit(1);

  if (!oldest) {
    throw new AppError(402, 'OUT_OF_CREDITS', 'You need a credit to send a C.V. or post a job');
  }

  await db.update(creditPurchases)
    .set({ remainingCredits: oldest.remainingCredits - 1 })
    .where(eq(creditPurchases.id, oldest.id));

  return { source: 'purchased' };
}

/**
 * Refunds exactly one credit to the user's general balance (PRD: refunds
 * aren't tagged by origin). If this month's free credit was the one spent,
 * restore that; otherwise grant a purchased-style credit with a fresh
 * 12-month expiry. Used by the Day-5 auto-cancel sweep.
 */
export async function refundCredit(userId: string): Promise<void> {
  const free = await ensureFreeCreditMonth(userId);
  if (free.freeCreditsUsed) {
    await db.update(users).set({ freeCreditsUsed: false, updatedAt: new Date() }).where(eq(users.id, userId));
    return;
  }

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 12);
  await db.insert(creditPurchases).values({
    userId,
    packageId: 'refund',
    credits: 1,
    remainingCredits: 1,
    pricePaid: '0',
    currency: 'ILS',
    expiresAt,
  });
}

/** Stubbed purchase — no real payment processor yet, grants credits immediately. */
export async function purchaseCredits(userId: string, packageId: string): Promise<CreditBalance> {
  const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new AppError(400, 'INVALID_PACKAGE', 'Unknown credit package');

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + 12);

  await db.insert(creditPurchases).values({
    userId,
    packageId: pkg.id,
    credits: pkg.credits,
    remainingCredits: pkg.credits,
    pricePaid: String(pkg.price),
    currency: pkg.currency,
    expiresAt,
  });

  return getBalance(userId);
}
