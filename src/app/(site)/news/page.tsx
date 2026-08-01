import Link from 'next/link';
import { fetchLatestNews, pstToday } from '@/lib/news';
import styles from './news.module.css';

/**
 * The daily news index.
 *
 * Articles come from the news bundle the pipeline publishes to the CDN, whose
 * day manifests are authoritative — nothing unlisted appears here, and entries
 * the pipeline held back (no image, or sourcing too thin to lead with) are
 * already filtered out by @/lib/news.
 *
 * Resolution stays on the server because the CDN sends no CORS headers.
 */
export const revalidate = 300;

export const metadata = {
  title: 'News — JubileeVerse',
  description: 'World events reported and considered through a faith lens.',
};

function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

export default async function NewsIndexPage() {
  const articles = await fetchLatestNews(7, 60);

  if (!articles.length) {
    // No empty-state copy: an empty section renders as nothing rather than
    // telling the reader that stories are being collected.
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>News</h1>
          <p className={styles.tagline}>World events, considered through a faith lens.</p>
        </header>
      </main>
    );
  }

  // Group by day so the reader can see the shape of each day's coverage.
  const byDay = new Map<string, typeof articles>();
  for (const article of articles) {
    if (!byDay.has(article.date)) byDay.set(article.date, []);
    byDay.get(article.date)!.push(article);
  }
  const today = pstToday();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>News</h1>
        <p className={styles.tagline}>World events, considered through a faith lens.</p>
      </header>

      {[...byDay.entries()].map(([day, items]) => (
        <section key={day} className={styles.day}>
          <h2 className={styles.dayHeading}>
            {day === today ? 'Today' : formatDay(day)}
            <span className={styles.dayCount}>{items.length}</span>
          </h2>

          <div className={styles.grid}>
            {items.map(article => (
              <article key={article.id} className={styles.card}>
                {/* Articles are read at the root, /<slug>. */}
                <Link href={`/${article.slug}`} className={styles.cardLink}>
                  {article.image && (
                    // Straight <img>: these are CDN-hosted and already sized for
                    // the card, so the optimizer would add a hop for nothing.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className={styles.thumb}
                      src={article.image}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div className={styles.cardBody}>
                    {article.topic && <span className={styles.topic}>{article.topic}</span>}
                    <h3 className={styles.cardTitle}>{article.title}</h3>
                    {article.summary && <p className={styles.summary}>{article.summary}</p>}
                    {article.sourceName && (
                      <p className={styles.source}>Reported from {article.sourceName}</p>
                    )}
                  </div>
                </Link>
              </article>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
