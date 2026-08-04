/**
 * Daily faith-based news, published to the CDN by the news pipeline.
 *
 * The bundle is date-partitioned, one folder per article:
 *
 *   news/<YYYY>/<MM>/<DD>/index.json                   day manifest
 *   news/<YYYY>/<MM>/<DD>/<slug>/article.md            frontmatter + body
 *   news/<YYYY>/<MM>/<DD>/<slug>/images/<id>.png       generated images
 *   news/latest.json                                   rolling day pointer
 *
 * Dates are PST calendar days, matching the portal's day boundary.
 *
 * The manifest is the source of truth, exactly as for the category bundles: an
 * `article.md` that no `index.json` lists is unreachable, which is what lets
 * the pipeline upload bytes first and make them visible last. Only entries with
 * `status: "published"` are surfaced — the pipeline holds back anything whose
 * images did not land, or whose sourcing was too thin to lead with.
 *
 * Image filenames are opaque 12-character ids, so display order comes from
 * `images[].n` and never from the key.
 *
 * **Server-side only.** The CDN is served without CORS headers, so the browser
 * cannot read these files itself; the pages here are server components.
 */
import { CDN_BASE_URL } from './cdn';

/** Where the news bundle lives once published. */
export const NEWS_CDN_ROOT = `${CDN_BASE_URL}/news`;

/** Give up rather than hanging a page render on a slow CDN. */
const FETCH_TIMEOUT_MS = 8000;

/** How long a fetched manifest stays fresh. */
const MANIFEST_TTL_MS = 5 * 60 * 1000;

/** Days of history the Home page draws on. */
export const FEED_WINDOW_DAYS = 30;

/**
 * Day manifests to request at once.
 *
 * A month of history is thirty separate objects. Firing all thirty together
 * works but puts a burst on one origin from every cold render, and a single
 * slow response then holds the whole batch. Eight at a time keeps the wall
 * clock close to the parallel case while bounding the burst; after the first
 * pass they are memoised for five minutes, so paging costs nothing.
 */
const MANIFEST_CONCURRENCY = 8;

export interface NewsImage {
  n: number;
  role: string;
  url: string;
}

export interface NewsArticle {
  id: string;
  slug: string;
  date: string;
  title: string;
  writer: string;
  topic: string;
  summary: string;
  sourceName: string;
  sourceUrl: string;
  /** Hero image, or null when none was published. */
  image: string | null;
  images: NewsImage[];
  created: string;
}

export interface NewsArticleDetail extends NewsArticle {
  /** Markdown body with the frontmatter stripped. */
  content: string;
}

interface ManifestImage {
  n: number;
  role?: string;
  file: string;
}

interface ManifestEntry {
  id: string;
  slug: string;
  title: string;
  writer?: string;
  topic?: string;
  summary?: string;
  marketing_summary?: string;
  source_name?: string;
  source_url?: string;
  date_published?: string;
  date_updated?: string;
  status?: string;
  file: string;
  image_file?: string;
  image_status?: string;
  images?: ManifestImage[];
}

interface DayManifest {
  schema?: string;
  date: string;
  count?: number;
  articles?: ManifestEntry[];
}

interface LatestManifest {
  days?: { date: string; prefix: string; count: number }[];
}

// ── Dates ────────────────────────────────────────────────────────────────────

/** Today's PST calendar date as YYYY-MM-DD. */
export function pstToday(now: Date = new Date()): string {
  // en-CA yields YYYY-MM-DD, already zero-padded.
  return now.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

/** 'YYYY-MM-DD' -> 'news/YYYY/MM/DD/'. */
function dayPrefix(date: string): string {
  const [y, m, d] = date.split('-');
  return `${y}/${m}/${d}`;
}

function isValidDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date);
}

// ── Fetch ────────────────────────────────────────────────────────────────────

function newsCdnUrl(relPath: string): string {
  return `${NEWS_CDN_ROOT}/${relPath.replace(/^[\\/]+/, '')}`;
}

/**
 * Read a file from the news bundle, or null.
 *
 * A missing day is the normal state for any date the pipeline has not run for,
 * so 404 is not logged. Everything else degrades to null rather than throwing:
 * a CDN hiccup should render an empty section, never a 500.
 */
