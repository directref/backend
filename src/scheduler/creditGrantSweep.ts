import { grantMonthlyCredits } from '../modules/credits/credits.service';

/**
 * Grants every user their +1 recurring monthly credit. Idempotent per user
 * per calendar month (see credits.service.ts), so running this on every
 * scheduler tick — same as the escalation sweep — is safe; it's a no-op for
 * anyone who's already had this month's grant.
 */
export async function runCreditGrantSweep(): Promise<void> {
  const granted = await grantMonthlyCredits();
  if (granted > 0) {
    console.log(`[credit-grant-sweep] granted the monthly credit to ${granted} user(s)`);
  }
}
