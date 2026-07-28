'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import styles from './reviewerActivity.module.css';

/** One reviewer-activity log entry, as returned by the Express API. */
interface ActivityRow {
  created_at?: string | null;
  reviewer_email?: string | null;
  action?: string | null;
  article_headline?: string | null;
  article_id?: string | number | null;
  summary?: string | null;
  before_title?: string | null;
  after_title?: string | null;
  before_content?: string | null;
  after_content?: string | null;
}

interface ActivityResponse {
  success?: boolean;
  error?: string;
  activities?: ActivityRow[];
}

type Filter = 'all' | 'delete' | 'update_title' | 'update_content';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All Actions' },
  { key: 'delete', label: 'Deleted' },
  { key: 'update_title', label: 'Title Edits' },
  { key: 'update_content', label: 'Content Edits' },
];

const ACTION_LABELS: Record<string, string> = {
  delete: 'Deleted',
  update_title: 'Title Edit',
  update_content: 'Content Edit',
};

function actionLabel(action?: string | null): string {
  if (!action) return '';
  return ACTION_LABELS[action] ?? action;
}

/** Format the SQLite-UTC timestamp into a date + time pair (matches original). */
function formatDate(str?: string | null): { date: string; time: string } | null {
  if (!str) return null;
  try {
    const d = new Date(str.replace(' ', 'T') + 'Z'); // SQLite stores UTC
    if (Number.isNaN(d.getTime())) return { date: str, time: '' };
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    };
  } catch {
    return { date: str, time: '' };
  }
}

export default function ReviewerActivityPage() {
  const { user } = useAuth();

  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openDiffs, setOpenDiffs] = useState<Record<number, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<ActivityResponse>('/api/admin/reviewer-activity');
        if (cancelled) return;
        if (!data.success) throw new Error(data.error || 'Failed');
        setActivities(data.activities || []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load activity');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Stats (total + per-action counts) ──
  const counts = useMemo(() => {
    const c = { total: activities.length, delete: 0, update_title: 0, update_content: 0 };
    for (const a of activities) {
      if (a.action === 'delete') c.delete++;
      else if (a.action === 'update_title') c.update_title++;
      else if (a.action === 'update_content') c.update_content++;
    }
    return c;
  }, [activities]);

  // ── Client-side filtering ──
  const filtered = useMemo(
    () => (filter === 'all' ? activities : activities.filter((a) => a.action === filter)),
    [activities, filter],
  );

  const toggleDiff = (idx: number) =>
    setOpenDiffs((prev) => ({ ...prev, [idx]: !prev[idx] }));

  return (
    <>
      <header className={styles.pageHeader}>
        <div className={styles.pageHeaderLeft}>
          <Link href="/" className={styles.backLink}>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Home
          </Link>
          <h1 className={styles.pageTitle}>
            Reviewer <span>Activity</span>
          </h1>
        </div>
        <span className={styles.headerEmail}>{user?.email || ''}</span>
      </header>

      <main className={styles.pageMain}>
        {/* Stats bar */}
        <div className={styles.statsBar}>
          <div className={styles.statChip}>
            <strong>{counts.total}</strong>
            Total Actions
          </div>
          <div className={styles.statChip}>
            <strong>{counts.delete}</strong>
            Deletions
          </div>
          <div className={styles.statChip}>
            <strong>{counts.update_title}</strong>
            Title Edits
          </div>
          <div className={styles.statChip}>
            <strong>{counts.update_content}</strong>
            Content Edits
          </div>
        </div>

        {/* Filter bar */}
        <div className={styles.filterBar}>
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              className={`${styles.filterBtn} ${filter === key ? styles.active : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Activity table */}
        <div className={styles.activityTableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Reviewer</th>
                <th>Action</th>
                <th>Article</th>
                <th>Summary</th>
                <th>Before / After</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className={styles.loading}>
                    Loading activity log…
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6} className={styles.errorRow}>
                    Error loading activity: {error}
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className={styles.emptyState}>
                      <h3>No activity found</h3>
                      <p>No {filter === 'all' ? '' : filter} records yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row, idx) => {
                  const ts = formatDate(row.created_at);
                  const beforeTitle = row.before_title || '';
                  const afterTitle = row.after_title || '';
                  const beforeContent = row.before_content || '';
                  const afterContent = row.after_content || '';
                  const hasBefore = beforeTitle || beforeContent;
                  const hasAfter = afterTitle || afterContent;
                  const hasDiff = Boolean(hasBefore || hasAfter);
                  const isOpen = Boolean(openDiffs[idx]);

                  return (
                    <tr key={idx}>
                      <td className={styles.ts}>
                        {ts ? (
                          <>
                            {ts.date}
                            {ts.time ? (
                              <>
                                <br />
                                <span className={styles.tsTime}>{ts.time}</span>
                              </>
                            ) : null}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className={styles.reviewerCell}>{row.reviewer_email || ''}</td>
                      <td>
                        <span
                          className={`${styles.actionBadge} ${
                            row.action ? styles[row.action] || '' : ''
                          }`}
                        >
                          {actionLabel(row.action)}
                        </span>
                      </td>
                      <td>
                        <div className={styles.artHeadline}>{row.article_headline || '—'}</div>
                        {row.article_id ? (
                          <div className={styles.artId}>ID #{row.article_id}</div>
                        ) : null}
                      </td>
                      <td className={styles.summaryCell}>{row.summary || ''}</td>
                      <td>
                        {hasDiff ? (
                          <>
                            <button
                              type="button"
                              className={styles.diffToggleBtn}
                              onClick={() => toggleDiff(idx)}
                            >
                              View Changes
                            </button>
                            <div
                              className={`${styles.diffPanel} ${isOpen ? styles.open : ''}`}
                            >
                              <div className={styles.diffColHeader}>
                                <div className={styles.diffBefore}>
                                  {beforeTitle ? (
                                    <>
                                      <div className={styles.diffLabel}>BEFORE — Title</div>
                                      <div className={styles.diffText}>{beforeTitle}</div>
                                    </>
                                  ) : beforeContent ? (
                                    <>
                                      <div className={styles.diffLabel}>BEFORE — Content</div>
                                      <div className={styles.diffText}>{beforeContent}</div>
                                    </>
                                  ) : (
                                    <span className={styles.diffDash}>—</span>
                                  )}
                                </div>
                                <div className={styles.diffAfter}>
                                  {afterTitle ? (
                                    <>
                                      <div className={styles.diffLabel}>AFTER — Title</div>
                                      <div className={styles.diffText}>{afterTitle}</div>
                                    </>
                                  ) : afterContent ? (
                                    <>
                                      <div className={styles.diffLabel}>AFTER — Content</div>
                                      <div className={styles.diffText}>{afterContent}</div>
                                    </>
                                  ) : (
                                    <span className={styles.diffDash}>—</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <span className={styles.dash}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
