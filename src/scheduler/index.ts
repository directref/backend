import { runEscalationSweep } from './escalationSweep';
import { runCreditGrantSweep } from './creditGrantSweep';
import { runJobCleanupSweep } from './jobCleanupSweep';
import { runJobLivenessSweep } from './jobLivenessSweep';

// No existing job/cron infrastructure in this app — a plain interval is all
// a single-process MVP needs. Runs every 15 minutes; each phase inside the
// sweep is idempotent, so a missed or overlapping tick never double-sends
// (or, for credits, never double-grants; for job cleanup, never double-warns
// or re-deletes; for liveness, each job is only actually re-checked once a
// day regardless of how many 15-minute ticks pass — see JOB_LIVENESS_CHECK_MS).
const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

function runAllSweeps(): void {
  runEscalationSweep().catch((err) => console.error('[scheduler] escalation sweep failed:', err));
  runCreditGrantSweep().catch((err) => console.error('[scheduler] credit grant sweep failed:', err));
  runJobCleanupSweep().catch((err) => console.error('[scheduler] job cleanup sweep failed:', err));
  runJobLivenessSweep().catch((err) => console.error('[scheduler] job liveness sweep failed:', err));
}

export function startScheduler(): void {
  runAllSweeps();
  setInterval(runAllSweeps, SWEEP_INTERVAL_MS);
  console.log(`   Scheduler:   escalation + credit grant + job cleanup + job liveness sweeps every ${SWEEP_INTERVAL_MS / 60_000}m\n`);
}
