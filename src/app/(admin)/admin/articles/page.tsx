'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { clearStoredAuth } from '@/lib/authStorage';
import CategoryTree from '@/components/admin-articles/CategoryTree';
import type {
  AdminArticle,
  ArticleStat,
  ArticleStatsResponse,
  ArticlesMgmtResponse,
  BulkAction,
  BulkStatusResponse,
  SelectionItem,
  SourceType,
} from '@/components/admin-articles/types';
import styles from './articles.module.css';

const EMPTY_STAT: ArticleStat = { views: 0, clicks: 0, likes: 0, dislikes: 0 };

function statKey(a: Pick<AdminArticle, 'id' | 'source_type'>): string {
  return (a.source_type === 'article' ? 'a:' : 'ce:') + a.id;
}

function selectionKey(a: Pick<AdminArticle, 'id' | 'source_type'>): string {
  return `${a.id}:${a.source_type}`;
}

function isArticleActive(a: AdminArticle): boolean {
  return a.source_type === 'article'
    ? a.status === 'published'
    : a.status === 'approved' || a.approved === true;
}

function statusLabel(a: AdminArticle): string {
  if (a.source_type === 'article') return a.status || 'published';
  return isArticleActive(a) ? 'approved' : 'unapproved';
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

interface ToastState {
  msg: string;
  type: 'success' | 'error';
}

export default function ArticlesManagementPage() {
  // Category panel
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [catFilter, setCatFilter] = useState('');

  // Article table
  const [articles, setArticles] = useState<AdminArticle[]>([]);
  const [stats, setStats] = useState<Record<string, Partial<ArticleStat>>>({});
  const [listState, setListState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [listError, setListError] = useState('');

  // Selection (set of `${id}:${source_type}` keys)
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Per-row in-flight status toggles, keyed by selection key.
  const [togglingKeys, setTogglingKeys] = useState<Set<string>>(new Set());

  // Toast
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resizable category panel width
  const [panelWidth, setPanelWidth] = useState(280);
  const draggingRef = useRef(false);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const logout = useCallback(() => {
    clearStoredAuth();
    window.location.href = '/signin';
  }, []);

  // ----- Load articles + stats for a category -----------------------------
  const loadArticles = useCallback(async (categoryId: number) => {
    setListState('loading');
    setListError('');
    setSelected(new Set());

    try {
      const data = await api.get<ArticlesMgmtResponse>(
        `/api/admin/articles-mgmt?category_id=${categoryId}&aggregate=true`,
      );
      if (data.success === false) throw new Error(data.error || 'Failed');
      const list = data.articles || [];
      setArticles(list);

      // Fetch engagement stats keyed by "a:<id>" / "ce:<id>".
      let nextStats: Record<string, Partial<ArticleStat>> = {};
      const keys = list.map(statKey);
      if (keys.length > 0) {
        try {
          const statsData = await api.get<ArticleStatsResponse>(
            `/api/admin/article-stats?ids=${encodeURIComponent(keys.join(','))}`,
          );
          if (statsData.success && statsData.stats) nextStats = statsData.stats;
        } catch {
          /* stats unavailable — render zeros */
        }
      }
      setStats(nextStats);
      setListState('idle');
    } catch (e) {
      setArticles([]);
      setStats({});
      setListError(e instanceof Error ? e.message : 'Failed to load articles');
      setListState('error');
    }
  }, []);

  const selectCategory = useCallback(
    (categoryId: number) => {
      setSelectedCategoryId(categoryId);
      void loadArticles(categoryId);
    },
    [loadArticles],
  );

  const reload = useCallback(() => {
    if (selectedCategoryId != null) void loadArticles(selectedCategoryId);
  }, [selectedCategoryId, loadArticles]);

  // ----- Selection --------------------------------------------------------
  const allKeys = useMemo(() => articles.map(selectionKey), [articles]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  const toggleSelectAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(allKeys) : new Set());
    },
    [allKeys],
  );

  const toggleRow = useCallback((key: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  // ----- Bulk status ------------------------------------------------------
  const bulkAction = useCallback(
    async (action: BulkAction) => {
      const items: SelectionItem[] = Array.from(selected).map((key) => {
        const [id, source_type] = key.split(':');
        return { id: parseInt(id, 10), source_type: source_type as SourceType };
      });
      if (items.length === 0) return;

      try {
        const data = await api.patch<BulkStatusResponse>('/api/admin/articles-mgmt/bulk-status', {
          items,
          action,
        });
        if (data.success) {
          showToast(
            `${action === 'activate' ? 'Activated' : 'Deactivated'} ${items.length} article(s)`,
            'success',
          );
          reload();
        } else {
          showToast(`Error: ${data.error || 'Unknown error'}`, 'error');
        }
      } catch {
        showToast('Network error', 'error');
      }
    },
    [selected, showToast, reload],
  );

  // ----- Individual status toggle ----------------------------------------
  const toggleStatus = useCallback(
    async (a: AdminArticle, currentlyActive: boolean) => {
      const key = selectionKey(a);
      const action: BulkAction = currentlyActive ? 'deactivate' : 'activate';
      setTogglingKeys((prev) => new Set(prev).add(key));
      try {
        const data = await api.patch<BulkStatusResponse>(
          `/api/admin/articles-mgmt/${a.source_type}/${a.id}/status`,
          { action },
        );
        if (data.success) {
          showToast(action === 'activate' ? 'Activated' : 'Deactivated', 'success');
          reload();
        } else {
          showToast(`Error: ${data.error || 'Failed'}`, 'error');
        }
      } catch {
        showToast('Network error', 'error');
      } finally {
        setTogglingKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [showToast, reload],
  );

  // ----- Resize handle ----------------------------------------------------
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      setPanelWidth(Math.max(200, Math.min(500, e.clientX)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const startResize = useCallback((e: React.MouseEvent) => {
    draggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  }, []);

  const selectedCount = selected.size;
  const hasArticles = articles.length > 0;

  return (
    <div className={styles.page}>
      {/* HEADER */}
      <header className={styles.adminHeader}>
        <h1>ARTICLES MANAGEMENT</h1>
        <div className={styles.headerActions}>
          {/* Original linked to the static /admin/dashboard.html; the App Router
              dashboard route is /admin. */}
          <Link href="/admin">Dashboard</Link>
          <button onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className={styles.dashboardContainer}>
        {/* CATEGORY PANEL */}
        <div className={styles.categoryPanel} style={{ width: panelWidth }}>
          <div className={styles.categoryPanelHeader}>Categories</div>
          <div className={styles.categorySearch}>
            <input
              type="text"
              placeholder="Search categories..."
              value={catFilter}
              onChange={(e) => setCatFilter(e.target.value)}
            />
          </div>
          <div className={styles.categoryList}>
            <CategoryTree
              selectedId={selectedCategoryId}
              filter={catFilter}
              onSelect={selectCategory}
            />
          </div>
        </div>

        {/* RESIZE HANDLE */}
        <div className={styles.resizeHandle} onMouseDown={startResize} />

        {/* ARTICLE PANEL */}
        <div className={styles.articlePanel}>
          <div className={styles.bulkToolbar}>
            <label>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleSelectAll(e.target.checked)}
              />{' '}
              Select All
            </label>
            <span className={styles.selectedCount}>{selectedCount} selected</span>
            <button
              className={`${styles.bulkBtn} ${styles.activate}`}
              disabled={selectedCount === 0}
              onClick={() => void bulkAction('activate')}
            >
              Activate
            </button>
            <button
              className={`${styles.bulkBtn} ${styles.deactivate}`}
              disabled={selectedCount === 0}
              onClick={() => void bulkAction('deactivate')}
            >
              Deactivate
            </button>
            <div className={styles.toolbarSpacer} />
            <span className={styles.articleCount}>
              {hasArticles ? `${articles.length} article${articles.length !== 1 ? 's' : ''}` : ''}
            </span>
          </div>

          <div className={styles.tableContainer}>
            {listState === 'loading' ? (
              <div className={styles.loading}>
                <div className={styles.spinner} />
                <br />
                Loading articles...
              </div>
            ) : listState === 'error' ? (
              <div className={styles.emptyState}>
                <span className={styles.emptyError}>Error: {listError}</span>
              </div>
            ) : selectedCategoryId == null ? (
              <div className={styles.emptyState}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 12h6m-3-3v6m-7 4h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <span>Select a category to view articles</span>
              </div>
            ) : !hasArticles ? (
              <div className={styles.emptyState}>
                <span>No articles in this category</span>
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.checkboxCol}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(e) => toggleSelectAll(e.target.checked)}
                      />
                    </th>
                    <th>Title</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Published</th>
                    <th className={styles.statCol}>Likes</th>
                    <th className={styles.statCol}>Dislikes</th>
                    <th className={styles.statCol}>Views</th>
                    <th className={styles.statCol}>Clicks</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((a) => {
                    const key = selectionKey(a);
                    const stat = { ...EMPTY_STAT, ...(stats[statKey(a)] || {}) };
                    const active = isArticleActive(a);
                    const isToggling = togglingKeys.has(key);
                    const isArticle = a.source_type === 'article';
                    return (
                      <tr key={key}>
                        <td>
                          <input
                            type="checkbox"
                            value={key}
                            checked={selected.has(key)}
                            onChange={(e) => toggleRow(key, e.target.checked)}
                          />
                        </td>
                        <td className={styles.titleCol} title={a.title || ''}>
                          {a.title || 'Untitled'}
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              isArticle ? styles.badgeArticle : styles.badgeCurrentEvent
                            }`}
                          >
                            {isArticle ? 'Article' : 'Current Event'}
                          </span>
                        </td>
                        <td>
                          <span
                            className={`${styles.badge} ${
                              active ? styles.badgePublished : styles.badgeUnpublished
                            }`}
                          >
                            {capitalize(statusLabel(a))}
                          </span>
                        </td>
                        <td>{formatDate(a.created_at)}</td>
                        <td>{formatDate(a.updated_at || a.pub_date)}</td>
                        <td className={styles.statCell}>{stat.likes}</td>
                        <td className={styles.statCell}>{stat.dislikes}</td>
                        <td className={styles.statCell}>{stat.views}</td>
                        <td className={styles.statCell}>{stat.clicks}</td>
                        <td>
                          <div className={styles.rowActions}>
                            <button
                              className={styles.actionBtn}
                              disabled={isToggling}
                              onClick={() => void toggleStatus(a, active)}
                            >
                              {isToggling ? '...' : active ? 'Deactivate' : 'Activate'}
                            </button>
                            <Link
                              className={`${styles.actionBtn} ${styles.edit}`}
                              href={`/admin/article/${a.id}?type=${a.source_type}`}
                            >
                              Edit
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* TOAST */}
      {toast ? (
        <div className={`${styles.toast} ${styles[toast.type]} ${styles.show}`}>{toast.msg}</div>
      ) : null}
    </div>
  );
}
