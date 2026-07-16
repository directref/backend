import { Resend } from 'resend';
import { env } from '../config/env';

const resend = new Resend(env.RESEND_API_KEY);

const brand = {
  color: '#7B65E8',
  name: 'Refrd',
};

function btn(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:${brand.color};color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-family:system-ui,sans-serif;">${label}</a>`;
}

function layout(body: string) {
  return `
    <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e;">
      <div style="padding:24px 0 8px;">
        <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:${brand.color};">${brand.name}</span>
      </div>
      <div style="background:#f9f9ff;border-radius:12px;padding:28px;">
        ${body}
      </div>
      <p style="font-size:12px;color:#999;margin-top:16px;text-align:center;">
        You're receiving this because you use ${brand.name}.
        <a href="${env.FRONTEND_URL}" style="color:${brand.color};">Open app →</a>
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
      <h2 style="margin:0 0 8px;">Welcome to ${brand.name}, ${name}! 👋</h2>
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
      <h2 style="margin:0 0 8px;">New CV in your inbox 📥</h2>
      <p style="color:#555;">
        <strong>${seekerName}</strong> sent you their CV for
        <strong>${jobTitle}</strong> at <strong>${companyName}</strong>.
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
      <h2 style="margin:0 0 8px;">Your CV was viewed 👀</h2>
      <p style="color:#555;">
        <strong>${referrerName}</strong> opened your CV for
        <strong>${jobTitle}</strong> at <strong>${companyName}</strong>.
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
    subject: `🎉 Your CV was forwarded to HR at ${companyName}`,
    html: layout(`
      <h2 style="margin:0 0 8px;">Great news, ${seekerName}! 🎉</h2>
      <p style="color:#555;">
        <strong>${referrerName}</strong> forwarded your CV for
        <strong>${jobTitle}</strong> at <strong>${companyName}</strong> to their HR team.
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
      <h2 style="margin:0 0 8px;">Employee Referral 👥</h2>
      <p style="color:#555;">
        <strong>${referrerName}</strong> is referring <strong>${seekerName}</strong>
        for <strong>${jobTitle}</strong> at <strong>${companyName}</strong>.
      </p>
      ${referrerNote ? `<blockquote style="border-left:3px solid ${brand.color};margin:16px 0;padding-left:12px;color:#555;font-style:italic;">"${referrerNote}"</blockquote>` : ''}
      ${btn(cvViewUrl, 'View CV')}
    `),
  });
}
