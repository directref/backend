import { Resend } from 'resend';
import { env } from '../config/env';

// Use a dummy key if not configured — emails just won't send
const resend = new Resend(env.RESEND_API_KEY || 're_placeholder_key');

// Matches the app's actual palette (globals.css gold-300/500), not a generic default.
const brand = {
  gold: '#D4AF7A',     // button fill
  goldText: '#A87D3A', // gold at readable contrast on white — wordmark, links
  ink: '#1A1206',      // text on gold
  name: 'DirectRef',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Every user-supplied value (names, job titles, company names, notes) MUST go
// through this before landing in an HTML body. Subjects are plain text — no
// escaping there, or entities would show literally.
const esc = escapeHtml;

function btn(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:${brand.gold};color:${brand.ink};padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-family:system-ui,sans-serif;">${label}</a>`;
}

function layout(body: string) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#24180c;">
      <div style="padding:24px 0 8px;">
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:${brand.goldText};">${brand.name}</span>
      </div>
      <div style="background:#FAF6EF;border:1px solid #EDE2CE;border-radius:12px;padding:28px;">
        ${body}
      </div>
      <p style="font-size:12px;color:#8a7a63;margin-top:16px;text-align:center;">
        You're receiving this because you use ${brand.name}.
        <a href="${env.FRONTEND_URL}" style="color:${brand.goldText};">Open app →</a>
      </p>
    </div>
  `;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function sendVerificationEmail(to: string, token: string, name: string): Promise<void> {
  const link = `${env.FRONTEND_URL}/verify-email?token=${token}`;
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: `Verify your ${brand.name} account`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Welcome to ${brand.name}, ${esc(name)}!</h2>
      <p style="color:#555;">Please verify your email to get started:</p>
      ${btn(link, 'Verify Email')}
      <p style="font-size:12px;color:#999;margin-top:16px;">This link expires in 24 hours.</p>
    `),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject: 'Reset your password',
    html: layout(`
      <h2 style="margin:0 0 8px;">Password Reset</h2>
      <p style="color:#555;">Click below to reset your password. This link expires in 1 hour.</p>
      ${btn(link, 'Reset Password')}
      <p style="font-size:12px;color:#999;margin-top:16px;">If you didn't request this, you can safely ignore this email.</p>
    `),
  });
}

// ── CV received (notify referrer) ─────────────────────────────────────────────

export async function sendCVNotificationEmail(
  referrerEmail: string,
  referrerName: string,
  seekerName: string,
  jobTitle: string,
  companyName: string,
  dashboardUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: referrerEmail,
    subject: `${seekerName} sent you their CV`,
    html: layout(`
      <h2 style="margin:0 0 8px;">New CV in your inbox</h2>
      <p style="color:#555;">
        <strong>${esc(seekerName)}</strong> sent you their CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong>.
      </p>
      ${btn(dashboardUrl, 'View CV in Dashboard')}
    `),
  });
}

// ── CV viewed (notify seeker) ─────────────────────────────────────────────────

export async function sendCVViewedEmail(
  seekerEmail: string,
  seekerName: string,
  referrerName: string,
  jobTitle: string,
  companyName: string,
  applicationsUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: seekerEmail,
    subject: `${referrerName} viewed your CV`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Your CV was viewed</h2>
      <p style="color:#555;">
        <strong>${esc(referrerName)}</strong> opened your CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong>.
      </p>
      <p style="color:#555;">They haven't forwarded it to HR yet — hang tight!</p>
      ${btn(applicationsUrl, 'View My Applications')}
    `),
  });
}

// ── CV forwarded to HR (notify seeker) ───────────────────────────────────────

export async function sendCVForwardedEmail(
  seekerEmail: string,
  seekerName: string,
  referrerName: string,
  jobTitle: string,
  companyName: string,
  applicationsUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: seekerEmail,
    subject: `Your CV was forwarded to HR at ${companyName}`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Great news, ${esc(seekerName)}!</h2>
      <p style="color:#555;">
        <strong>${esc(referrerName)}</strong> forwarded your CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong> to their HR team.
      </p>
      <p style="color:#555;">Your application is now in front of the hiring manager. Good luck!</p>
      ${btn(applicationsUrl, 'View My Applications')}
    `),
  });
}

// ── Forward to HR (notify HR) ─────────────────────────────────────────────────

export async function sendForwardedToHREmail(
  hrEmail: string,
  referrerName: string,
  referrerNote: string | null,
  seekerName: string,
  jobTitle: string,
  companyName: string,
  cvViewUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: hrEmail,
    subject: `Referral: ${seekerName} for ${jobTitle}`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Employee Referral</h2>
      <p style="color:#555;">
        <strong>${esc(referrerName)}</strong> is referring <strong>${esc(seekerName)}</strong>
        for <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong>.
      </p>
      ${referrerNote ? `<blockquote style="border-left:3px solid ${brand.gold};margin:16px 0;padding-left:12px;color:#555;font-style:italic;">"${esc(referrerNote)}"</blockquote>` : ''}
      ${btn(cvViewUrl, 'View CV')}
    `),
  });
}

// ── Clock A — Day 1 reminder, Day 2 stronger reminder, Day 5 auto-cancel ──────

/** Day 1 — nudges the referrer that a CV is still waiting on them. */
export async function sendReminderEmail(
  referrerEmail: string,
  referrerName: string,
  seekerName: string,
  jobTitle: string,
  companyName: string,
  inboxUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: referrerEmail,
    subject: `Reminder: ${seekerName}'s CV is still waiting on you`,
    html: layout(`
      <h2 style="margin:0 0 8px;">A CV is waiting on you</h2>
      <p style="color:#555;">
        It's been a day since <strong>${esc(seekerName)}</strong> sent their CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong>. They're still waiting to hear
        whether you can refer them.
      </p>
      ${btn(inboxUrl, 'Review the CV')}
    `),
  });
}

