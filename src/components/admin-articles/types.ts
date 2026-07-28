/**
 * Shared types for the back-office Articles Management page
 * (src/app/(admin)/admin/articles). Mirrors the shapes returned by the
 * unchanged Express admin API.
 */

export type SourceType = 'article' | 'current_event';

/** A taxonomy category as returned by GET /api/admin/categories. */
export interface AdminCategory {
  id: number;
  name?: string;
  parent_id?: number | null;
  [key: string]: unknown;
}

export interface CategoriesResponse {
  success?: boolean;
  categories?: AdminCategory[];
  error?: string;
}

/** A row in the articles-management list (article or current event). */
export interface AdminArticle {
  id: number;
  source_type: SourceType;
  title?: string;
  status?: string;
  approved?: boolean;
  created_at?: string;
  updated_at?: string;
  pub_date?: string;
  [key: string]: unknown;
}

export interface ArticlesMgmtResponse {
  success?: boolean;
  articles?: AdminArticle[];
  error?: string;
}

/** Engagement counters keyed by "a:<id>" / "ce:<id>". */
export interface ArticleStat {
  views: number;
  clicks: number;
  likes: number;
  dislikes: number;
}

export interface ArticleStatsResponse {
  success?: boolean;
  stats?: Record<string, Partial<ArticleStat>>;
  error?: string;
}

export interface BulkStatusResponse {
  success?: boolean;
  error?: string;
}

/** Selected-checkbox value, encoded as `${id}:${source_type}`. */
export interface SelectionItem {
  id: number;
  source_type: SourceType;
}

export type BulkAction = 'activate' | 'deactivate';
