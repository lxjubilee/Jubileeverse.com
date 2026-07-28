'use client';

/**
 * Single-row editor (back-office).
 *
 * A back-office row can be a regular `article` OR a `current_event`; the kind is
 * carried on the URL as `?type=article|current_event` (default 'article'). The
 * editor branches on that type because the two sources have different shapes,
 * different fields, and different backend endpoints.
 *
 * Ported from the original static admin flow:
 *  - public/admin/article.html  — read-only viewer that loads an article by id.
 *  - public/admin/articles.html — the authoritative *editor* (the "Edit" modal).
 *
 * Access is already gated by the (admin) layout's <AdminGate>, so this page does
 * NOT re-check auth. All calls go through `api`, which auto-attaches the Bearer
 * token. The id is read from the route param; `useSearchParams` reads ?type=, so
 * the component is wrapped in <Suspense>.
 *
 * Backend contracts (verified):
 *  Article load:   GET   /api/admin/articles/:id                  -> { success, article }
 *  Article save:   PUT   /api/admin/articles/:id                  -> { success, article }
 *                    body { title, author, content, content_type, status, music_type, christian_lesson }
 *  Article hero:   PATCH /api/admin/articles/:id/hero-image       -> { success, article }
 *  Article files:  POST  /api/admin/articles/:id/attachments      (multipart 'file')
 *  CE load:        GET   /api/admin/current-events/:id            -> { success, article }
 *  CE content:     PATCH /api/current-events/:id                  -> { success, articleId, updated }
 *                    body { headline?, full_article? }
 *  CE status:      PATCH /api/admin/articles-mgmt/current_event/:id/status -> { success }
 *                    body { action: 'activate' | 'deactivate' }  (activate = approved=true)
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import type { SourceType } from '@/components/admin-articles/types';
import styles from './article.module.css';

/** Article shape returned by GET /api/admin/articles/:id (server.js SELECT). */
interface AdminArticle {
  id: number | string;
  category_id?: number | string | null;
  category_name?: string | null;
  title?: string | null;
  author?: string | null;
  content?: string | null;
  content_type?: string | null;
  status?: string | null;
  song_number?: number | string | null;
  song_title?: string | null;
  christian_lesson?: string | null;
  music_type?: string | null;
  created_at?: string | null;
  /** Hero image fields are returned by PUT's RETURNING * and may be present. */
  hero_image_path?: string | null;
  hero_image_status?: string | null;
}

interface ArticleResponse {
  success?: boolean;
  error?: string;
  article?: AdminArticle;
}

/** Current-event shape returned by GET /api/admin/current-events/:id. */
interface CurrentEvent {
  id: number | string;
  headline?: string | null;
  excerpt?: string | null;
  faith_reflection?: string | null;
  full_article?: string | null;
  source_name?: string | null;
  source_url?: string | null;
  pub_date?: string | null;
  image_url?: string | null;
  cached_image_path?: string | null;
  topic?: string | null;
  category_id?: number | string | null;
  approved?: boolean | null;
  approval_reason?: string | null;
  created_at?: string | null;
}

interface CurrentEventResponse {
  success?: boolean;
  error?: string;
  article?: CurrentEvent;
}

interface CurrentEventContentResponse {
  success?: boolean;
  error?: string;
  articleId?: number | string;
  updated?: { headline?: string };
}

interface StatusResponse {
  success?: boolean;
  error?: string;
}

interface AttachmentResponse {
  success?: boolean;
  error?: string;
  file?: {
    originalName: string;
    filename: string;
    path: string;
    size: number;
    mimeType: string;
  };
}

type Toast = { text: string; type: 'success' | 'error' } | null;

