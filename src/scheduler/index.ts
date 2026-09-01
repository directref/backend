import { runEscalationSweep } from './escalationSweep';

// No existing job/cron infrastructure in this app — a plain interval is all
// a single-process MVP needs. Runs every 15 minutes; each phase inside the
// sweep is idempotent, so a missed or overlapping tick never double-sends.
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export function startScheduler(): void {
  runEscalationSweep().catch((err) => console.error('[scheduler] initial sweep failed:', err));
  setInterval(() => {
    runEscalationSweep().catch((err) => console.error('[scheduler] sweep failed:', err));
  }, SWEEP_INTERVAL_MS);
  console.log(`   Scheduler:   escalation sweep every ${SWEEP_INTERVAL_MS / 60_000}m\n`);
}
