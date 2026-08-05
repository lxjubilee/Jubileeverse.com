/**
 * Thin client for the unchanged Express REST API.
 *
 * All requests use relative `/api/...` paths. In development next.config.mjs
 * rewrites these to the Express origin (http://localhost:3107); in production a
 * reverse proxy does the same. This keeps the browser same-origin (no CORS) and
 * means content/image URLs returned by the API ("/images/...") just work.
 */
import type { SyntheticEvent } from 'react';
import { clearStoredAuth, getAuthToken, getRefreshToken, getStoredAuth, setStoredAuth } from './authStorage';
import { getCsrfToken } from './csrf';

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

export interface ApiFetchOptions extends Omit<RequestInit, 'body'> {
  /** JSON body — automatically serialized and given a JSON content type. */
  json?: unknown;
  /** Raw body (FormData, string, etc.) when `json` is not appropriate. */
  body?: BodyInit | null;
  /** Set false to skip attaching the Authorization header. Default: true. */
  auth?: boolean;
}

/** Requests the backend's CSRF guard lets through untouched. */
const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function buildHeaders(options: ApiFetchOptions): Headers {
  const headers = new Headers(options.headers);
  if (options.json !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (options.auth !== false) {
    const token = getAuthToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }
  // A reader signed in through /auth carries a session cookie, and the backend
  // then rejects every state-changing /api/ call that does not echo the
  // `jv-csrf` cookie back as a header. Bearer-only callers have no such cookie
  // and the guard skips them, so this is a no-op for them.
  const method = (options.method || 'GET').toUpperCase();
  if (!CSRF_SAFE_METHODS.has(method) && !headers.has('X-CSRF-Token')) {
    const csrf = getCsrfToken();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  return headers;
}

const REFRESH_PATH = '/api/auth/refresh';

/**
 * Outcome of a refresh attempt:
 *   'ok'      — a fresh access token is stored, retry the call
 *   'invalid' — the server definitively rejected the refresh token; sign out
 *   'error'   — transient (network, 5xx). Keep the tokens; a blip must never
 *               log the user out.
 */
type RefreshResult = 'ok' | 'invalid' | 'error';

/** In-flight refresh, shared by every concurrent caller so we only ever do one. */
let refreshing: Promise<RefreshResult> | null = null;

async function doRefresh(): Promise<RefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return 'invalid';
  try {
    const res = await fetch(REFRESH_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (res.status === 401) return 'invalid';
    if (!res.ok) return 'error';
    const data = (await res.json()) as { token?: string; refreshToken?: string; expiresAt?: string };
    if (!data?.token) return 'error';
    const stored = getStoredAuth();
    setStoredAuth({
      authenticated: true,
      user: stored?.user ?? null,
      token: data.token,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
    });
    return 'ok';
  } catch {
    return 'error';
  }
}

function tryRefresh(): Promise<RefreshResult> {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

/**
 * Core request helper. Returns parsed JSON (typed as T) or text. Throws
 * ApiError on a non-2xx response so callers can branch on `.status`.
 *
 * Token upkeep happens here so no caller has to think about it: PROACTIVELY when
 * the access token has lapsed but a refresh token remains, and REACTIVELY on a
 * 401 (refresh once, replay once).
 */
export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { json, auth, headers: _headers, ...rest } = options;
  const send = () => {
    const init: RequestInit = { ...rest, headers: buildHeaders(options) };
    if (json !== undefined) {
      init.body = JSON.stringify(json);
    } else if (options.body !== undefined) {
      init.body = options.body;
    }
    return fetch(path, init);
  };

  const wantsAuth = auth !== false && path !== REFRESH_PATH;

  if (wantsAuth && !getAuthToken() && getRefreshToken()) {
    if ((await tryRefresh()) === 'invalid') clearStoredAuth();
  }

  let res = await send();

  if (res.status === 401 && wantsAuth && getRefreshToken()) {
    const result = await tryRefresh();
    if (result === 'ok') res = await send();
    else if (result === 'invalid') clearStoredAuth();
  }

  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const message =
      (isJson && payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as Record<string, unknown>).error)
        : undefined) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

export const api = {
  get: <T = unknown>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'GET' }),
  post: <T = unknown>(path: string, json?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'POST', json }),
  put: <T = unknown>(path: string, json?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'PUT', json }),
  patch: <T = unknown>(path: string, json?: unknown, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'PATCH', json }),
  delete: <T = unknown>(path: string, options?: ApiFetchOptions) =>
    apiFetch<T>(path, { ...options, method: 'DELETE' }),
};

/**
 * Resolve an image path returned by the API into a usable URL. Backend content
 * images are served under /images (proxied), already-absolute URLs pass through,
 * and a placeholder is returned when nothing is available.
 */
/** Neutral fallback image for broken/missing content images. */
export const FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=1200&h=600&fit=crop';

/** onError handler that swaps a broken <img> to the fallback exactly once. */
export function handleImgError(e: SyntheticEvent<HTMLImageElement>): void {
  const img = e.currentTarget;
  if (img.dataset.fellBack === '1') return;
  img.dataset.fellBack = '1';
  img.src = FALLBACK_IMAGE;
}

export function resolveImageUrl(
  story: { cached_image_path?: string | null; image_url?: string | null },
  fallback = '',
): string {
  const cached = story.cached_image_path;
  if (cached) return cached.startsWith('http') ? cached : cached;
  if (story.image_url) return story.image_url;
  return fallback;
}
