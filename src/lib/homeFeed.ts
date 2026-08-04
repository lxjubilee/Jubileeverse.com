/**
 * CDN news → the `Story` shape the Home page already speaks.
 *
 * The Home page, `StoryCard`, `HeroCarousel`, the search index and the article
 * stash were all written against the snake_case `Story` produced by the old
 * PostgreSQL `/api/homepage-placement` endpoint. Rather than touch any of them
 * — the layout and UI must not move — this adapts the CDN's camelCase
 * `NewsArticle` onto that shape, so nothing downstream knows the source changed.
 *
 * Pure and dependency-free so it can be unit tested without network or DOM.
 */
import type { SiteArticle } from './articles';
import type { NewsArticle } from './news';
import type { Story } from './types';

/** Hero slots on the Home page. */
export const HERO_COUNT = 5;
/** Sidebar slots beside the hero. */
export const SIDEBAR_COUNT = 3;

/** Current-event cards between each inserted faith-based article. */
export const INSERT_EVERY = 4;

/**
 * Grid cards served per request.
 *
 * The window is a month deep, which at full production is ~1,800 articles. Sent
 * in one response that is roughly a megabyte of JSON and eighteen hundred cards
 * in the DOM before the reader has scrolled past the first four. A page of
 * fifty is more than fills the first few screens, and the rest arrive as they
 * are approached.
 */
export const PAGE_SIZE = 50;

/**
 * A non-negative integer query param, clamped, or the fallback.
 *
 * Lives here rather than in the route because a Next route module may only
 * export the HTTP handlers and a fixed set of config names — exporting a helper
 * from it fails the production build with a type error that `tsc --noEmit`
 * does not reproduce.
 *
 * The clamping is the only thing between a crafted `?limit=100000` and a
 * month-long payload, which is what paging exists to avoid.
 */