async function readNewsFile(relPath: string): Promise<string | null> {
  const url = newsCdnUrl(relPath);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (res.status !== 404) console.error(`[news] ${url} -> HTTP ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[news] ${url} fetch failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

const manifestCache = new Map<string, { at: number; manifest: DayManifest | null }>();
let slugIndexCache: { at: number; slugs: Record<string, string> } | null = null;

async function readDayManifest(date: string): Promise<DayManifest | null> {
  if (!isValidDate(date)) return null;

  const cached = manifestCache.get(date);
  if (cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.manifest;

  const raw = await readNewsFile(`${dayPrefix(date)}/index.json`);
  let manifest: DayManifest | null = null;
  if (raw) {
    try {
      manifest = JSON.parse(raw) as DayManifest;
    } catch (err) {
      console.error(`[news] ${date}/index.json is not valid JSON:`, err instanceof Error ? err.message : err);
    }
  }
  manifestCache.set(date, { at: Date.now(), manifest });
  return manifest;
}

// ── Mapping ──────────────────────────────────────────────────────────────────

function toArticle(entry: ManifestEntry, date: string): NewsArticle {
  const prefix = `${dayPrefix(date)}/`;
  const images = (entry.images ?? [])
    .slice()
    .sort((a, b) => a.n - b.n)   // filenames are opaque ids; order lives in `n`
    .map(img => ({ n: img.n, role: img.role ?? '', url: newsCdnUrl(prefix + img.file) }));

  return {
    id: entry.id,
    slug: entry.slug,
    date,
    title: entry.title,
    writer: entry.writer || 'JubileeVerse Newsroom',
    topic: entry.topic || '',
    summary: entry.summary || entry.marketing_summary || '',
    sourceName: entry.source_name || '',
    sourceUrl: entry.source_url || '',
    image: entry.image_file ? newsCdnUrl(prefix + entry.image_file) : null,
    images,
    created: entry.date_updated || entry.date_published || date,
  };
}

/** Published entries only, newest first. */
function publishedFrom(manifest: DayManifest | null, date: string): NewsArticle[] {
  if (!manifest?.articles?.length) return [];
  return manifest.articles
    .filter(entry => entry.status === 'published' && entry.file && entry.slug)
    .map(entry => toArticle(entry, date))
    .sort((a, b) => b.created.localeCompare(a.created));
}

/** Strip the frontmatter block so only the body is rendered. */
function stripFrontmatter(markdown: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return match ? markdown.slice(match[0].length).trimStart() : markdown;
}

/**
 * A published body, trimmed to what the article reader should show.
 *
 * The composer writes each file for the pipeline as much as for the reader, so
 * a stored body carries three things the reader supplies itself:
 *
 *   - a labelled metadata block (title, writer, slug, source URL, published)
 *     closed by a rule — the reader's header covers all of it;
 *   - the article's images, of which the hero is shown full-bleed above the
 *     title and the rest are not shown at all;
 *   - a trailing source link and AI-assistance note, which the reader renders
 *     as its own source link and footer note.
 *
 * Every image goes, not just the hero: the reading experience is one picture at
 * the top and then prose, exactly as on /article/[id]. Dropping only the hero
 * would leave the supporting images breaking up the paragraphs.
 *
 * `## Introduction` and `## Article Body` go too: they are scaffolding for the
 * generator, not headings a reader should see. Everything else is left exactly
 * as published.
 *
 * Pure, so the trimming can be unit tested without network.
 */
export function toReaderBody(content: string): string {
  let body = String(content || '').trimStart();

  // Metadata block -> the rule that closes it.
  if (/^\*\*(Article Title|Writer|Article Slug|Source News URL|Published):\*\*/.test(body)) {
    const rule = body.search(/^---[ \t]*$/m);
    if (rule !== -1) body = body.slice(rule).replace(/^---[ \t]*\r?\n?/, '').trimStart();
  }

  // Images — inline ones included, so a paragraph is never left with a gap
  // where a picture used to sit. Linked images lose their wrapper link too.
  body = body
    .replace(/\[\s*!\[[^\]]*\]\([^)]*\)\s*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
    // Lines that held nothing but an image are now blank; take the line, not
    // just its content, so the paragraph spacing stays even.
    .replace(/^[ \t]+$/gm, '');

  // Generator scaffolding headings.
  body = body.replace(/^##[ \t]+(?:Introduction|Article Body)[ \t]*$/gm, '');

  // Trailing source + disclosure block.
  body = body.replace(/\r?\n---[ \t]*\r?\n+\*\*Source:\*\*[\s\S]*$/, '\n');

  return body.replace(/\n{3,}/g, '\n\n').trim();
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Every published article for one PST day. Defaults to today. */
export async function fetchNewsDay(date?: string): Promise<NewsArticle[]> {
  const day = date || pstToday();
  return publishedFrom(await readDayManifest(day), day);
}

/** Run `fn` over `items` with at most `limit` promises in flight. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      for (;;) {
        const i = cursor++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Newest day first, then newest article within the day. */
function byRecency(a: NewsArticle, b: NewsArticle): number {
  // Sorting on `date` before `created` is what puts today's articles above
  // yesterday's even when a late top-up run gives an older article a fresher
  // `created`.
  return b.date.localeCompare(a.date) || b.created.localeCompare(a.created);
}

/**
 * Every published article in the last `days`, newest first.
 *
 * Returns the whole window rather than a page: the caller slices it. That keeps
 * the ordering decision in one place, and the cost is nothing after the first
 * call because each day's manifest is memoised — paging through a month re-reads
 * the CDN zero times.
 *
 * Reads `latest.json` for the days that actually exist, so a quiet stretch costs
 * no requests at all rather than one 404 per empty day.
 */
export async function fetchNewsWindow(days = FEED_WINDOW_DAYS): Promise<NewsArticle[]> {
  const dates = await recentDays(days);
  const perDay = await mapLimit(dates, MANIFEST_CONCURRENCY, d => fetchNewsDay(d));
  return perDay.flat().sort(byRecency);
}

/**
 * The most recent published articles, walking back day by day.
 *
 * A capped view of `fetchNewsWindow`, kept for callers that want a fixed-size
 * list (the /news index) rather than a pageable window.
 */
export async function fetchLatestNews(days = 7, limit = 60): Promise<NewsArticle[]> {
  return (await fetchNewsWindow(days)).slice(0, limit);
}

/**
 * The most recent days that actually have content, newest first.
 *
 * Reads `latest.json` so a quiet stretch does not cost one 404 per empty day;
 * falls back to walking the calendar when that pointer is missing.
 */
async function recentDays(days: number): Promise<string[]> {
  const raw = await readNewsFile('latest.json');
  if (raw) {
    try {
      const latest = JSON.parse(raw) as LatestManifest;
      const found = (latest.days ?? [])
        .map(d => d.date)
        .filter(isValidDate)
        .sort((a, b) => b.localeCompare(a))
        .slice(0, days);
      if (found.length) return found;
    } catch {
      /* fall through to the calendar walk */
    }
  }
  const today = new Date();
  return Array.from({ length: days }, (_, i) =>
    pstToday(new Date(today.getTime() - i * 86400000)));
}

/**
 * The slug -> date index.
 *
 * Article URLs are the bare slug, but storage is date-partitioned, so a lookup
 * needs to know which day folder to open. The pipeline writes this alongside
 * `latest.json` and claims slugs across the whole retention window, so an entry
 * here is unambiguous.
 */
export async function fetchSlugIndex(): Promise<Record<string, string>> {
  const cached = slugIndexCache;
  if (cached && Date.now() - cached.at < MANIFEST_TTL_MS) return cached.slugs;

  const raw = await readNewsFile('slugs.json');
  let slugs: Record<string, string> = {};
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { slugs?: Record<string, string> };
      if (parsed.slugs && typeof parsed.slugs === 'object') slugs = parsed.slugs;
    } catch (err) {
      console.error('[news] slugs.json is not valid JSON:', err instanceof Error ? err.message : err);
    }
  }
  slugIndexCache = { at: Date.now(), slugs };
  return slugs;
}

/** The day a slug was published on, or null. */
export async function resolveSlugDate(slug: string): Promise<string | null> {
  if (!slug) return null;
  const date = (await fetchSlugIndex())[slug];
  if (date && isValidDate(date)) return date;

  // Fallback: the index may lag a publish, or predate this feature. Walk the
  // recent days rather than 404 an article that is genuinely there.
  for (const day of await recentDays(14)) {
    const manifest = await readDayManifest(day);
    if (manifest?.articles?.some(a => a.slug === slug && a.status === 'published')) return day;
  }
  return null;
}

/** One article by slug alone, or null when it is not published. */
export async function fetchNewsArticleBySlug(slug: string): Promise<NewsArticleDetail | null> {
  const date = await resolveSlugDate(slug);
  return date ? fetchNewsArticle(date, slug) : null;
}

/** One article with its body, or null when it is not published. */
export async function fetchNewsArticle(date: string, slug: string): Promise<NewsArticleDetail | null> {
  if (!isValidDate(date) || !slug) return null;

  const manifest = await readDayManifest(date);
  // Manifest-is-authoritative: an article.md nobody lists stays unreachable.
  const entry = manifest?.articles?.find(a => a.slug === slug && a.status === 'published');
  if (!entry) return null;

  const raw = await readNewsFile(`${dayPrefix(date)}/${entry.file}`);
  if (!raw) return null;

  return { ...toArticle(entry, date), content: stripFrontmatter(raw) };
}

/**
 * Split a legacy `<id>` path segment back into its parts.
 * Ids are `<YYYY-MM-DD>__<slug>`, kept to one path segment.
 */
export function parseNewsId(id: string): { date: string; slug: string } | null {
  const [date, ...rest] = String(id || '').split('__');
  const slug = rest.join('__');
  return isValidDate(date) && slug ? { date, slug } : null;
}
