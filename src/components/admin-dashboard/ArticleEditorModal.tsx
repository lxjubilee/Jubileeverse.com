'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiFetch } from '@/lib/api';
import type { ArticleDetailResponse, DashArticle } from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * Article editor modal. Ported from dashboard.html openArticleModal/renderArticleModal:
 *   - GET  /api/admin/articles/:id              (load)
 *   - PUT  /api/admin/articles/:id              (save changed fields)
 *   - POST /api/admin/articles/:id/attachments  (multipart upload)
 * Header fields (title/author/content_type/subtype) and the body are editable;
 * only changed keys are sent on save (matches the original `articleChanges` diff).
 */

type ModalTab = 'content' | 'extensions' | 'attachments';

const CONTENT_TYPES = ['Web Article', 'Song Lyrics', 'Story', 'Devotional'];
const SUBTYPES = ['', 'Secret Mystery', 'Fun Facts', 'Behind the Scenes'];

interface UploadedFile {
  name: string;
  size: number;
  status: 'uploading' | 'done' | 'failed';
  /** Stored path returned by the backend (for a View/Download link). */
  path?: string;
}

interface ArticleEditorModalProps {
  articleId: number;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string, type: 'success' | 'error') => void;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
}

export default function ArticleEditorModal({
  articleId,
  onClose,
  onSaved,
  onToast,
}: ArticleEditorModalProps) {
  const [article, setArticle] = useState<DashArticle | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tab, setTab] = useState<ModalTab>('content');
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);

  // Tracks only the fields the user changed (the original "articleChanges" diff).
  const changes = useRef<Partial<DashArticle>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    changes.current = {};
    (async () => {
      try {
        const data = await api.get<ArticleDetailResponse>(`/api/admin/articles/${articleId}`);
        if (cancelled) return;
        if (data.success && data.article) {
          setArticle(data.article);
          setLoadState('ready');
        } else {
          setLoadState('error');
        }
      } catch {
        if (!cancelled) setLoadState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  const setField = useCallback(<K extends keyof DashArticle>(field: K, value: DashArticle[K]) => {
    changes.current[field] = value;
    setArticle((prev) => (prev ? { ...prev, [field]: value } : prev));
  }, []);

  const save = useCallback(async () => {
    if (!article) return;
    if (Object.keys(changes.current).length === 0) {
      onToast('No changes to save', 'error');
      return;
    }
    setSaving(true);
    try {
      const data = await api.put<{ success?: boolean; error?: string }>(
        `/api/admin/articles/${article.id}`,
        changes.current,
      );
      if (data.success) {
        onToast('Article saved successfully', 'success');
        changes.current = {};
        onSaved();
      } else {
        onToast(`Error saving article: ${data.error || 'Unknown error'}`, 'error');
      }
    } catch (e) {
      onToast(`Error saving article: ${e instanceof Error ? e.message : 'failed'}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [article, onSaved, onToast]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !article) return;
      for (const file of Array.from(files)) {
        const entry: UploadedFile = { name: file.name, size: file.size, status: 'uploading' };
        setUploads((prev) => [...prev, entry]);
        const form = new FormData();
        form.append('file', file);
        try {
          // api helper doesn't expose multipart directly; use apiFetch (token auto-attached).
          const data = await apiFetch<{ success?: boolean; file?: { path?: string } }>(
            `/api/admin/articles/${article.id}/attachments`,
            { method: 'POST', body: form },
          );
          setUploads((prev) =>
            prev.map((u) =>
              u === entry
                ? { ...u, status: data.success ? 'done' : 'failed', path: data.file?.path }
                : u,
            ),
          );
        } catch {
          setUploads((prev) =>
            prev.map((u) => (u === entry ? { ...u, status: 'failed' } : u)),
          );
        }
      }
    },
    [article],
  );

  const tabBtn = (id: ModalTab, label: string) => (
    <button
      className={`${styles.modalTab} ${tab === id ? styles.active : ''}`}
      onClick={() => setTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div className={styles.modal} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <button className={styles.modalClose} onClick={onClose} aria-label="Close">
          ×
        </button>

        {loadState === 'loading' ? (
          <div style={{ textAlign: 'center', padding: 40 }}>Loading...</div>
        ) : loadState === 'error' || !article ? (
          <div style={{ textAlign: 'center', padding: 40 }} className={styles.errorText}>
            Error loading article
          </div>
        ) : (
          <>
            {/* HEADER */}
            <div className={styles.modalHeader}>
              <div className={styles.modalHeaderField}>
                <div className={styles.modalHeaderLabel}>Title</div>
                <input
                  className={`${styles.fieldInput} ${styles.modalHeaderValue} ${styles.title}`}
                  value={article.title || ''}
                  onChange={(e) => setField('title', e.target.value)}
                />
              </div>
              <div className={styles.modalHeaderRow}>
                <div className={styles.modalHeaderField}>
                  <div className={styles.modalHeaderLabel}>Author</div>
                  <input
                    className={`${styles.fieldInput} ${styles.modalHeaderValue}`}
                    value={article.author || 'Rico'}
                    onChange={(e) => setField('author', e.target.value)}
                  />
                </div>
                <div className={styles.modalHeaderField}>
                  <div className={styles.modalHeaderLabel}>Content Type</div>
                  <select
                    className={`${styles.fieldInput} ${styles.modalHeaderValue}`}
                    value={article.content_type || 'Web Article'}
                    onChange={(e) => setField('content_type', e.target.value)}
                  >
                    {CONTENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.modalHeaderField}>
                  <div className={styles.modalHeaderLabel}>Subtype</div>
                  <select
                    className={`${styles.fieldInput} ${styles.modalHeaderValue}`}
                    value={article.subtype || ''}
                    onChange={(e) => setField('subtype', e.target.value || null)}
                  >
                    {SUBTYPES.map((t) => (
                      <option key={t} value={t}>
                        {t || 'None'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={styles.modalHeaderField}>
                  <div className={styles.modalHeaderLabel}>Created</div>
                  <div className={styles.modalHeaderValue}>
                    {article.created_at
                      ? new Date(article.created_at).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })
                      : '-'}
                  </div>
                </div>
              </div>
            </div>

            {/* BODY */}
            <div className={styles.modalBody}>
              <div className={styles.modalTabs}>
                {tabBtn('content', 'Content')}
                {tabBtn('extensions', 'Extensions')}
                {tabBtn('attachments', 'Attachments')}
              </div>

              {tab === 'content' ? (
                <div>
                  <textarea
                    className={styles.contentEditor}
                    style={{ width: '100%', background: 'transparent' }}
                    defaultValue={article.content || ''}
                    rows={16}
                    onBlur={(e) => setField('content', e.target.value)}
                  />
                  {article.christian_lesson ? (
                    <div className={styles.lessonSection}>
                      <h4>Christian Lesson:</h4>
                      <p>{article.christian_lesson}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {tab === 'extensions' ? (
                <div>
                  <div className={styles.lessonSection}>
                    <h4>Music Type</h4>
                    <textarea
                      className={styles.musicTypeInput}
                      rows={3}
                      placeholder="Enter music type..."
                      defaultValue={article.music_type || ''}
                      onBlur={(e) => setField('music_type', e.target.value)}
                    />
                  </div>
                  <div className={styles.lessonSection} style={{ marginTop: 20 }}>
                    <h4>Generation Prompt</h4>
                    <textarea
                      className={styles.musicTypeInput}
                      rows={8}
                      readOnly
                      placeholder="No generation prompt set..."
                      value={article.prompt || ''}
                    />
                  </div>
                </div>
              ) : null}

              {tab === 'attachments' ? (
                <div>
                  <div
                    className={`${styles.uploadArea} ${dragOver ? styles.dragOver : ''}`}
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(false);
                      void handleFiles(e.dataTransfer.files);
                    }}
                  >
                    <div className={styles.uploadAreaIcon}>📎</div>
                    <div className={styles.uploadAreaText}>Drag &amp; drop files here</div>
                    <div className={styles.uploadAreaSubtext}>
                      or click to browse (MP3, PDF, and other files supported)
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => void handleFiles(e.target.files)}
                    />
                  </div>

                  {uploads.length > 0 ? (
                    <div className={styles.uploadedFiles}>
                      {uploads.map((u, i) => (
                        <div key={i} className={styles.uploadedFile}>
                          <div className={styles.uploadedFileName}>{u.name}</div>
                          <div className={styles.uploadedFileSize}>{formatFileSize(u.size)}</div>
                          <div
                            className={
                              u.status === 'done'
                                ? styles.uploadStatusOk
                                : u.status === 'failed'
                                  ? styles.uploadStatusFail
                                  : undefined
                            }
                          >
                            {u.status === 'uploading'
                              ? 'Uploading...'
                              : u.status === 'done'
                                ? '✓ Uploaded'
                                : '✗ Failed'}
                          </div>
                          {u.status === 'done' && u.path ? (
                            <a
                              href={u.path}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: 'var(--accent-gold)', fontSize: 12 }}
                            >
                              View
                            </a>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <div className={styles.attachmentsSection}>
                    <div className={styles.attachmentsHeader}>
                      <span className={styles.attachmentsLabel}>Existing Attachments</span>
                    </div>
                    {/* The original page also only showed an informational note here —
                        existing attachments are stored on the file system per article. */}
                    <div className={styles.attachmentNote}>
                      <p>Attachments are stored under:</p>
                      <p style={{ marginTop: 10 }}>
                        <code>/content/[category-path]/article-{article.id}/</code>
                      </p>
                      <p style={{ marginTop: 15, fontSize: 12 }}>
                        Files uploaded during this session appear above.
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {/* FOOTER */}
            <div className={styles.modalFooter}>
              <button className={styles.saveButton} disabled={saving} onClick={() => void save()}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
