import fetch from 'node-fetch';

export interface ScrapedJob {
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  jobType?: string;
  workMode?: string;
}

const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'", '&#x27;': "'",
  '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
  '&rdquo;': '”', '&ldquo;': '“',
};

function decodeEntities(s: string): string {
  return s.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;|&nbsp;|&lt;|&gt;|&quot;|&#39;|&apos;|&#x27;|&mdash;|&ndash;|&rsquo;|&lsquo;|&rdquo;|&ldquo;/g, (m) => HTML_ENTITIES[m] ?? m);
}

/**
 * Converts a job description's HTML into structured plain text instead of
 * flattening everything to one line: list items become "• " prefixed lines,
 * paragraph/block boundaries become blank lines. The frontend renders this
 * back into real <ul>/<li>/<p> — preserving structure here is what makes
 * that possible, instead of one undifferentiated blob of text.
 */
function htmlToStructuredText(html: string): string {
  let s = html;
  s = s.replace(/<li[^>]*>/gi, '\n• ');
  s = s.replace(/<\/li>/gi, '');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<(p|div|h[1-6]|ul|ol)[^>]*>/gi, '\n\n');
  s = s.replace(/<\/(p|div|h[1-6]|ul|ol)>/gi, '\n\n');
  s = s.replace(/<[^>]+>/g, ''); // strip remaining tags (<strong>, <em>, <span>, etc.)
  s = decodeEntities(s);
  s = s.replace(/[ \t]+/g, ' '); // collapse horizontal whitespace only — keep line breaks
  s = s.split('\n').map((line) => line.trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n'); // cap at one blank line between blocks
  return s.trim();
}

/**
 * Scans forward from just past `marker` tracking brace depth (respecting
 * quoted strings) to find a JS/JSON object literal's matching close brace —
 * a non-greedy regex can't handle nested objects reliably.
 */
function extractBalancedObjectAfter(html: string, marker: RegExp): string | undefined {
  const m = html.match(marker);
  if (!m || m.index === undefined) return undefined;
  const start = m.index + m[0].length;

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }
  return undefined;
}

/**
 * Comeet is a widely-used ATS with two very different embed styles:
 *
 *  1. Its WordPress plugin renders the full posting server-side into a
 *     `<div class="cs_content">` container with real <h2>/<p>/<ul><li>
 *     structure, even though the interactive apply-form widget next to it
 *     only loads via JS.
 *  2. A pure client-side widget (`COMEET.init(...)`) that renders
 *     *everything*, including the description, in the browser — a plain
 *     fetch() never sees any of it, only the page's own generic meta tags.
 *
 * Either way, some Comeet sites' JSON-LD/OG description holds just a short
 * company blurb instead of the actual posting, so when we can recover the
 * real content it should win over those.
 */
function extractComeetStaticDescription(html: string): string | undefined {
  const startMatch = html.match(/<div class="cs_content"[^>]*>/i);
  if (!startMatch || startMatch.index === undefined) return undefined;

  // Scan forward tracking div nesting depth to find the matching close tag —
  // a non-greedy regex can't handle the nested <div>s this container holds.
  const contentStart = startMatch.index + startMatch[0].length;
  const tagRe = /<(\/?)div\b[^>]*>/gi;
  tagRe.lastIndex = contentStart;
  let depth = 1;
  let contentEnd: number | undefined;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) { contentEnd = m.index; break; }
  }
  if (contentEnd === undefined) return undefined;

  const description = htmlToStructuredText(html.slice(contentStart, contentEnd)).slice(0, 20_000);
  return description || undefined;
}

/** Credentials for Comeet's public Careers API, as embedded by either known widget variant. */
function extractComeetCredentials(html: string): { token: string; companyUid: string; positionUid: string } | undefined {
  const tokenMatch = html.match(/"comToken"\s*:\s*"([^"]+)"/) ?? html.match(/"comeet_token"\s*:\s*"([^"]+)"/i);
  const companyUidMatch = html.match(/"comUID"\s*:\s*"([^"]+)"/) ?? html.match(/"comeet_uid"\s*:\s*"([^"]+)"/i);
  const positionUidMatch = html.match(/data-position-uid=["']([^"']+)["']/i);
  if (!tokenMatch || !companyUidMatch || !positionUidMatch) return undefined;
  return { token: tokenMatch[1], companyUid: companyUidMatch[1], positionUid: positionUidMatch[1] };
}

