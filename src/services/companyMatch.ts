/**
 * Gates job posting to referrers who've verified a work email at the same
 * company (see jobs.service.ts createJob). Two signals, tried in order:
 *
 *  1. The job's sourceUrl domain, when it's the company's own site (most
 *     reliable) — but a large share of postings are scraped from a
 *     third-party ATS's own domain (jobs.lever.co, boards.greenhouse.io,
 *     comeet.com, ...), which reveals nothing about the company's real
 *     domain, so that's explicitly excluded from this check.
 *  2. The free-text company name, normalized and compared against the
 *     email domain's label — the fallback for ATS-hosted URLs, and for any
 *     domain mismatch the first check missed (e.g. a careers subdomain on
 *     a different registrable domain than the company's mail).
 *
 * Deliberately lenient (passes if EITHER signal matches): this is a hard
 * block on a real user action, so a false block is worse than an
 * occasional false pass.
 */

const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com',
  'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com',
  'proton.me', 'zoho.com', 'mail.com', 'yandex.com', 'gmx.com', 'qq.com', '163.com',
  'fastmail.com', 'hey.com',
]);

// Third-party ATS/careers-hosting platforms — a job's sourceUrl living here
// says nothing about the employer's own domain.
const KNOWN_ATS_HOSTS = [
  'greenhouse.io', 'lever.co', 'comeet.com', 'workable.com', 'smartrecruiters.com',
  'myworkdayjobs.com', 'myworkday.com', 'icims.com', 'bamboohr.com', 'breezy.hr',
  'recruitee.com', 'jazzhr.com', 'ashbyhq.com', 'personio.de', 'personio.com',
  'teamtailor.com', 'applytojob.com', 'workday.com', 'taleo.net', 'jobvite.com',
];

function registrableDomain(hostname: string): string {
  // Simplistic last-two-labels rule — fine for the common gTLDs this app
  // deals with; doesn't try to special-case multi-part TLDs like co.uk.
  const parts = hostname.split('.');
  return parts.slice(-2).join('.');
}

function isKnownAtsHost(hostname: string): boolean {
  return KNOWN_ATS_HOSTS.some((ats) => hostname === ats || hostname.endsWith(`.${ats}`));
}

export function extractEmailDomain(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.has(domain.toLowerCase());
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|group|technologies|technology|tech)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Does a verified work-email domain plausibly belong to this job posting? */
export function emailMatchesJob(workEmailDomain: string, sourceUrl: string, companyName: string): boolean {
  try {
    const urlHost = new URL(sourceUrl).hostname.replace(/^www\./, '').toLowerCase();
    if (!isKnownAtsHost(urlHost) && registrableDomain(urlHost) === workEmailDomain.toLowerCase()) {
      return true;
    }
  } catch {
    // malformed sourceUrl — fall through to the company-name check
  }

  const emailLabel = registrableDomain(workEmailDomain).split('.')[0];
  const companyNormalized = normalizeCompanyName(companyName);
  // Require a non-trivial label so short/generic ones (e.g. "co", "hq")
  // can't loosely match almost any company name.
  return emailLabel.length >= 3 && companyNormalized.length > 0 && companyNormalized.includes(emailLabel);
}
