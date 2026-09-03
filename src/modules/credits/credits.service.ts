import { db } from '../../config/db';
import { users, creditPurchases } from '../../db/schema';
import { eq, and, gt, asc, sql } from 'drizzle-orm';
import { AppError } from '../../middleware/errorHandler';

export interface CreditPackage {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
  featured?: boolean;
}

// Buying credits is currently disabled (see credits.controller.ts /
// credits.router.ts and the frontend's /credits page + OutOfCreditsModal).
// Left intact, not deleted, so it's a quick flip back on if paid packs
// launch later.
export const CREDIT_PACKAGES: CreditPackage[] = [
  { id: 'starter', name: 'Starter', credits: 3,  price: 29, currency: 'ILS' },
  { id: 'growth',  name: 'Growth',  credits: 5,  price: 45, currency: 'ILS', featured: true },
  { id: 'bulk',    name: 'Bulk',    credits: 10, price: 80, currency: 'ILS' },
];

export function getPackages(): CreditPackage[] {
  return CREDIT_PACKAGES;
}

const SIGNUP_CREDITS = 3;
const MONTHLY_CREDITS = 1;

function currentMonth(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Credits under the current model never expire, but credit_purchases.expires_at
// is NOT NULL (that table doubles as the general credit-grant ledger — signup,
// monthly, refunds — 'purchases' is a legacy name from when it only held paid
// packs). Set far enough out that it never practically matters.
function neverExpires(): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 100);
  return d;
}

/**
 * One-time signup bonus. Call exactly once, right after a new user row is
 * created (all three signup paths: email/password, Google, LinkedIn).
 */
export async function grantSignupCredits(userId: string): Promise<void> {
  await db.insert(creditPurchases).values({
    userId,
    packageId: 'signup',
    credits: SIGNUP_CREDITS,
    remainingCredits: SIGNUP_CREDITS,
    pricePaid: '0',
    currency: 'ILS',
    expiresAt: neverExpires(),
  });
  // freeCreditsMonth doubles as "last calendar month this user received a
  // recurring grant" — stamp it now so grantMonthlyCredits doesn't also
  // hand out a redundant +1 for the signup month itself.
  await db.update(users).set({ freeCreditsMonth: currentMonth(), updatedAt: new Date() }).where(eq(users.id, userId));
}

/**
 * Recurring +1/month grant for every user, run by the scheduler (see
 * scheduler/creditGrantSweep.ts). Idempotent per user per calendar month via
 * users.freeCreditsMonth, so a missed or repeated sweep tick never double-grants.
 */
export async function grantMonthlyCredits(): Promise<number> {
  const month = currentMonth();
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.freeCreditsMonth} IS DISTINCT FROM ${month}`);

  for (const u of due) {
    await db.insert(creditPurchases).values({
      userId: u.id,
      packageId: 'monthly',
      credits: MONTHLY_CREDITS,
      remainingCredits: MONTHLY_CREDITS,
      pricePaid: '0',
      currency: 'ILS',
      expiresAt: neverExpires(),
    });
    await db.update(users).set({ freeCreditsMonth: month, updatedAt: new Date() }).where(eq(users.id, u.id));
  }
  return due.length;
}

export interface CreditBalance {
  total: number;
}

export async function getBalance(userId: string): Promise<CreditBalance> {
  const rows = await db
    .select({ remainingCredits: creditPurchases.remainingCredits })
    .from(creditPurchases)
    .where(and(
      eq(creditPurchases.userId, userId),
      gt(creditPurchases.expiresAt, new Date()),
      gt(creditPurchases.remainingCredits, 0),
    ));
  return { total: rows.reduce((sum, r) => sum + r.remainingCredits, 0) };
}

/**
 * Spends exactly one credit — oldest non-expired grant first (FIFO),
 * regardless of whether it came from signup, a monthly grant, or a refund.
 * Throws OUT_OF_CREDITS if none is available. Currently only called from
 * the referrer side ("Post a job") — sending a C.V. doesn't spend one.
 */
export async function spendCredit(userId: string): Promise<void> {
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
}

/**
 * Refunds exactly one credit to the user's general balance (never-expiring,
 * untagged by origin). Not currently called anywhere — sending a C.V. no
 * longer spends a credit, so the escalation sweep's Day-5 auto-cancel has
 * nothing to refund. Kept for a manual/support-tooling refund on the
 * referrer's job-posting credit, should that ever be needed.
 */
export async function refundCredit(userId: string): Promise<void> {
  await db.insert(creditPurchases).values({
    userId,
    packageId: 'refund',
    credits: 1,
    remainingCredits: 1,
    pricePaid: '0',
    currency: 'ILS',
    expiresAt: neverExpires(),
  });
}

// ── Purchasing is disabled — kept for a quick re-enable, not wired into any
// reachable route (see credits.router.ts) or UI. ──────────────────────────
// /** Stubbed purchase — no real payment processor yet, grants credits immediately. */
// export async function purchaseCredits(userId: string, packageId: string): Promise<CreditBalance> {
//   const pkg = CREDIT_PACKAGES.find((p) => p.id === packageId);
//   if (!pkg) throw new AppError(400, 'INVALID_PACKAGE', 'Unknown credit package');
//
//   const expiresAt = new Date();
//   expiresAt.setMonth(expiresAt.getMonth() + 12);
//
//   await db.insert(creditPurchases).values({
//     userId,
//     packageId: pkg.id,
//     credits: pkg.credits,
//     remainingCredits: pkg.credits,
//     pricePaid: String(pkg.price),
//     currency: pkg.currency,
//     expiresAt,
//   });
//
//   return getBalance(userId);
// }