function normalizeWorkMode(raw: string | undefined): string | undefined {
  const s = raw?.toLowerCase();
  if (!s) return undefined;
  if (s.includes('remote')) return 'remote';
  if (s.includes('hybrid')) return 'hybrid';
  if (s.includes('onsite') || s.includes('on-site') || s.includes('office')) return 'onsite';
  return undefined;
}

function normalizeJobType(raw: string | undefined): string | undefined {
  const s = raw?.toLowerCase();
  if (!s) return undefined;
  if (s.includes('full')) return 'full-time';
  if (s.includes('part')) return 'part-time';
  if (s.includes('intern')) return 'internship';
  if (s.includes('contract') || s.includes('temp')) return 'contract';
  return undefined;
}

/**
 * The Careers API's position endpoint carries location/employment/workplace
 * metadata but never the description — that only exists client-side, or
 * server-rendered on Comeet's own hosted mirror of the same posting
 * (`url_comeet_hosted_page`), inside a `POSITION_DATA.custom_fields.details`
 * array of `{ name, value: <html>, order }` sections. Fetch that mirror page
 * and stitch its sections back into one HTML blob before structuring it.
 */
async function fetchComeetHostedDescription(hostedPageUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(hostedPageUrl, { timeout: 10000 });
    if (!res.ok) return undefined;
    const html = await res.text();
    const raw = extractBalancedObjectAfter(html, /POSITION_DATA\s*=\s*/);
    if (!raw) return undefined;
    const data = JSON.parse(raw) as { custom_fields?: { details?: Array<{ name?: string; value?: string; order?: number }> } };
    const details = data.custom_fields?.details;
    if (!details?.length) return undefined;
    const combinedHtml = [...details]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((section) => `<h2>${section.name ?? ''}</h2>${section.value ?? ''}`)
      .join('');
    const description = htmlToStructuredText(combinedHtml).slice(0, 20_000);
    return description || undefined;
  } catch {
    return undefined;
  }
}

async function getComeetExtras(html: string): Promise<Partial<ScrapedJob> | undefined> {
  if (!/comeet/i.test(html)) return undefined;

  const staticDescription = extractComeetStaticDescription(html);
  if (staticDescription) return { description: staticDescription };

  const creds = extractComeetCredentials(html);
  if (!creds) return undefined;

  try {
    const res = await fetch(
      `https://www.comeet.com/careers-api/2.0/company/${creds.companyUid}/positions/${creds.positionUid}?token=${creds.token}`,
      { timeout: 10000 },
    );
    if (!res.ok) return undefined;
    const meta = (await res.json()) as {
      employment_type?: string; workplace_type?: string;
      location?: { name?: string }; url_comeet_hosted_page?: string;
    };

    const extras: Partial<ScrapedJob> = {};
    if (meta.location?.name) extras.location = meta.location.name;
    const jobType = normalizeJobType(meta.employment_type);
    if (jobType) extras.jobType = jobType;
    const workMode = normalizeWorkMode(meta.workplace_type);
    if (workMode) extras.workMode = workMode;
    if (meta.url_comeet_hosted_page) {
      const description = await fetchComeetHostedDescription(meta.url_comeet_hosted_page);
      if (description) extras.description = description;
    }
    return Object.keys(extras).length ? extras : undefined;
  } catch {
    return undefined;
  }
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Board tokens conventionally match the company's own name, so when the
 * widget's real token can't be found in the static HTML, a slug of the
 * hostname and/or the page's own site name are good guesses to try against
 * Greenhouse's public API before giving up on it entirely.
 */
function guessBoardTokens(url: string, companyNameHint?: string): string[] {
  const tokens = new Set<string>();
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const label = slugify(host.split('.')[0] ?? '');
    if (label) tokens.add(label);
  } catch {
    // malformed URL — skip the hostname-derived guess
  }
  if (companyNameHint) {
    const label = slugify(companyNameHint);
    if (label) tokens.add(label);
  }
  return [...tokens];
}

type GreenhouseMetadataField = { name: string; value: unknown };

/**
 * Greenhouse's "metadata" array holds each company's own custom fields —
 * names vary per board (e.g. "Time Type" vs. "Employment Type"), so match
 * loosely on name and normalize whatever value comes back.
 */
function jobTypeFromMetadata(metadata: GreenhouseMetadataField[] | undefined): string | undefined {
  const field = metadata?.find((m) => /employment type|time type|job type/i.test(m.name) && typeof m.value === 'string' && m.value.trim());
  return normalizeJobType(field?.value as string | undefined);
}

