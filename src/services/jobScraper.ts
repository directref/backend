import fetch from 'node-fetch';

export interface ScrapedJob {
  title?: string;
  companyName?: string;
  location?: string;
  description?: string;
  jobType?: string;
}

/**
 * Extracts job metadata from a URL.
 * Tries structured JSON-LD first (most accurate), then Open Graph tags,
 * then falls back to page title heuristics. Never throws.
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

    // ── 1. JSON-LD structured data (most reliable) ──────────────────────────
    const jsonLdMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    for (const match of jsonLdMatches) {
      try {
        const data = JSON.parse(match[1]);
        const job = Array.isArray(data) ? data.find((d) => d['@type'] === 'JobPosting') : data['@type'] === 'JobPosting' ? data : null;
        if (job) {
          return {
            title: job.title ?? undefined,
            companyName: job.hiringOrganization?.name ?? undefined,
            location: job.jobLocation?.address?.addressLocality
              ? [job.jobLocation.address.addressLocality, job.jobLocation.address.addressCountry].filter(Boolean).join(', ')
              : undefined,
            description: job.description
              ? job.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 800)
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
      description: ogDesc?.slice(0, 800) || undefined,
    };
  } catch {
    return {};
  }
}
