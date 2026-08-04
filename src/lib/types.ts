/**
 * Shared domain types for the JubileeVerse frontend.
 *
 * These mirror the shapes returned by the unchanged Express API (server/server.js).
 * They are intentionally permissive (optional fields) because the backend returns
 * partial records depending on the endpoint.
 */

/** A content story — current-events article or editorial article. */
export interface Story {
  id: number | string;
  headline?: string;
  title?: string;
  excerpt?: string;
  full_article?: string;
  faith_reflection?: string;
  cached_image_path?: string | null;
  image_url?: string | null;
  source_name?: string;
  source_url?: string;
  topic?: string;
  category_id?: number;
  category?: string;
  pub_date?: string;
  published_at?: string;
  created_at?: string;
  relevance_score?: number;
  /** Marks a story that came from the current_events namespace. */
  isCurrentEvent?: boolean;
  /** CDN news: the article slug, which is also its URL and its `id`. */
  slug?: string;
  /** CDN news: the PST day it was published, `YYYY-MM-DD`. */
  date?: string;
  /**
   * Numeric key for reactions and view tracking.
   *
   * `article_reactions.article_id` and `article_views.article_id` are INTEGER,
   * so a slug id cannot be stored there. CDN news carries a stable hashed
   * integer here; PostgreSQL stories leave it unset and fall back to `id`.
   */
  reaction_id?: number;
  [key: string]: unknown;
}

/** Authenticated user as stored in localStorage and returned by /api/auth/me. */
export interface AuthUser {
  id?: string | number;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  name?: string;
  email?: string;
  role?: string;
  has_cms_access?: boolean;
  entitlements?: string[];
  [key: string]: unknown;
}

/** Shape persisted under localStorage["jubileeVerseAuth"]. */
export interface StoredAuth {
  authenticated: boolean;
  user: AuthUser | null;
  token?: string;
  tokens?: { access?: string; accessToken?: string; refresh?: string };
  /** Durable half of the session — redeemed at POST /api/auth/refresh. */
  refreshToken?: string;
  /** ISO expiry of `token`. Used to refresh proactively instead of on a 401. */
  expiresAt?: string;
}

/** A node in the editorial taxonomy used to build the nav bar. */
export interface TaxonomyNode {
  id: number | string;
  slug: string;
  label: string;
  name?: string;
  children?: TaxonomyNode[];
}

/** Reaction counts for an article (from /api/reactions/counts). */
export interface ReactionCounts {
  upvote?: number;
  downvote?: number;
  share_count?: number;
}

export type ReactionType = 'upvote' | 'downvote' | 'share';

/** Homepage placement payload (/api/homepage-placement). */
export interface HomepagePlacement {
  success: boolean;
  hero: Story[];
  sidebar: Story[];
}

/** Generic API error envelope returned by many endpoints. */
export interface ApiErrorBody {
  success?: false;
  error?: string;
  message?: string;
}