/**
 * "#LI-Remote" / "#LI-Hybrid" / "#LI-Onsite" is a widely used recruiting
 * convention (originally for LinkedIn's job feed) that authors embed
 * deliberately to flag work arrangement — a reliable, intentional signal,
 * unlike scanning body text for the word "remote" out of context.
 */
function workModeFromGreenhouse(metadata: GreenhouseMetadataField[] | undefined, content: string | undefined): string | undefined {
  const field = metadata?.find((m) => /remote|work (arrangement|mode|location)/i.test(m.name) && typeof m.value === 'string' && m.value.trim());
  const fromMetadata = normalizeWorkMode(field?.value as string | undefined);
  if (fromMetadata) return fromMetadata;

  const tagMatch = content?.match(/#LI-(Remote|Hybrid|On-?Site)/i);
  return tagMatch ? normalizeWorkMode(tagMatch[1]) : undefined;
}

/**
 * Many companies embed a Greenhouse job board on their own domain
 * (careers.company.com/?gh_jid=123, or boards.greenhouse.io/company/jobs/123
 * directly). The actual job content on those pages is loaded client-side by
 * JS after the initial HTML — a plain fetch() never sees it, only whatever
 * generic company-wide blurb is in the page's static meta tags. Greenhouse's
 * own public API has the real per-job content, so pull from there directly
 * when we can identify the board token + job id.
 */
async function fetchGreenhouseJob(boardToken: string, jobId: string): Promise<ScrapedJob | null> {
  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}?content=true`,
      { timeout: 10000 },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string; company_name?: string; location?: { name?: string }; content?: string;
      metadata?: GreenhouseMetadataField[];
    };
    if (!data.title && !data.content) return null;

    // Greenhouse's "content" field is HTML with its own tags/entities
    // double-escaped (the string is literally "&lt;p&gt;...") — decode once
    // to get real tags before running the normal HTML→structured-text pass.
    return {
      title: data.title ?? undefined,
      companyName: data.company_name ?? undefined,
      location: data.location?.name ?? undefined,
      description: data.content ? htmlToStructuredText(decodeEntities(data.content)).slice(0, 20_000) : undefined,
      jobType: jobTypeFromMetadata(data.metadata),
      workMode: workModeFromGreenhouse(data.metadata, data.content),
    };
  } catch {
    return null;
  }
}

async function tryGreenhouse(url: string, html: string, companyNameHint?: string): Promise<ScrapedJob | null> {
  const directMatch = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i);
  if (directMatch) {
    const [, boardToken, jobId] = directMatch;
    return fetchGreenhouseJob(boardToken, jobId);
  }

  // Embedded widget on the company's own domain — job id is in the URL's
  // gh_jid param, board token has to be found somewhere in the page (the
  // embed script/iframe src references it).
  const jidMatch = url.match(/[?&]gh_jid=(\d+)/i);
  if (!jidMatch) return null;
  const jobId = jidMatch[1];

  const boardMatch = html.match(/greenhouse\.io\/([a-z0-9_-]+)\/jobs\/\d+/i)
    ?? html.match(/boards\.greenhouse\.io\/([a-z0-9_-]+)/i);
  if (boardMatch) {
    const result = await fetchGreenhouseJob(boardMatch[1], jobId);
    if (result) return result;
  }

  // The embed's real token isn't referenced anywhere in the static HTML
  // (loaded client-side) — fall back to guessing it from the hostname/site
  // name and probing Greenhouse's public API, since the token is almost
  // always just the company's own slugified name.
  for (const guess of guessBoardTokens(url, companyNameHint)) {
    const result = await fetchGreenhouseJob(guess, jobId);
    if (result) return result;
  }

  return null;
}

/**
 * Lever is another widely-used ATS, with an even richer public API than
 * Greenhouse's: it normalizes work arrangement to exactly "remote" /
 * "hybrid" / "onsite" itself, and structures the body as named sections
 * (`lists`) the same way Comeet's hosted mirror does.
 */
async function fetchLeverJob(company: string, postingId: string, companyNameHint?: string): Promise<ScrapedJob | null> {
  try {
    const res = await fetch(`https://api.lever.co/v0/postings/${company}/${postingId}?mode=json`, { timeout: 10000 });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      text?: string;
      categories?: { location?: string; commitment?: string };
      workplaceType?: string;
      description?: string;
      lists?: Array<{ text?: string; content?: string }>;
      additional?: string;
    };
    if (!data.text && !data.description) return null;

    const combinedHtml = [
      data.description ? `<div>${data.description}</div>` : '',
      ...(data.lists ?? []).map((l) => `<h2>${l.text ?? ''}</h2>${l.content ?? ''}`),
      data.additional ? `<h2>Additional Information</h2>${data.additional}` : '',
    ].join('');

    return {
      title: data.text ?? undefined,
      companyName: companyNameHint,
      location: data.categories?.location ?? undefined,
      description: combinedHtml ? htmlToStructuredText(combinedHtml).slice(0, 20_000) : undefined,
      jobType: normalizeJobType(data.categories?.commitment),
      workMode: normalizeWorkMode(data.workplaceType),
    };
  } catch {
    return null;
  }
}

