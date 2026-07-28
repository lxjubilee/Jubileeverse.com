'use client';

/**
 * Compact in-feed Markets widget — a teaser that links to the full /finance
 * page (which renders the region-aware live dashboard). Kept lightweight/static
 * so the home feed never blocks on it; clicking opens /finance.
 */
import Link from 'next/link';
import styles from '@/app/(site)/home.module.css';

const INDICES = [
  { name: 'S&P 500', value: '5,431.60', change: '+0.41%', up: true },
  { name: 'Dow Jones', value: '38,712.21', change: '+0.32%', up: true },
  { name: 'Nasdaq', value: '17,021.20', change: '-0.18%', up: false },
];

export default function FinanceCard() {
  return (
    <Link className={styles.widgetCard} href="/finance">
      <div className={styles.widgetHead}>
        <span className={styles.widgetKicker}>Markets</span>
        <span className={styles.widgetArrow}>→</span>
      </div>
      <div className={styles.widgetBody}>
        {INDICES.map((i) => (
          <div key={i.name} className={styles.widgetRow}>
            <span className={styles.widgetRowName}>{i.name}</span>
            <span className={styles.widgetRowValue}>{i.value}</span>
            <span className={i.up ? styles.widgetUp : styles.widgetDown}>{i.change}</span>
          </div>
        ))}
        <div className={styles.widgetFoot}>Tap for market news</div>
      </div>
    </Link>
  );
}
