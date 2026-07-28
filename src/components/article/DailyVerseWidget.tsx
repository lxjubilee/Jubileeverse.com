'use client';

import { useDailyVerse } from '@/hooks/useDailyVerse';
import styles from './widgets.module.css';

/** Daily Bible Verse sidebar card (/api/daily-verse). */
export default function DailyVerseWidget() {
  const verse = useDailyVerse();
  if (!verse) return null;
  return (
    <section className={styles.widget}>
      <div className={styles.widgetTitle}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        Daily Bible Verse
      </div>
      <p className={styles.verseText}>&ldquo;{verse.text}&rdquo;</p>
      <span className={styles.verseRef}>{verse.reference}</span>
    </section>
  );
}
