/**
 * Shared types for the back-office Dashboard (src/app/(admin)/admin).
 * Mirrors the shapes returned by the unchanged Express admin API, faithfully
 * ported from public/admin/dashboard.html.
 */

/** Raw album record from GET /api/admin/albums?category_id=. */
export interface AdminAlbum {
  id: number;
  title: string;
  slug?: string;
  sort_order?: number;
  [key: string]: unknown;
}

/**
 * A node in the dashboard category tree. Real categories use a numeric id;
 * albums are folded into the tree as pseudo-nodes with a string id
 * (`album-<id>`), `level: 99`, and `is_album: true` (matching the original).
 */
export interface DashCategory {
  id: number | string;
  name: string;
  slug?: string;
  parent_id?: number | null;
  level?: number;
  sort_order?: number;
  is_album?: boolean;
  album_data?: AdminAlbum;
}

/** A row in the per-category content list (GET /api/admin/articles). */
export interface DashArticle {
  id: number;
  title: string;
  author?: string;
  content?: string;
  content_type?: string;
  subtype?: string | null;
  status?: string;
  created_at?: string;
  category_id?: number;
  christian_lesson?: string;
  music_type?: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface ArticlesResponse {
  articles?: DashArticle[];
  aggregated?: boolean;
  success?: boolean;
  error?: string;
}

export interface ArticleDetailResponse {
  success?: boolean;
  article?: DashArticle;
  error?: string;
}

/** A background Pulse task (GET /api/pulse-tasks). */
export interface PulseTask {
  id?: number | string;
  task_id?: number | string;
  title: string;
  user?: string;
  status: string;
  delivery_type?: string;
  start_date?: string;
  done_date?: string;
  error_message?: string;
  [key: string]: unknown;
}

/** Payload for POST /api/pulse-tasks. */
export interface NewTaskPayload {
  title: string;
  instructions: string;
  category_location: string;
  status: string;
  user: string;
  delivery_type: string;
  immediate_execution: number;
  start_date?: string;
  end_date?: string;
  interval_value?: number;
  frequency_type?: string;
  days_of_week?: number[];
  execution_times?: string[];
}

export interface CreateTaskResponse {
  task_id?: number | string;
  success?: boolean;
  error?: string;
}

/** A pending/approved/rejected current event (GET /api/admin/current-events). */
export interface CurrentEvent {
  id: number;
  headline?: string;
  topic?: string;
  word_count?: number;
  cached_image_path?: string | null;
  image_url?: string | null;
  approval_reason?: string;
  [key: string]: unknown;
}

export interface CurrentEventsResponse {
  articles: CurrentEvent[];
  total: number;
}

export interface ApprovalResponse {
  success?: boolean;
  error?: string;
}

/** Reply from POST /api/chat/message. */
export interface ChatResponse {
  response: string;
  taskId?: number | string;
}

/** A single rendered chat bubble. */
export interface ChatMessage {
  text: string;
  isUser: boolean;
  timeString: string;
  timestamp: number;
}

export type PortalStatus = 'pending' | 'approved' | 'rejected';