/** Day 2 — a stronger nudge to the referrer, now with a deadline attached. */
export async function sendSecondReminderEmail(
  referrerEmail: string,
  referrerName: string,
  seekerName: string,
  jobTitle: string,
  companyName: string,
  inboxUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: referrerEmail,
    subject: `${seekerName}'s CV resets in 3 days — please respond`,
    html: layout(`
      <h2 style="margin:0 0 8px;">This one's about to reset</h2>
      <p style="color:#555;">
        It's been 2 days since <strong>${esc(seekerName)}</strong> sent their CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong>, and there's still no decision.
      </p>
      <p style="color:#555;">
        <strong>3 more days</strong> and this application resets automatically, refunding their credit.
        A quick "not a fit" is fine too — they just need an answer.
      </p>
      ${btn(inboxUrl, 'Review the CV')}
    `),
  });
}

/** Day 5 — the application auto-closed with no response; the seeker's credit is refunded.
 *  Reused by both clocks (never looked at it, or downloaded but never confirmed). */
export async function sendExpiredEmail(
  seekerEmail: string,
  seekerName: string,
  referrerName: string,
  jobTitle: string,
  companyName: string,
  applicationsUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: seekerEmail,
    subject: `No response from ${referrerName} — your credit was refunded`,
    html: layout(`
      <h2 style="margin:0 0 8px;">This one closed without an answer</h2>
      <p style="color:#555;">
        <strong>${esc(referrerName)}</strong> didn't respond to your CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong> within 5 days, so we've closed
        this application automatically.
      </p>
      <p style="color:#555;"><strong>Your credit has been refunded</strong> — use it on another role whenever you're ready.</p>
      ${btn(applicationsUrl, 'Browse Other Roles')}
    `),
  });
}

// ── Clock B — from download: seeker notice, Day 2 / Day 3 submit reminders ────

/** The referrer downloaded the CV — tell the seeker. */
export async function sendCVDownloadedEmail(
  seekerEmail: string,
  seekerName: string,
  referrerName: string,
  jobTitle: string,
  companyName: string,
  applicationsUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: seekerEmail,
    subject: `${referrerName} downloaded your CV`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Good sign, ${esc(seekerName)}!</h2>
      <p style="color:#555;">
        <strong>${esc(referrerName)}</strong> downloaded your CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong> — they're moving forward with it.
      </p>
      <p style="color:#555;">We'll let you know as soon as it's submitted into their internal system.</p>
      ${btn(applicationsUrl, 'View My Applications')}
    `),
  });
}

/** Day 2 from download — ask the referrer whether they submitted it internally. */
export async function sendSubmitReminderEmail(
  referrerEmail: string,
  referrerName: string,
  seekerName: string,
  jobTitle: string,
  companyName: string,
  inboxUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: referrerEmail,
    subject: `Did you submit ${seekerName}'s CV internally yet?`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Quick check-in</h2>
      <p style="color:#555;">
        You downloaded <strong>${esc(seekerName)}</strong>'s CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong> a couple of days ago.
        Once it's in your company's system, let them know — it only takes a click.
      </p>
      ${btn(inboxUrl, 'Confirm Submission')}
    `),
  });
}

/** Day 3 from download — a final reminder before this heads toward auto-cancel. */
export async function sendSubmitFollowupEmail(
  referrerEmail: string,
  referrerName: string,
  seekerName: string,
  jobTitle: string,
  companyName: string,
  inboxUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: referrerEmail,
    subject: `Last check: did ${seekerName}'s CV get submitted?`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Still waiting to hear back from you</h2>
      <p style="color:#555;">
        <strong>${esc(seekerName)}</strong>'s CV for <strong>${esc(jobTitle)}</strong> at
        <strong>${esc(companyName)}</strong> is still marked as downloaded, not submitted.
      </p>
      <p style="color:#555;"><strong>2 more days</strong> and this resets automatically, refunding their credit.</p>
      ${btn(inboxUrl, 'Confirm Submission')}
    `),
  });
}

/** The referrer confirmed the CV was submitted into their internal system. */
export async function sendInternallySubmittedEmail(
  seekerEmail: string,
  seekerName: string,
  referrerName: string,
  jobTitle: string,
  companyName: string,
  applicationsUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: seekerEmail,
    subject: `Your CV was submitted internally at ${companyName}`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Great news, ${esc(seekerName)}!</h2>
      <p style="color:#555;">
        <strong>${esc(referrerName)}</strong> confirmed your CV for
        <strong>${esc(jobTitle)}</strong> at <strong>${esc(companyName)}</strong> has been submitted into their
        internal system. Good luck!
      </p>
      ${btn(applicationsUrl, 'View My Applications')}
    `),
  });
}

// ── Messaging ───────────────────────────────────────────────────────────────

export async function sendNewMessageEmail(
  recipientEmail: string,
  recipientName: string,
  senderName: string,
  preview: string,
  threadUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: recipientEmail,
    subject: `${senderName} sent you a message`,
    html: layout(`
      <h2 style="margin:0 0 8px;">New message from ${escapeHtml(senderName)}</h2>
      <p style="color:#555;font-style:italic;">"${escapeHtml(preview)}"</p>
      ${btn(threadUrl, 'Reply')}
    `),
  });
}