/** Format an ISO timestamp the way the original viewer did. */
function formatDate(str?: string | null): string {
  if (!str) return '-';
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function parseSourceType(raw: string | null): SourceType {
  return raw === 'current_event' ? 'current_event' : 'article';
}

function ArticleEditor() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const searchParams = useSearchParams();
  const sourceType = parseSourceType(searchParams.get('type'));
  const isCurrentEvent = sourceType === 'current_event';

  // Load state
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Common header context
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  // --- Article-specific state (source_type = 'article') ---
  const [article, setArticle] = useState<AdminArticle | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('published');
  const [author, setAuthor] = useState('');
  const [typeLabel, setTypeLabel] = useState('');
  const [heroPath, setHeroPath] = useState('');
  const [heroSaving, setHeroSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // --- Current-event-specific state (source_type = 'current_event') ---
  const [headline, setHeadline] = useState('');
  const [fullArticle, setFullArticle] = useState('');
  // `approved` is the editable status control; `initialApproved` is what we
  // loaded, so on Save we only hit the status endpoint when it actually changed.
  const [approved, setApproved] = useState(false);
  const [initialApproved, setInitialApproved] = useState(false);
  const [sourceName, setSourceName] = useState('');

  // Shared action state
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((text: string, type: 'success' | 'error') => {
    setToast({ text, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // Populate the article form from a loaded/saved article.
  const applyArticle = useCallback((art: AdminArticle) => {
    setArticle(art);
    setTitle(art.title || '');
    setContent(art.content || '');
    setStatus(art.status || 'published');
    setAuthor(art.author || '');
    setTypeLabel(`Article (${art.content_type || 'article'})`);
    setHeroPath(art.hero_image_path || '');
    setCategoryName(art.category_name || null);
    setCreatedAt(art.created_at || null);
  }, []);

  // Populate the current-event form from a loaded event.
  const applyCurrentEvent = useCallback((ev: CurrentEvent) => {
    setHeadline(ev.headline || '');
    setFullArticle(ev.full_article || '');
    const isApproved = ev.approved === true;
    setApproved(isApproved);
    setInitialApproved(isApproved);
    setSourceName(ev.source_name || '');
    setCategoryName(null);
    setCreatedAt(ev.created_at || null);
  }, []);

  // Load the row, branching on source type.
  useEffect(() => {
    if (!id) {
      setError(isCurrentEvent ? 'No current event ID provided' : 'No article ID provided');
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (isCurrentEvent) {
          const data = await api.get<CurrentEventResponse>(`/api/admin/current-events/${id}`);
          if (cancelled) return;
          if (data.success === false || !data.article) {
            throw new Error(data.error || 'Invalid response format');
          }
          applyCurrentEvent(data.article);
        } else {
          const data = await api.get<ArticleResponse>(`/api/admin/articles/${id}`);
          if (cancelled) return;
          if (data.success === false || !data.article) {
            throw new Error(data.error || 'Invalid response format');
          }
          applyArticle(data.article);
        }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) {
          setError(isCurrentEvent ? 'Current event not found' : 'Article not found');
        } else {
          setError(e instanceof Error ? e.message : 'Error loading');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, isCurrentEvent, applyArticle, applyCurrentEvent]);

  // Save an article: PUT /api/admin/articles/:id.
  const handleSaveArticle = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const data = await api.put<ArticleResponse>(`/api/admin/articles/${id}`, {
        title: title.trim(),
        content,
        status,
      });
      if (data.success === false) throw new Error(data.error || 'Save failed');
      if (data.article) applyArticle(data.article);
      showToast('Article saved', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [id, title, content, status, applyArticle, showToast]);

  // Save a current event: PATCH content, and PATCH status if approval changed.
  const handleSaveCurrentEvent = useCallback(async () => {
    if (!id) return;
    setSaving(true);
    try {
      const data = await api.patch<CurrentEventContentResponse>(`/api/current-events/${id}`, {
        headline: headline.trim(),
        full_article: fullArticle,
      });
      if (data.success === false) throw new Error(data.error || 'Save failed');

      // Only touch the status endpoint when the approved flag actually changed.
      if (approved !== initialApproved) {
        const action = approved ? 'activate' : 'deactivate';
        const statusData = await api.patch<StatusResponse>(
          `/api/admin/articles-mgmt/current_event/${id}/status`,
          { action },
        );
        if (statusData.success === false) {
          throw new Error(statusData.error || 'Status update failed');
        }
        setInitialApproved(approved);
      }

      if (data.updated?.headline !== undefined) setHeadline(data.updated.headline || '');
      showToast('Current event saved', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      showToast(`Save failed: ${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [id, headline, fullArticle, approved, initialApproved, showToast]);

  const handleSave = isCurrentEvent ? handleSaveCurrentEvent : handleSaveArticle;

  // Update hero image (articles only): PATCH /api/admin/articles/:id/hero-image.
  const handleHeroSave = useCallback(async () => {
    if (!id) return;
    setHeroSaving(true);
    try {
      const data = await api.patch<ArticleResponse>(`/api/admin/articles/${id}/hero-image`, {
        hero_image_path: heroPath.trim() || null,
        hero_image_status: heroPath.trim() ? 'ready' : null,
      });
      if (data.success === false) throw new Error(data.error || 'Failed');
      showToast('Hero image updated', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed';
      showToast(`Image update failed: ${msg}`, 'error');
    } finally {
      setHeroSaving(false);
    }
  }, [id, heroPath, showToast]);

  // Upload an attachment (articles only): POST /api/admin/articles/:id/attachments.
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !id) return;
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        // FormData body: let the browser set the multipart Content-Type boundary.
        const data = await api.post<AttachmentResponse>(
          `/api/admin/articles/${id}/attachments`,
          undefined,
          { body: form },
        );
        if (data.success === false || !data.file) {
          throw new Error(data.error || 'Upload failed');
        }
        showToast(`Uploaded ${data.file.originalName}`, 'success');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        showToast(`Upload failed: ${msg}`, 'error');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [id, showToast],
  );

  const handlePrint = useCallback(() => window.print(), []);

  // ---- Render ----

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loadingSpinner}>
          <p>Loading {isCurrentEvent ? 'current event' : 'article'}...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.errorState}>
          <h2>Error Loading {isCurrentEvent ? 'Current Event' : 'Article'}</h2>
          <p>{error}</p>
          <div className={styles.articleActions}>
            <Link href="/admin/articles" className={`${styles.btn} ${styles.btnSecondary}`}>
              Back to Articles
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const headerTitle = isCurrentEvent ? headline || 'Untitled' : title || 'Untitled';

  return (
    <div className={styles.container}>
      {/* Header — category + meta, as in the original viewer */}
      <div className={styles.articleHeader}>
        {categoryName ? <div className={styles.articleCategory}>{categoryName}</div> : null}
        <h1 className={styles.articleTitle}>{headerTitle}</h1>
        <div className={styles.articleMeta}>
          <span>{isCurrentEvent ? 'Current Event ID' : 'Article ID'}: {id}</span>
          <span>Created: {formatDate(createdAt)}</span>
        </div>
      </div>

      {isCurrentEvent ? (
        /* ── Current-event editor ── */
        <div className={styles.articleContent}>
          <div className={styles.formGroup}>
            <label htmlFor="editHeadline">Headline</label>
            <input
              id="editHeadline"
              type="text"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="editSource">Source</label>
              <input id="editSource" type="text" value={sourceName} readOnly />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="editType">Type</label>
              <input id="editType" type="text" value="Current Event" readOnly />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="editApproved">Status</label>
              <select
                id="editApproved"
                value={approved ? 'approved' : 'unapproved'}
                onChange={(e) => setApproved(e.target.value === 'approved')}
              >
                <option value="approved">Approved</option>
                <option value="unapproved">Unapproved</option>
              </select>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="editFullArticle">Full Article (Markdown)</label>
            <textarea
              id="editFullArticle"
              value={fullArticle}
              onChange={(e) => setFullArticle(e.target.value)}
            />
          </div>
        </div>
      ) : (
        /* ── Article editor ── */
        <div className={styles.articleContent}>
          <div className={styles.formGroup}>
            <label htmlFor="editTitle">Title</label>
            <input
              id="editTitle"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="editAuthor">Author / Source</label>
              <input id="editAuthor" type="text" value={author} readOnly />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="editType">Type</label>
              <input id="editType" type="text" value={typeLabel} readOnly />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="editStatus">Status</label>
              <select id="editStatus" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="published">Published</option>
                <option value="unpublished">Unpublished</option>
              </select>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="editContent">Content (Markdown)</label>
            <textarea
              id="editContent"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Hero image + attachments are article-only (no such CE endpoints). */}
      {!isCurrentEvent ? (
        <>
          {/* Hero image action (PATCH .../hero-image) */}
          <div className={styles.articleContent}>
            <div className={styles.sectionLabel}>Hero Image</div>
            {heroPath ? (
              // Backend hero images live under /images (proxied); render with a plain <img>.
              <img className={styles.heroPreview} src={heroPath} alt="Article hero" />
            ) : null}
            <div className={styles.formGroup}>
              <label htmlFor="heroPath">Hero image path or URL</label>
              <input
                id="heroPath"
                type="text"
                value={heroPath}
                placeholder="/images/articles/hero.jpg"
                onChange={(e) => setHeroPath(e.target.value)}
              />
            </div>
            <button
              className={`${styles.btn} ${styles.btnSecondary}`}
              onClick={handleHeroSave}
              disabled={heroSaving}
            >
              {heroSaving ? 'Saving image…' : 'Update Image'}
            </button>
          </div>

          {/* Attachment action (POST .../attachments) */}
          <div className={styles.articleContent}>
            <div className={styles.sectionLabel}>Attachments</div>
            <input
              ref={fileInputRef}
              type="file"
              className={styles.fileInput}
              onChange={handleFileChange}
              disabled={uploading}
            />
            {uploading ? <span className={styles.uploadingText}>Uploading…</span> : null}
          </div>
        </>
      ) : null}

      {/* Actions */}
      <div className={styles.articleActions}>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
        <Link href="/admin/articles" className={`${styles.btn} ${styles.btnSecondary}`}>
          Back to Articles
        </Link>
        <button className={`${styles.btn} ${styles.btnSecondary}`} onClick={handlePrint}>
          Print
        </button>
      </div>

      {/* Toast (matches articles.html success/error feedback) */}
      {toast ? (
        <div className={`${styles.toast} ${styles[toast.type]} ${styles.show}`}>{toast.text}</div>
      ) : null}
    </div>
  );
}

export default function ArticleEditorPage() {
  // useSearchParams requires a Suspense boundary in the App Router.
  return (
    <Suspense
      fallback={
        <div className={styles.container}>
          <div className={styles.loadingSpinner}>
            <p>Loading…</p>
          </div>
        </div>
      }
    >
      <ArticleEditor />
    </Suspense>
  );
}
