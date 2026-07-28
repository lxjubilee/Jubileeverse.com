'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { ArticlesResponse, DashArticle, DashCategory } from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * Content tab — lists articles for the selected category.
 * GET /api/admin/articles?category_id=<id>[&aggregate=true]
 * (aggregate is added for level-1 domains that have children, matching the original).
 * Double-clicking a row opens the editor modal via onOpenArticle.
 */

interface ArticlesPanelProps {
  category: DashCategory | null;
  /** Whether the selected category has loaded children (drives the aggregate flag). */
  categoryHasChildren: boolean;
  onOpenArticle: (id: number) => void;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

export default function ArticlesPanel({
  category,
  categoryHasChildren,
  onOpenArticle,
}: ArticlesPanelProps) {
  const [articles, setArticles] = useState<DashArticle[]>([]);
  const [aggregated, setAggregated] = useState(false);
  const [state, setState] = useState<'empty' | 'loading' | 'ready' | 'error'>('empty');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(
    async (cat: DashCategory) => {
      setState('loading');
      setErrorMsg('');
      try {
        const shouldAggregate = cat.level === 1 && categoryHasChildren;
        const url = `/api/admin/articles?category_id=${cat.id}${
          shouldAggregate ? '&aggregate=true' : ''
        }`;
        const data = await api.get<ArticlesResponse>(url);
        setArticles(data.articles || []);
        setAggregated(!!data.aggregated);
        setState('ready');
      } catch (e) {
        setArticles([]);
        setErrorMsg(e instanceof Error ? e.message : 'Failed to load content');
        setState('error');
      }
    },
    [categoryHasChildren],
  );

  useEffect(() => {
    // Albums are leaf pseudo-nodes; don't attempt to load articles for them.
    if (!category || category.is_album) {
      setState('empty');
      setArticles([]);
      return;
    }
    void load(category);
  }, [category, load]);

  if (!category || category.is_album) {
    return (
      <div className={styles.articleList}>
        <div className={styles.emptyState}>
          <h3>Select a Category</h3>
          <p>Choose a category from the left panel to view content</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.articleList}>
      {state === 'loading' ? (
        <div className={styles.loadingSpinner}>
          <p>Loading articles for: {category.name}</p>
        </div>
      ) : state === 'error' ? (
        <div className={styles.emptyState}>
          <h3 className={styles.errorText}>Error loading content</h3>
          <p>{errorMsg}</p>
        </div>
      ) : articles.length === 0 ? (
        <div className={styles.emptyState}>
          <h3>No Content Found</h3>
          <p>Category: {category.name}</p>
          <p style={{ marginTop: 8, color: 'var(--text-muted)' }}>No content in this category yet.</p>
        </div>
      ) : (
        <>
          <div className={styles.articleListHeader}>
            <h3>{category.name}</h3>
            <p>
              {articles.length} article{articles.length !== 1 ? 's' : ''}
              {aggregated ? ' (including subcategories)' : ''}
            </p>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.articlesTable}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Title</th>
                  <th>Author</th>
                  <th>Content Type</th>
                  <th>Subtype</th>
                  <th>Status</th>
                  <th>Date Created</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr
                    key={a.id}
                    onDoubleClick={() => onOpenArticle(a.id)}
                    title="Double-click to edit"
                  >
                    <td>{a.id}</td>
                    <td>{a.title}</td>
                    <td>{a.author || 'Rico'}</td>
                    <td>{a.content_type || 'Web Article'}</td>
                    <td>{a.subtype || '-'}</td>
                    <td>{a.status || 'Published'}</td>
                    <td>{formatDate(a.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
