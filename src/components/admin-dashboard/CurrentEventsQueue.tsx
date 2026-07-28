'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, resolveImageUrl } from '@/lib/api';
import type {
  ApprovalResponse,
  CurrentEvent,
  CurrentEventsResponse,
  PortalStatus,
} from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * Portal Articles tab — the current-events approval queue.
 *   GET  /api/admin/current-events?status=<status>&limit=200
 *   POST /api/current-events/:id/approve
 *   POST /api/current-events/:id/reject   { reason }
 * Filter buttons (pending / approved / rejected) decide which actions show.
 */

const FILTERS: PortalStatus[] = ['pending', 'approved', 'rejected'];

interface CurrentEventsQueueProps {
  onToast: (msg: string, type: 'success' | 'error') => void;
}

export default function CurrentEventsQueue({ onToast }: CurrentEventsQueueProps) {
  const [status, setStatus] = useState<PortalStatus>('pending');
  const [items, setItems] = useState<CurrentEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());
  const [fadingIds, setFadingIds] = useState<Set<number>>(new Set());

  const load = useCallback(async (s: PortalStatus) => {
    setState('loading');
    setErrorMsg('');
    try {
      const data = await api.get<CurrentEventsResponse>(
        `/api/admin/current-events?status=${s}&limit=200`,
      );
      setItems(data.articles || []);
      setTotal(data.total ?? (data.articles ? data.articles.length : 0));
      setState('ready');
    } catch (e) {
      setItems([]);
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load');
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load(status);
  }, [status, load]);

  const removeRow = useCallback((id: number) => {
    setFadingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setItems((prev) => prev.filter((a) => a.id !== id));
      setTotal((t) => Math.max(0, t - 1));
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 300);
  }, []);

  const withPending = useCallback(
    async (id: number, fn: () => Promise<void>) => {
      setPendingIds((prev) => new Set(prev).add(id));
      try {
        await fn();
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    },
    [],
  );

  const approve = useCallback(
    (id: number) =>
      withPending(id, async () => {
        try {
          const data = await api.post<ApprovalResponse>(`/api/current-events/${id}/approve`);
          if (!data.success) throw new Error(data.error || 'Failed');
          removeRow(id);
        } catch (e) {
          onToast(`Approve failed: ${e instanceof Error ? e.message : 'error'}`, 'error');
        }
      }),
    [withPending, removeRow, onToast],
  );

  const reject = useCallback(
    (id: number) => {
      const reason = window.prompt('Rejection reason (optional):');
      if (reason === null) return; // cancelled
      void withPending(id, async () => {
        try {
          const data = await api.post<ApprovalResponse>(`/api/current-events/${id}/reject`, {
            reason: reason || 'Manually rejected',
          });
          if (!data.success) throw new Error(data.error || 'Failed');
          removeRow(id);
        } catch (e) {
          onToast(`Reject failed: ${e instanceof Error ? e.message : 'error'}`, 'error');
        }
      });
    },
    [withPending, removeRow, onToast],
  );

  return (
    <div className={styles.portalContainer}>
      <div className={styles.portalToolbar}>
        <div className={styles.portalFilterButtons}>
          {FILTERS.map((f) => (
            <button
              key={f}
              className={`${styles.portalFilterBtn} ${status === f ? styles.active : ''}`}
              onClick={() => setStatus(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className={styles.portalCount}>
          {state === 'ready' ? `${total} article${total !== 1 ? 's' : ''}` : ''}
        </span>
      </div>

      <div className={styles.portalList}>
        {state === 'loading' ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
            Loading…
          </div>
        ) : state === 'error' ? (
          <div className={styles.errorText} style={{ textAlign: 'center', padding: 32 }}>
            Error: {errorMsg}
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
            No {status} articles
          </div>
        ) : (
          items.map((art) => {
            const img = resolveImageUrl(art);
            const words = art.word_count || 0;
            const hasImage = !!(art.cached_image_path || art.image_url);
            const busy = pendingIds.has(art.id);
            return (
              <div
                key={art.id}
                className={`${styles.portalRow} ${fadingIds.has(art.id) ? styles.fading : ''}`}
              >
                {img ? (
                  <img className={styles.portalThumb} src={img} alt="" />
                ) : (
                  <div className={styles.portalThumbPlaceholder}>🖼</div>
                )}
                <div className={styles.portalBody}>
                  <div className={styles.portalHeadline} title={art.headline || ''}>
                    {art.headline || '(no headline)'}
                  </div>
                  <div className={styles.portalMeta}>
                    {art.topic ? <span>{art.topic}</span> : null}
                    <span className={words < 400 ? styles.metaWarn : styles.metaOk}>
                      {words}w {words < 400 ? '⚠' : '✓'}
                    </span>
                    <span className={hasImage ? styles.metaOk : styles.metaWarn}>
                      {hasImage ? 'image ✓' : 'no image ⚠'}
                    </span>
                  </div>
                  {art.approval_reason ? (
                    <div className={styles.portalReason}>Reason: {art.approval_reason}</div>
                  ) : null}
                </div>
                <div className={styles.portalActions}>
                  {status !== 'approved' ? (
                    <button
                      className={styles.portalBtnApprove}
                      disabled={busy}
                      onClick={() => void approve(art.id)}
                    >
                      Approve
                    </button>
                  ) : null}
                  {status !== 'rejected' ? (
                    <button
                      className={styles.portalBtnReject}
                      disabled={busy}
                      onClick={() => reject(art.id)}
                    >
                      Reject
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
