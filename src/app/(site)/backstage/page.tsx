import type { Metadata } from 'next';
import BackstageCard from '@/components/backstage/BackstageCard';
import { listBackstage } from '@/lib/backstage';

/**
 * Backstage — the whole article library in one grid, newest first, cutting
 * across all five categories. Ported from JubiLujah's /backstage index.
 *
 * Server-rendered from the published bundles: no client JS beyond Next's link
 * prefetch, and every card is a real anchor.
 */

// Rendered per request so a newly published article, or an image the generator
// has just finished, shows on the next reload without a rebuild.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Backstage — JubileeVerse',
  description:
    'The full library of JubileeVerse articles from the Inspire Family, across Covenant, Teshuvah, Shalom, Celebration and Torah.',
};

export default async function BackstagePage() {
  const pieces = await listBackstage();

  return (
    <div className="bs-page">
      <header className="bs-hero">
        <span className="bs-hero-eyebrow">Backstage</span>
        <h1 className="bs-hero-title">The whole library, in one place</h1>
        <p className="bs-hero-blurb">
          Every article published on JubileeVerse, written by the Inspire Family across all five
          channels. Newest first.
        </p>
      </header>

      {pieces.length === 0 ? (
        <div className="bs-empty">No articles are published yet. Please check back soon.</div>
      ) : (
        <section className="bs-section">
          <div className="bs-section-header">
            <h2 className="bs-section-title">All Articles</h2>
            <span className="bs-section-blurb">
              {pieces.length} {pieces.length === 1 ? 'piece' : 'pieces'}
            </span>
          </div>
          <div className="bs-grid">
            {pieces.map((p) => (
              <BackstageCard key={p.slug} piece={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