export function intParam(value: string | null, fallback: number, max: number): number {
  // Absent and blank are checked before Number(), because `Number(null)` and
  // `Number('')` are both 0 — a finite, non-negative 0 that sails past the
  // guard below and silently returns 0 instead of the fallback it was given.
  if (value === null || value.trim() === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export interface HomeFeed {
  success: true;
  hero: Story[];
  sidebar: Story[];
  topicCards: Story[];
  /** Faith-based category articles, in the order they should be inserted. */
  categoryCards: Story[];
  /** Grid cards available across the whole window, for paging. */
  total: number;
  /** Index this page starts at, within the grid. */
  offset: number;
  /** Whether another page exists after this one. */
  hasMore: boolean;
}

/**
 * A stable positive integer derived from a slug.
 *
 * Reactions and view tracking store `article_id` as INTEGER (see
 * `article_reactions` / `article_views` in server.js), and the handler passes
 * the value straight into SQL — a slug string would throw and every like would
 * silently fail. Hashing gives those tables a usable key with no schema change.
 *
 * Offset into 1e9..2e9 so it can never collide with a `current_events` serial
 * id, which would otherwise let a news article share like counts with an
 * unrelated story. Comfortably inside INTEGER's 2147483647 ceiling.
 */
export function reactionIdForSlug(slug: string): number {
  let hash = 2166136261;                       // FNV-1a 32-bit
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 1_000_000_000 + (Math.abs(hash) % 1_000_000_000);
}

/**
 * One CDN article as a `Story`.
 *
 * `id` is the slug because it is what the card's link, React key and the
 * article URL all need. The numeric reaction key rides alongside in
 * `reaction_id`.
 */
export function toStory(article: NewsArticle): Story {
  return {
    id: article.slug,
    // StoryCard reads `headline` first, `title` as fallback; HeroCarousel reads
    // `headline`. Populate both so neither has to change.
    headline: article.title,
    title: article.title,
    excerpt: article.summary,
    // resolveImageUrl() prefers cached_image_path and returns an absolute URL
    // unchanged, so the CDN URL works with no change to that helper.
    cached_image_path: article.image,
    image_url: article.image,
    source_name: article.sourceName,
    source_url: article.sourceUrl,
    topic: article.topic,
    category: article.topic,
    pub_date: article.date,
    published_at: article.created,
    isCurrentEvent: true,
    // Extras the UI ignores but the reader and reaction paths use.
    slug: article.slug,
    date: article.date,
    reaction_id: reactionIdForSlug(article.slug),
  };
}

/**
 * One published category article as a `Story`.
 *
 * Mirrors the mapping the category portals already use, so an inserted card is
 * the same card: same fields, same component, same dimensions.
 *
 * Two fields carry the whole difference from a current event:
 *
 *   - `isCurrentEvent: false` puts the author in the byline badge rather than
 *     "JubileeVerse" and files reactions under the `article` namespace;
 *   - no `slug`/`date` pair, so `storyHref()` sends the card to
 *     /article/<category>__<slug> rather than to a root news URL.
 *
 * `reaction_id` is the same trick CDN news uses: `article_reactions.article_id`
 * is INTEGER and these ids are `<category>__<slug>`, so a hashed integer rides
 * alongside for the reaction and view paths.
 */
export function categoryArticleToStory(article: SiteArticle): Story {
  return {
    id: article.id,
    // StoryCard reads `headline` first, `title` as fallback; populate both.
    headline: article.title,
    title: article.title,
    // resolveImageUrl() prefers cached_image_path and returns an absolute URL
    // unchanged, so the CDN URL works with no change to that helper.
    cached_image_path: article.image,
    image_url: null,
    category: article.category,
    topic: article.category,
    source_name: article.author,
    published_at: article.created,
    isCurrentEvent: false,
    reaction_id: reactionIdForSlug(article.id),
  };
}

/**
 * Take from each category in turn until `limit` is reached.
 *
 * Round-robin rather than concatenation: the Home page shows only a dozen or so
 * of these, and taking them in category order would fill every slot from the
 * first category alone. One from each, then a second from each, keeps any
 * category from being over-represented no matter how the feed is truncated.
 *
 * Exhausted categories drop out rather than stalling the rotation, so five
 * categories of unequal length still yield the requested count.
 */
export function rotateCategories(byCategory: Story[][], limit: number): Story[] {
  const out: Story[] = [];
  const lists = byCategory.filter((list) => list.length > 0);
  if (!lists.length || limit <= 0) return out;

  const longest = Math.max(...lists.map((list) => list.length));
  for (let depth = 0; depth < longest && out.length < limit; depth++) {
    for (const list of lists) {
      if (out.length >= limit) break;
      if (depth < list.length) out.push(list[depth]);
    }
  }
  return out;
}

/**
 * Weave the inserts into the feed: one after every `every` primary cards.
 *
 * The primary order is never disturbed — inserts only ever land *between*
 * current events, so the feed's own sorting still reads top to bottom. Runs out
 * quietly when the inserts do, and inserts nothing at all into a feed shorter
 * than one interval.
 */
export function interleaveFeed(primary: Story[], inserts: Story[], every = INSERT_EVERY): Story[] {
  if (!inserts.length || every <= 0) return primary;

  const out: Story[] = [];
  let next = 0;
  for (let i = 0; i < primary.length; i++) {
    out.push(primary[i]);
    if ((i + 1) % every === 0 && next < inserts.length) out.push(inserts[next++]);
  }
  return out;
}

/** How many inserts a feed of this length can take. */
export function insertsNeeded(feedLength: number, every = INSERT_EVERY): number {
  return every > 0 ? Math.floor(feedLength / every) : 0;
}

/**
 * Split the feed into the hero / sidebar / grid the Home page expects.
 *
 * Input must already be newest-first; `fetchNewsWindow` sorts by day then by
 * article within the day, which is exactly the requested "newest at the top,
 * older below in descending order".
 *
 * Articles with no image are dropped. Imageless stories are a hard exclusion on
 * this site — the pipeline already holds them back as drafts, and this is the
 * last line of that rule.
 *
 * `offset` pages the GRID only. The hero and sidebar are always the newest
 * eight stories and are returned on the first page alone: they are a fixed
 * region of the layout, and re-sending them with every page would either
 * duplicate cards in the grid or shift the ones already on screen.
 */
export function buildHomeFeed(
  articles: NewsArticle[],
  categoryCards: Story[] = [],
  { offset = 0, pageSize = PAGE_SIZE }: { offset?: number; pageSize?: number } = {},
): HomeFeed {
  const usable = articles.filter(a => a.image);
  const stories = usable.map(toStory);

  const grid = stories.slice(HERO_COUNT + SIDEBAR_COUNT);
  const start = Math.max(0, Math.floor(offset));
  const page = grid.slice(start, start + Math.max(1, pageSize));
  const firstPage = start === 0;

  // Inserts continue the rotation rather than restarting it, so page two does
  // not repeat the faith-based articles page one already showed.
  const insertsBefore = insertsNeeded(start);
  const insertsHere = insertsNeeded(page.length);

  return {
    success: true,
    hero: firstPage ? stories.slice(0, HERO_COUNT) : [],
    sidebar: firstPage ? stories.slice(HERO_COUNT, HERO_COUNT + SIDEBAR_COUNT) : [],
    topicCards: page,
    // A few spare: the page filters blocked and hidden stories before weaving,
    // which only ever shortens the feed, and an unused insert costs nothing.
    categoryCards: categoryCards.slice(insertsBefore, insertsBefore + insertsHere + 2),
    total: grid.length,
    offset: start,
    hasMore: start + page.length < grid.length,
  };
}
