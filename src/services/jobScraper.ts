import fetch from 'node-fetch';

export interface ScrapedJob {
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  jobType?: string;
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
 * Many companies embed a Greenhouse job board on their own domain
 * (careers.company.com/?gh_jid=123, or boards.greenhouse.io/company/jobs/123
 * directly). The actual job content on those pages is loaded client-side by
 * JS after the initial HTML — a plain fetch() never sees it, only whatever
 * generic company-wide blurb is in the page's static meta tags. Greenhouse's
 * own public API has the real per-job content, so pull from there directly
 * when we can identify the board token + job id.
 */
async function tryGreenhouse(url: string, html: string): Promise<ScrapedJob | null> {
  let boardToken: string | undefined;
  let jobId: string | undefined;

  const directMatch = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([a-z0-9_-]+)\/jobs\/(\d+)/i);
  if (directMatch) {
    [, boardToken, jobId] = directMatch;
  } else {
    // Embedded widget on the company's own domain — job id is in the URL's
    // gh_jid param, board token has to be found somewhere in the page
    // (the embed script/iframe src references it).
    const jidMatch = url.match(/[?&]gh_jid=(\d+)/i);
    const boardMatch = html.match(/greenhouse\.io\/([a-z0-9_-]+)\/jobs\/\d+/i)
      ?? html.match(/boards\.greenhouse\.io\/([a-z0-9_-]+)/i);
    if (jidMatch && boardMatch) {
      jobId = jidMatch[1];
      boardToken = boardMatch[1];
    }
  }

  if (!boardToken || !jobId) return null;

  try {
    const res = await fetch(
      `https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs/${jobId}?content=true`,
      { timeout: 10000 },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string; company_name?: string; location?: { name?: string }; content?: string;
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
    };
  } catch {
    return null;
  }
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

    // ── 0. Greenhouse-embedded board (see tryGreenhouse) ─────────────────────
    const greenhouse = await tryGreenhouse(url, html);
    if (greenhouse) return greenhouse;

    // ── 1. JSON-LD structured data (most reliable) ──────────────────────────
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]);
        const job = Array.isArray(data) ? data.find((d) => d['@type'] === 'JobPosting') : data['@type'] === 'JobPosting' ? data : null;
        if (job) {
          // addressCountry can be a plain string ("IN") or an object { "@type": "Country", "name": "India" }
          const rawCountry = job.jobLocation?.address?.addressCountry;
          const country = typeof rawCountry === 'string' ? rawCountry : rawCountry?.name ?? undefined;
          const locality = job.jobLocation?.address?.addressLocality;
          return {
            title: job.title ?? undefined,
            companyName: job.hiringOrganization?.name ?? undefined,
            location: locality
              ? [locality, country].filter(Boolean).join(', ')
              : undefined,
            description: job.description
              ? htmlToStructuredText(job.description).slice(0, 20_000)
              : undefined,
            jobType: job.employmentType?.toLowerCase().replace('_', '-') ?? undefined,
          };
        }
      } catch {
        // invalid JSON, try next
      }
    }

    // ── 2. Open Graph tags ───────────────────────────────────────────────────
    const getOg = (property: string): string | undefined => {
      const m = html.match(new RegExp(`<meta[^>]+property=["']og:${property}["'][^>]+content=["']([^"']+)["']`, 'i'))
        ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${property}["']`, 'i'));
      return m?.[1]?.trim();
    };

    const getMeta = (name: string): string | undefined => {
      const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'));
      return m?.[1]?.trim();
    };

    const siteName = getOg('site_name');
    const ogTitle  = getOg('title');
    const ogDesc   = getOg('description') ?? getMeta('description');

    // ── 3. <title> tag heuristics ────────────────────────────────────────────
    const rawTitle = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';

    // Many job boards format as "Job Title | Company" or "Job Title - Company"
    let title: string | undefined;
    let companyFromTitle: string | undefined;

    const titleParts = rawTitle.split(/\s*[\|–—-]\s*/);
    if (titleParts.length >= 2) {
      // Heuristic: shorter part is usually the company, longer is the job title
      const first = titleParts[0].trim();
      const last  = titleParts[titleParts.length - 1].trim();

      // If the last part looks like a company name (short, no spaces), use it
      if (last.split(' ').length <= 3 && first.split(' ').length > 1) {
        title = first;
        companyFromTitle = last;
      } else {
        title = first;
        companyFromTitle = last;
      }
    } else {
      title = rawTitle || ogTitle;
    }

    // Prefer ogTitle if raw title looks like a generic site title
    if (ogTitle && ogTitle.length > 10 && ogTitle !== rawTitle) {
      const ogParts = ogTitle.split(/\s*[\|–—-]\s*/);
      title = ogParts[0].trim();
    }

    const companyName = siteName ?? companyFromTitle ?? undefined;

    return {
      title:       title || undefined,
      companyName: companyName || undefined,
      description: ogDesc?.slice(0, 20_000) || undefined,
    };
  } catch {
    return {};
  }
}
