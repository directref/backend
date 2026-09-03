import { Resend } from 'resend';
import { env } from '../config/env';

// Use a dummy key if not configured — emails just won't send
const resend = new Resend(env.RESEND_API_KEY || 're_placeholder_key');

// ─────────────────────────────────────────────────────────────────────────────
// DirectRef email design system — ported from the design handoff
// (email-designs/DESIGN-GUIDELINES.md). Table-based layout with inline styles
// for Gmail/Outlook compatibility; no flex/grid, no media queries. Every email
// is composed from the block primitives below.
// ─────────────────────────────────────────────────────────────────────────────

const FONT = `'Rubik', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif`;

const color = {
  gold: '#d7a44a',       // primary CTA, accent dot
  goldSoft: '#f6e9cf',   // gold badge/card background, step counters
  goldInk: '#3a2f16',    // text on gold
  ink: '#2c2926',        // headings, strong inline text
  inkSecondary: '#6f6a64', // body text, links
  inkMuted: '#948e87',   // eyebrow, footer, meta
  border: '#e9e6e1',     // card borders, dividers
  background: '#faf9f7', // page background + neutral card fill
  surface: '#ffffff',
  sidebar: '#2a2724',    // header band
  sidebarMuted: '#a49e97',
} as const;

type Tone = 'gold' | 'success' | 'info' | 'expired' | 'neutral';
const tone: Record<Tone, { bg: string; text: string }> = {
  gold: { bg: '#f6e9cf', text: '#3a2f16' },
  success: { bg: '#dff2e6', text: '#2f8f5b' },
  info: { bg: '#e2ebf6', text: '#3f6fa8' },
  expired: { bg: '#efedea', text: '#7c766f' },
  neutral: { bg: '#faf9f7', text: '#2c2926' },
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
// through esc() or strong() before landing in an HTML body. Subjects and
// preheaders are handled at their insertion points.
const esc = escapeHtml;

/** Emphasized inline value (name, job title, company) — escaped. */
const strong = (v: string) => `<strong style="color:${color.ink};font-weight:600;">${esc(v)}</strong>`;

// ── Block primitives ─────────────────────────────────────────────────────────

const eyebrow = (label: string) =>
  `<p style="margin:0 0 10px 0;font:600 11px/1.2 ${FONT};letter-spacing:1.1px;text-transform:uppercase;color:${color.inkMuted};">${esc(label)}</p>`;

const badge = (label: string, t: Tone) =>
  `<p style="margin:0 0 16px 0;"><span style="display:inline-block;padding:5px 12px;border-radius:999px;background:${tone[t].bg};color:${tone[t].text};font:600 12px/1.2 ${FONT};">${esc(label)}</span></p>`;

/** Single h1 per email. Accepts pre-built HTML (use strong() for dynamic parts). */
const heading = (html: string) =>
  `<h1 style="margin:0 0 14px 0;font:700 23px/1.25 ${FONT};color:${color.ink};letter-spacing:-0.4px;">${html}</h1>`;

/** Body paragraph. Accepts pre-built HTML (use strong()/esc() for dynamic parts). */
const text = (html: string) =>
  `<p style="margin:0 0 14px 0;font:400 15px/1.65 ${FONT};color:${color.inkSecondary};">${html}</p>`;

/** Info card: bold title + body lines. Lines accept pre-built HTML. */
function card(title: string, lines: string[], t: Tone = 'neutral') {
  const body = lines
    .map((l) => `<p style="margin:0 0 4px 0;font:400 13.5px/1.6 ${FONT};color:${color.inkSecondary};">${l}</p>`)
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">
        <tr><td style="padding:16px 18px;border:1px solid ${color.border};border-radius:14px;background:${tone[t].bg};">
          <p style="margin:0 0 6px 0;font:600 15px/1.4 ${FONT};color:${color.ink};">${title}</p>
          ${body}
        </td></tr></table>`;
}

/** Numbered steps with gold-soft circular counters. Items accept pre-built HTML. */
function steps(items: string[]) {
  const rows = items
    .map(
      (item, i) => `<tr>
          <td width="26" valign="top" style="padding:0 0 10px 0;">
            <div style="width:20px;height:20px;border-radius:999px;background:${color.goldSoft};color:${color.goldInk};font:600 11px/20px ${FONT};text-align:center;">${i + 1}</div>
          </td>
          <td valign="top" style="padding:0 0 10px 0;font:400 14px/1.55 ${FONT};color:${color.inkSecondary};">${item}</td>
        </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px 0;">${rows}</table>`;
}

/** Gold pill CTA — one per email. */
const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px 0;"><tr>
        <td style="border-radius:999px;background:${color.gold};">
          <a href="${href}" style="display:inline-block;padding:13px 26px;font:600 14px/1 ${FONT};color:${color.goldInk};text-decoration:none;border-radius:999px;">${esc(label)}</a>
        </td></tr></table>`;

/** Underlined secondary action. */
const link = (href: string, label: string) =>
  `<p style="margin:0 0 14px 0;font:500 14px/1.6 ${FONT};"><a href="${href}" style="color:${color.inkSecondary};text-decoration:underline;">${esc(label)}</a></p>`;

// ── Layout shell ─────────────────────────────────────────────────────────────

function layout(title: string, preheader: string, blocks: string) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${color.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${color.background};padding:28px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${color.surface};border:1px solid ${color.border};border-radius:16px;">
  <tr>
    <td style="padding:28px 32px 22px 32px;background:${color.sidebar};border-radius:16px 16px 0 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="padding-right:10px;vertical-align:middle;">
          <div style="width:26px;height:26px;border-radius:8px;background:${color.gold};"></div>
        </td>
        <td style="vertical-align:middle;">
          <div style="font:600 17px/1.1 ${FONT};color:#ffffff;letter-spacing:-0.2px;">DirectRef</div>
          <div style="font:400 11px/1.4 ${FONT};color:${color.sidebarMuted};padding-top:2px;">Refer. Get hired.</div>
        </td>
      </tr></table>
    </td>
  </tr>
      <tr><td style="padding:30px 32px 8px 32px;">
        ${blocks}
      </td></tr>
  <tr>
    <td style="padding:22px 32px 28px 32px;border-top:1px solid ${color.border};">
      <p style="margin:0;font:400 12px/1.6 ${FONT};color:${color.inkMuted};">
        You're getting this because you use DirectRef. A referral is a human handing your C.V. to
        the right person &mdash; it is not a guaranteed interview.
      </p>
      <p style="margin:10px 0 0 0;font:400 12px/1.6 ${FONT};color:${color.inkMuted};">
        <a href="${env.FRONTEND_URL}/settings" style="color:${color.inkSecondary};text-decoration:underline;">Email preferences</a>
        &nbsp;&middot;&nbsp;
        <a href="${env.FRONTEND_URL}/privacy" style="color:${color.inkSecondary};text-decoration:underline;">Privacy</a>
        &nbsp;&middot;&nbsp;
        <a href="${env.FRONTEND_URL}/terms" style="color:${color.inkSecondary};text-decoration:underline;">Terms</a>
      </p>
    </td>
  </tr>
    </table>
    <p style="margin:16px 0 0 0;font:400 11.5px/1.5 ${FONT};color:${color.inkMuted};">DirectRef &middot; direct-ref.com</p>
  </td></tr>
</table>
</body></html>`;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function sendVerificationEmail(to: string, token: string, name: string): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-email?token=${token}`;
  const subject = 'Confirm your DirectRef account';
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html: layout(subject, 'Confirm your email to finish setting up your account.', [
      eyebrow('Account'),
      heading(`Welcome to DirectRef, ${esc(name)}`),
      text(`DirectRef puts your C.V. in a real person's hands instead of an applicant-tracking queue. Confirm your email to finish setting up your account.`),
      button(verifyUrl, 'Confirm my email'),
      text('This link is valid for 24 hours.'),
      text(`If you didn't create a DirectRef account, you can ignore this email and nothing happens.`),
    ].join('\n')),
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${token}`;
  const subject = 'Reset your DirectRef password';
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html: layout(subject, 'Set a new password — the link is valid for 1 hour.', [
      eyebrow('Account'),
      heading('Reset your password'),
      text('Click below to choose a new password. The link is valid for 1 hour.'),
      button(resetUrl, 'Reset my password'),
      text(`If you didn't request this, you can safely ignore this email — your password stays as it is.`),
    ].join('\n')),
  });
}

