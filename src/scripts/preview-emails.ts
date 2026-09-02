/**
 * Email template preview — sends every DirectRef email to one inbox.
 *
 * WHY THIS EXISTS:
 * Proofreading all 14 templates by clicking through the product takes two
 * accounts and five days of scheduler time. This sends them all in one pass
 * so copy, branding, and escaping can be checked in a real email client.
 *
 * USAGE:
 *   npm run email:preview -- you@example.com            # all templates
 *   npm run email:preview -- you@example.com reminder   # only names matching "reminder"
 *
 * The sample data deliberately includes HTML-hostile characters (<, &, ")
 * — if any of them render as markup instead of text, escaping has regressed.
 */
import { env } from '../config/env';
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendCVNotificationEmail,
  sendCVViewedEmail,
  sendCVForwardedEmail,
  sendForwardedToHREmail,
  sendReminderEmail,
  sendSecondReminderEmail,
  sendExpiredEmail,
  sendCVDownloadedEmail,
  sendSubmitReminderEmail,
  sendSubmitFollowupEmail,
  sendInternallySubmittedEmail,
  sendNewMessageEmail,
} from '../services/email';

const to = process.argv[2];
const filter = (process.argv[3] ?? '').toLowerCase();

if (!to || !to.includes('@')) {
  console.error('Usage: npm run email:preview -- <recipient@email> [name-filter]');
  process.exit(1);
}

// Sample cast — the seeker's name and company carry markup on purpose (see header).
const seeker = 'Dana <script>Cohen</script>';
const referrer = 'Roni "The Connector" Levi';
const job = 'Senior Product Manager, Growth & Retention';
const company = 'Acme R&D Ltd.';
const note = 'Worked with Dana before — strong PM & a great culture fit. <b>Highly recommend.</b>';
const inboxUrl = `${env.FRONTEND_URL}/applications/inbox`;
const appsUrl = `${env.FRONTEND_URL}/applications`;
const cvViewUrl = `${env.FRONTEND_URL}/applications/preview-id/cv`;

const templates: Array<[name: string, send: () => Promise<void>]> = [
  ['verification',          () => sendVerificationEmail(to, 'preview-token', seeker)],
  ['password-reset',        () => sendPasswordResetEmail(to, 'preview-token')],
  ['cv-received',           () => sendCVNotificationEmail(to, referrer, seeker, job, company, inboxUrl)],
  ['cv-viewed',             () => sendCVViewedEmail(to, seeker, referrer, job, company, appsUrl)],
  ['cv-downloaded',         () => sendCVDownloadedEmail(to, seeker, referrer, job, company, appsUrl)],
  ['forwarded-to-hr',       () => sendForwardedToHREmail(to, referrer, note, seeker, job, company, cvViewUrl)],
  ['cv-forwarded-seeker',   () => sendCVForwardedEmail(to, seeker, referrer, job, company, appsUrl)],
  ['internally-submitted',  () => sendInternallySubmittedEmail(to, seeker, referrer, job, company, appsUrl)],
  ['reminder-day1',         () => sendReminderEmail(to, referrer, seeker, job, company, inboxUrl)],
  ['reminder-day2',         () => sendSecondReminderEmail(to, referrer, seeker, job, company, inboxUrl)],
  ['submit-reminder-day2',  () => sendSubmitReminderEmail(to, referrer, seeker, job, company, inboxUrl)],
  ['submit-followup-day3',  () => sendSubmitFollowupEmail(to, referrer, seeker, job, company, inboxUrl)],
  ['expired-day5',          () => sendExpiredEmail(to, seeker, referrer, job, company, appsUrl)],
  ['new-message',           () => sendNewMessageEmail(to, seeker, referrer, 'Hi! Quick question about the role — is it hybrid or fully remote?', inboxUrl)],
];

// Resend rate-limits to ~2 req/s — a small gap keeps the whole batch clean.
const GAP_MS = 700;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const selected = templates.filter(([name]) => name.includes(filter));
  if (!selected.length) {
    console.error(`No templates match "${filter}". Available: ${templates.map(([n]) => n).join(', ')}`);
    process.exit(1);
  }

  console.log(`Sending ${selected.length} preview email(s) to ${to} from ${env.EMAIL_FROM}\n`);
  let failed = 0;
  for (const [name, send] of selected) {
    try {
      await send();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${name}:`, err instanceof Error ? err.message : err);
    }
    await sleep(GAP_MS);
  }

  console.log(failed ? `\nDone with ${failed} failure(s).` : '\nAll sent — check the inbox (and the Resend dashboard for rendered bodies).');
  process.exit(failed ? 1 : 0);
}

main();
