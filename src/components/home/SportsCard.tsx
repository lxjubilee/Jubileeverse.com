'use client';

/**
 * Compact in-feed Sports widget. Tries the live `/api/sports` feed and shows a
 * couple of recent results; falls back to a small static teaser if the feed is
 * unavailable or its shape is unrecognized. Clicking opens the full /sports page.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import styles from '@/app/(site)/home.module.css';

interface Result {
  label: string;
  detail: string;
}

const FALLBACK: Result[] = [
  { label: 'Chiefs 27 – 20 Ravens', detail: 'NFL · Final' },
  { label: 'Celtics 106 – 99 Mavericks', detail: 'NBA · Final' },
  { label: 'Dodgers 5 – 3 Padres', detail: 'MLB · Final' },
];

interface SportsMatch {
  home_team?: string;
  away_team?: string;
  home_score?: number | string;
  away_score?: number | string;
  league?: string;
  status?: string;
}

/** Best-effort extraction of a few completed results from the /api/sports shape. */
function extractResults(payload: unknown): Result[] {
  try {
    const data = (payload as { data?: Record<string, unknown> }).data;
    if (!data) return [];
    const region = (data.US || data.DEFAULT || Object.values(data)[0]) as
      | Record<string, unknown>
      | undefined;
    if (!region) return [];
    const leagues = Object.values(region).filter(Array.isArray) as SportsMatch[][];
    const matches = leagues.flat().filter((m) => m && m.home_team && m.away_team);
    return matches.slice(0, 3).map((m) => ({
      label: `${m.home_team} ${m.home_score ?? ''} – ${m.away_score ?? ''} ${m.away_team}`.trim(),
      detail: [m.league, m.status].filter(Boolean).join(' · ') || 'Result',
    }));
  } catch {
    return [];
  }
}

export default function SportsCard() {
  const [results, setResults] = useState<Result[]>(FALLBACK);
  const didLoad = useRef(false);

  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    let cancelled = false;
    (async () => {
      try {
        const payload = await api.get('/api/sports', { auth: false });
        const extracted = extractResults(payload);
        if (!cancelled && extracted.length > 0) setResults(extracted);
      } catch {
        /* keep the static fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Link className={styles.widgetCard} href="/sports">
      <div className={styles.widgetHead}>
        <span className={styles.widgetKicker}>Sports</span>
        <span className={styles.widgetArrow}>→</span>
      </div>
      <div className={styles.widgetBody}>
        {results.map((r, i) => (
          <div key={i} className={styles.widgetRow}>
            <span className={styles.widgetRowName}>{r.label}</span>
          </div>
        ))}
        <div className={styles.widgetFoot}>Tap for scores &amp; standings</div>
      </div>
    </Link>
  );
}