/** Confirms ownership of a work email so job postings for that company can
 *  be unlocked (see services/companyMatch.ts, jobs.service.ts createJob). */
export async function sendWorkEmailVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const verifyUrl = `${env.FRONTEND_URL}/verify-work-email?token=${token}`;
  const subject = 'Confirm your work email';
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to,
    subject,
    html: layout(subject, 'Confirm this is you — the link is valid for 1 hour.', [
      eyebrow('Account'),
      heading(`Confirm it's you, ${esc(name)}`),
      text(`We use your work email to confirm which company you work at, so you can post jobs for that company. Click below to confirm ${strong(to)} is yours.`),
      button(verifyUrl, 'Confirm my work email'),
      text('This link is valid for 1 hour.'),
      text(`If you didn't request this, you can safely ignore this email — nothing changes.`),
    ].join('\n')),
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
    subject: `New C.V. for ${jobTitle}`,
    html: layout(`New C.V. for ${jobTitle}`, `${seekerName} sent a C.V. for your posted role.`, [
      eyebrow('C.V. inbox'),
      badge('Awaiting your review', 'gold'),
      heading(`${esc(seekerName)} sent you a C.V.`),
      text(`Someone applied to ${strong(jobTitle)} at ${strong(companyName)} — the role you posted. Review the C.V. and, if it's a fit, submit it through your internal referral programme.`),
      steps([
        'Open the C.V. in your inbox',
        `Download it if it's a fit`,
        'Submit it internally and mark the status',
      ]),
      button(dashboardUrl, 'Review the C.V.'),
      text('You have 5 days to act before the application expires.'),
    ].join('\n')),
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
    subject: `${referrerName} viewed your C.V.`,
    html: layout(`${referrerName} viewed your C.V.`, 'A human just opened your C.V.', [
      eyebrow('Application update'),
      badge('Viewed', 'info'),
      heading('Your C.V. was opened'),
      text(`${strong(referrerName)} opened your C.V. for ${strong(jobTitle)} at ${strong(companyName)}. The next update comes when they download it to refer you — or let you know it's not a fit.`),
      button(applicationsUrl, 'Track this application'),
    ].join('\n')),
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
    subject: `Your C.V. was forwarded to HR at ${companyName}`,
    html: layout(`Your C.V. was forwarded to HR at ${companyName}`, 'Your C.V. is with the HR team now.', [
      eyebrow('Application update'),
      badge('Sent to HR', 'success'),
      heading('Your C.V. went to HR'),
      text(`${strong(referrerName)} forwarded your C.V. for ${strong(jobTitle)} at ${strong(companyName)} to their HR team.`),
      button(applicationsUrl, 'Track this application'),
      text(`What we promise: your C.V. reaches a human. What we can't promise: an interview. That call is HR's.`),
    ].join('\n')),
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
  const blocks = [
    eyebrow('Employee referral'),
    badge('Referral', 'gold'),
    heading(`${esc(referrerName)} is referring ${esc(seekerName)}`),
    text(`${strong(referrerName)} is referring ${strong(seekerName)} for ${strong(jobTitle)} at ${strong(companyName)} through DirectRef.`),
  ];
  if (referrerNote) {
    blocks.push(card(`A note from ${esc(referrerName)}`, [`&ldquo;${esc(referrerNote)}&rdquo;`], 'gold'));
  }
  blocks.push(button(cvViewUrl, 'View C.V.'));
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: hrEmail,
    subject: `Referral: ${seekerName} for ${jobTitle}`,
    html: layout(`Referral: ${seekerName} for ${jobTitle}`, `${referrerName} is referring ${seekerName} for ${jobTitle}.`, blocks.join('\n')),
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
    subject: `Still waiting: ${seekerName}'s C.V.`,
    html: layout(`Still waiting: ${seekerName}'s C.V.`, 'One day in, four days left to act.', [
      eyebrow('Reminder · Day 1'),
      badge('Awaiting your review', 'gold'),
      heading('A C.V. has been waiting a day'),
      text(`${strong(seekerName)} is waiting on ${strong(jobTitle)}. A minute of your time either moves them forward or frees them up to try elsewhere.`),
      card('4 days left', ['After 5 days the application expires and the seeker is refunded.'], 'neutral'),
      button(inboxUrl, 'Open my C.V. inbox'),
    ].join('\n')),
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
    subject: `2 days on: ${seekerName}'s C.V. for ${jobTitle}`,
    html: layout(`2 days on: ${seekerName}'s C.V. for ${jobTitle}`, '3 days before it expires and the credit is refunded.', [
      eyebrow('Reminder · Day 2'),
      badge('Awaiting your review', 'gold'),
      heading(`It's been 2 days — 3 to go`),
      text(`${strong(seekerName)}'s C.V. for ${strong(jobTitle)} is still untouched. Download it and submit it internally, or mark it as not a fit so they know where they stand.`),
      steps([
        'Download the C.V.',
        'Submit it through your referral programme',
        `Or mark it not a fit — an honest no helps too`,
      ]),
      button(inboxUrl, 'Open my C.V. inbox'),
    ].join('\n')),
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
    subject: `Your credit is back — ${jobTitle} expired`,
    html: layout(`Your credit is back — ${jobTitle} expired`, 'No response from the referrer in 5 days, so we refunded you.', [
      eyebrow('Application update'),
      badge('Expired', 'expired'),
      heading('No response, so your credit is back'),
      text(`${strong(referrerName)} didn't act on your C.V. for ${strong(jobTitle)} within 5 days, so we closed the application and ${strong('refunded your credit')}. You can spend it on another role right now.`),
      card('1 credit returned to your balance', [
        'Nothing was submitted on your behalf.',
        'Nothing was shared with the company.',
      ], 'gold'),
      button(`${env.FRONTEND_URL}/jobs`, 'Find another referrer'),
      link(applicationsUrl, 'See all my applications'),
    ].join('\n')),
  });
}