async function tryLever(url: string, html: string, companyNameHint?: string): Promise<ScrapedJob | null> {
  // Covers both a direct link to the hosted board (jobs.lever.co/company/id)
  // and an embed on the company's own domain that links/iframes to it —
  // either way, the same URL pattern shows up somewhere in scope.
  const match = url.match(/jobs\.lever\.co\/([a-z0-9_-]+)\/([0-9a-f-]{36})/i)
    ?? html.match(/jobs\.lever\.co\/([a-z0-9_-]+)\/([0-9a-f-]{36})/i);
  if (!match) return null;
  const [, company, postingId] = match;

  // Lever's API never returns a company name, and jobs.lever.co itself sets
  // no og:site_name — so for the common direct-link case there's usually no
  // hint at all. The board slug is conventionally just the company's own
  // name lowercased, so title-case it as a reasonable stand-in.
  const fallbackName = company.split(/[-_]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return fetchLeverJob(company, postingId, companyNameHint ?? (fallbackName || undefined));
}

/**
 * Extracts job metadata from a URL.
 * Tries a Greenhouse API lookup first when the page is a Greenhouse board
 * (most complete, since it bypasses whatever the static HTML does or
 * doesn't contain), then structured JSON-LD, then Open Graph tags, then
 * falls back to page title heuristics. Never throws.
 */
export async function scrapeJobUrl(url: string): Promise<ScrapedJob> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 10000,
      redirect: 'follow',
    });

    if (!res.ok) return {};

    const html = await res.text();

    // ── Open Graph / meta helpers — pulled up front so og:site_name can seed
    // a Greenhouse board-token guess below, as well as feed the OG fallback ──
    // Attribute values are raw HTML source text, so "isn't" comes through as
    // the literal characters "isn&#39;t" — decode before using anywhere.
    const getOg = (property: string): string | undefined => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
        ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`, 'i'));
      return m?.[1] ? decodeEntities(m[1]).trim() : undefined;
    };

    const getMeta = (name: string): string | undefined => {
      const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'));
      return m?.[1] ? decodeEntities(m[1]).trim() : undefined;
    };

    const siteName = getOg('site_name');

    // ── 0. Greenhouse-embedded board (see tryGreenhouse) ─────────────────────
    const greenhouse = await tryGreenhouse(url, html, siteName);
    if (greenhouse) return greenhouse;

    // ── 0b. Lever-hosted or -embedded posting (see tryLever) ─────────────────
    const lever = await tryLever(url, html, siteName);
    if (lever) return lever;

    // Comeet's real content (see getComeetExtras) is more complete than what
    // some Comeet sites put in JSON-LD/OG, so when present these fields
    // should win regardless of which path below supplies the rest.
    const comeetExtras = await getComeetExtras(html);

    // ── 1. JSON-LD structured data (most reliable) ──────────────────────────
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        // Some sites' JSON-LD generators leave a trailing comma before a
        // closing brace/bracket — invalid strict JSON, but common enough
        // (WordPress plugin bugs) that it's worth tolerating before parsing.
        const data = JSON.parse(match[1].replace(/,(\s*[}\]])/g, '$1'));
        // Yoast and other WordPress SEO plugins wrap everything in a single
        // {"@graph": [...]} object instead of a bare array or single entity —
        // normalize all three shapes into one list to search.
        const isJobPosting = (d: unknown): boolean => {
          const t = (d as { ['@type']?: unknown } | null)?.['@type'];
          return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
        };
        const candidates: any[] = Array.isArray(data) ? data
          : Array.isArray(data?.['@graph']) ? data['@graph']
          : [data];
        const job = candidates.find(isJobPosting);
        if (job) {
          // addressCountry can be a plain string ("IN") or an object { "@type": "Country", "name": "India" }
          const rawCountry = job.jobLocation?.address?.addressCountry;
          const country = typeof rawCountry === 'string' ? rawCountry : rawCountry?.name ?? undefined;
          const locality = job.jobLocation?.address?.addressLocality;
          const region = job.jobLocation?.address?.addressRegion;
          // Any of these can come back as an empty string rather than absent —
          // filter blanks so a missing city doesn't drop an available country.
          const location = [locality, region, country].filter((part) => part && part.trim()).join(', ');

          // jobLocationType: "TELECOMMUTE" is schema.org's flag for a fully remote
          // role; when it's absent we can't tell remote/hybrid/onsite apart, so
          // leave workMode unset rather than guessing.
          const workMode = job.jobLocationType === 'TELECOMMUTE' ? 'remote' : undefined;

          return {
            title: job.title ?? undefined,
            companyName: job.hiringOrganization?.name ?? undefined,
            location: comeetExtras?.location ?? (location || undefined),
            description: comeetExtras?.description ?? (job.description
              ? htmlToStructuredText(job.description).slice(0, 20_000)
              : undefined),
            jobType: comeetExtras?.jobType ?? (job.employmentType?.toLowerCase().replace('_', '-') ?? undefined),
            workMode: comeetExtras?.workMode ?? workMode,
          };
        }
      } catch {
        // invalid JSON, try next
      }
    }

    // ── 2. Open Graph tags ───────────────────────────────────────────────────
    const ogTitle  = getOg('title');
    const ogDesc   = getOg('description') ?? getMeta('description');

    // ── 3. <title> tag heuristics ────────────────────────────────────────────
    // Job boards often format <title>/og:title as "Job Title | Company" (or
    // with a dash/en-dash instead of a pipe) — but a dash is also common
    // *within* a legitimate job title (e.g. "Associate General Counsel –
    // Litigation"), so only strip a trailing/leading segment when it's
    // confirmed to be the site/company name, never just because it's short.
    const isSiteLabel = (candidate: string): boolean => {
      const c = candidate.trim().toLowerCase();
      if (!c) return false;
      const site = siteName?.trim().toLowerCase();
      if (site && (c === site || c.includes(site) || site.includes(c))) return true;
      return /^(careers?|jobs?|job board|job openings|hiring|open positions)$/i.test(c);
    };

    const splitOffSiteLabel = (raw: string): { title: string; company?: string } => {
      const parts = raw.split(/\s*[\|–—-]\s*/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return { title: raw };
      if (isSiteLabel(parts[parts.length - 1])) {
        return { title: parts.slice(0, -1).join(' – '), company: parts[parts.length - 1] };
      }
      if (isSiteLabel(parts[0])) {
        return { title: parts.slice(1).join(' – '), company: parts[0] };
      }
      // No confirmed site label — without og:site_name to check candidates
      // against, fall back to the older, weaker heuristic (a short trailing
      // segment is usually the company/site suffix) since it's all we have.
      if (!siteName) {
        const first = parts[0];
        const last = parts[parts.length - 1];
        if (last.split(' ').length <= 3 && first.split(' ').length > 1) {
          return { title: first, company: last };
        }
      }
      return { title: raw };
    };

    const rawTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    const rawTitle = rawTitleMatch ? decodeEntities(rawTitleMatch).trim() : '';
    const fromRawTitle = splitOffSiteLabel(rawTitle);
    let title: string | undefined = fromRawTitle.title || ogTitle;
    let companyFromTitle = fromRawTitle.company;

    // Prefer ogTitle if raw title looks like a generic site title
    if (ogTitle && ogTitle.length > 10 && ogTitle !== rawTitle) {
      const fromOgTitle = splitOffSiteLabel(ogTitle);
      title = fromOgTitle.title;
      companyFromTitle = companyFromTitle ?? fromOgTitle.company;
    }

    const companyName = siteName ?? companyFromTitle ?? undefined;

    return {
      title:       title || undefined,
      companyName: companyName || undefined,
      location:    comeetExtras?.location,
      description: comeetExtras?.description ?? (ogDesc?.slice(0, 20_000) || undefined),
      jobType:     comeetExtras?.jobType,
      workMode:    comeetExtras?.workMode,
    };
  } catch {
    return {};
  }
}
