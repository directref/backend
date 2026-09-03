import { runEscalationSweep } from './escalationSweep';
import { runCreditGrantSweep } from './creditGrantSweep';
import { runJobCleanupSweep } from './jobCleanupSweep';

// No existing job/cron infrastructure in this app — a plain interval is all
// a single-process MVP needs. Runs every 15 minutes; each phase inside the
// sweep is idempotent, so a missed or overlapping tick never double-sends
// (or, for credits, never double-grants; or, for job cleanup, never
// double-warns or re-deletes).
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function runAllSweeps(): void {
  runEscalationSweep().catch((err) => console.error('[scheduler] escalation sweep failed:', err));
  runCreditGrantSweep().catch((err) => console.error('[scheduler] credit grant sweep failed:', err));
  runJobCleanupSweep().catch((err) => console.error('[scheduler] job cleanup sweep failed:', err));
}

export function startScheduler(): void {
  runAllSweeps();
  setInterval(runAllSweeps, SWEEP_INTERVAL_MS);
  console.log(`   Scheduler:   escalation + credit grant + job cleanup sweeps every ${SWEEP_INTERVAL_MS / 60_000}m\n`);
}