/** Day 5 — tell the referrer the application expired and why responding matters. */
export async function sendReferrerExpiredEmail(
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
    subject: `Expired: ${seekerName}'s C.V. for ${jobTitle}`,
    html: layout(`Expired: ${seekerName}'s C.V. for ${jobTitle}`, 'No action in 5 days, so we closed it and refunded the seeker.', [
      eyebrow('Reminder · Day 5'),
      badge('Expired', 'expired'),
      heading('This application has expired'),
      text(`${strong(seekerName)}'s C.V. for ${strong(jobTitle)} closed after 5 days with no action, and their credit was refunded. It no longer appears in your inbox.`),
      card('Keeping your response rate healthy', [
        'Seekers see your response rate before they spend a credit.',
        'Acting — even a decline — keeps it strong.',
      ], 'neutral'),
      button(inboxUrl, 'See my open C.V.s'),
    ].join('\n')),
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
    subject: `${referrerName} downloaded your C.V. for ${jobTitle}`,
    html: layout(`${referrerName} downloaded your C.V. for ${jobTitle}`, `It's out of the queue and in a human's hands.`, [
      eyebrow('Application update'),
      badge('Downloaded', 'success'),
      heading(`Your C.V. is in a person's hands`),
      text(`${strong(referrerName)} downloaded your C.V. for ${strong(jobTitle)} at ${strong(companyName)}. The next step is theirs: submitting it through their company's internal referral programme.`),
      card(`${esc(jobTitle)} &middot; ${esc(companyName)}`, [
        `Referrer: ${esc(referrerName)}`,
        'Status: Downloaded — awaiting internal submission',
      ], 'neutral'),
      button(applicationsUrl, 'Track this application'),
      text(`What we promise: your C.V. reaches a human. What we can't promise: an interview. That call is HR's.`),
    ].join('\n')),
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
    subject: `Did you submit ${seekerName}'s C.V. internally?`,
    html: layout(`Did you submit ${seekerName}'s C.V. internally?`, 'Two days since you downloaded the C.V. — one tap closes the loop.', [
      eyebrow('Status check · 48h after download'),
      badge('Downloaded', 'info'),
      heading('Did it make it into your system?'),
      text(`You downloaded ${strong(seekerName)}'s C.V. for ${strong(jobTitle)} two days ago. If you've submitted it through your internal referral programme, mark it in DirectRef — that's the update they're waiting for.`),
      card('Two taps, and they know', [
        'Submitted internally &rarr; we notify the seeker it reached HR.',
        'Not a fit &rarr; we close it honestly and refund their credit.',
      ], 'info'),
      button(inboxUrl, 'Update the status'),
    ].join('\n')),
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
    subject: `Last check: did ${seekerName}'s C.V. get submitted?`,
    html: layout(`Last check: did ${seekerName}'s C.V. get submitted?`, '2 days before this resets and the credit is refunded.', [
      eyebrow('Status check · Day 3'),
      badge('Downloaded', 'info'),
      heading('Last check: did it go in?'),
      text(`${strong(seekerName)}'s C.V. for ${strong(jobTitle)} at ${strong(companyName)} is still marked as downloaded, not submitted.`),
      card('2 days left', ['After that this resets automatically and the seeker&#39;s credit is refunded.'], 'gold'),
      button(inboxUrl, 'Update the status'),
    ].join('\n')),
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
    subject: `Your C.V. was submitted internally at ${companyName}`,
    html: layout(`Your C.V. was submitted internally at ${companyName}`, `It's in their referral system — the ball is in HR's court now.`, [
      eyebrow('Application update'),
      badge('Submitted internally', 'success'),
      heading(`It's in their system`),
      text(`${strong(referrerName)} confirmed your C.V. for ${strong(jobTitle)} was submitted through ${strong(companyName)}'s internal referral programme.`),
      card('What happens next', [
        'HR reviews internal referrals directly.',
        `Interview decisions are theirs — we'll leave it in their hands. Good luck!`,
      ], 'success'),
      button(applicationsUrl, 'Track this application'),
    ].join('\n')),
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
    html: layout(`${senderName} sent you a message`, 'New message on one of your applications.', [
      eyebrow('Message'),
      heading(`New message from ${esc(senderName)}`),
      card(esc(senderName), [`&ldquo;${esc(preview)}&rdquo;`], 'neutral'),
      button(threadUrl, 'Reply'),
    ].join('\n')),
  });
}

// ── Job posting cleanup ─────────────────────────────────────────────────────

/** 3 days before an inactive job posting is permanently deleted. */
export async function sendJobDeletionWarningEmail(
  referrerEmail: string,
  referrerName: string,
  jobTitle: string,
  companyName: string,
  jobsUrl: string,
): Promise<void> {
  await resend.emails.send({
    from: env.EMAIL_FROM,
    to: referrerEmail,
    subject: `${jobTitle} will be deleted in 3 days`,
    html: layout(`${jobTitle} will be deleted in 3 days`, `It's been inactive for 27 days — reactivate it to keep it.`, [
      eyebrow('Job posting'),
      badge('Inactive · 3 days left', 'expired'),
      heading('This posting is about to be deleted'),
      text(`${strong(jobTitle)} at ${strong(companyName)} has been inactive for 27 days. In 3 days it will be ${strong('permanently deleted')} — along with every application, message, and C.V. sent to it.`),
      card('Want to keep it?', [
        'Reactivate the posting any time before then and nothing is lost.',
        'Once it\'s deleted, there\'s no way to recover it.',
      ], 'expired'),
      button(jobsUrl, 'Reactivate this posting'),
    ].join('\n')),
  });
}
