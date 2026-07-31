import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import BackstageBackButton from '@/components/backstage/BackstageBackButton';
import BackstageCard from '@/components/backstage/BackstageCard';
import BackstageProse from '@/components/backstage/BackstageProse';
import { getBackstagePiece, relatedBackstage } from '@/lib/backstage';

/**
 * A single article, laid out like JubiLujah's Backstage piece page: a full-bleed
 * hero whose bottom gradient carries the category, headline and byline, then a
 * two-column body with a sticky sidebar, and a "More from Backstage" row.
 *
 * The important part is not the layout, it is where the body comes from. This
 * is a **Server Component**: the markdown is read on the server and rendered
 * into the HTML. There is no fetch after mount, so there is no state in which
 * the page renders its frame and then fails to fill it.
 */

// Rendered per request, so a newly published article or a just-generated image
// appears on the next reload without a rebuild.
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const piece = await getBackstagePiece(slug);
  if (!piece) return { title: 'Backstage — JubileeVerse' };

  return {
    title: `${piece.title} — JubileeVerse`,
    description: piece.summary,
    authors: piece.author ? [{ name: piece.author }] : undefined,
    openGraph: {
      title: piece.title,
      description: piece.summary,
      type: 'article',
      images: piece.image ? [piece.image] : undefined,
    },
  };
}

export default async function BackstagePiecePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const piece = await getBackstagePiece(slug);
  if (!piece) notFound();

  const related = await relatedBackstage(piece.slug, 4);
  const initial = (piece.author || '?').trim().charAt(0).toUpperCase();

  return (
    <article className="bsa-article">
      {/* ---- Hero: image with the headline over a bottom gradient ------------ */}
      <section className="bsa-hero">
        {piece.image ? (
          <img className="bsa-hero-image" src={piece.image} alt="" />
        ) : (
          <div className="bsa-hero-image bsa-hero-fallback">{piece.title}</div>
        )}

        <BackstageBackButton />

        <div className="bsa-hero-overlay">
          <div className="bsa-hero-content">
            <div className="bsa-meta-top">
              <span className="bsa-category">{piece.category}</span>
            </div>
            <h1 className="bsa-hero-title">{piece.title}</h1>
            <div className="bsa-meta-bottom">
              <span className="bsa-meta-item">{piece.author}</span>
              {piece.created ? (
                <>
                  <span className="bsa-meta-dot" aria-hidden="true">
                    &middot;
                  </span>
                  <span>{piece.created}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ---- Body: prose + sticky sidebar ------------------------------------ */}
      <div className="bsa-container">
        <div className="bsa-main">
          <BackstageProse markdown={piece.content} />

          <div className="bsa-byline">
            <div className="bsa-byline-avatar" aria-hidden="true">
              {initial}
            </div>
            <div className="bsa-byline-text">
              <div className="bsa-byline-credit">Written by</div>
              <div className="bsa-byline-name">{piece.author}</div>
              <div className="bsa-byline-role">Inspire Family &middot; {piece.category}</div>
            </div>
          </div>
        </div>

        <aside className="bsa-sidebar">
          {piece.summary ? (
            <div className="bsa-widget">
              <h2 className="bsa-widget-title">In short</h2>
              <p className="bsa-callout-text">{piece.summary}</p>
            </div>
          ) : null}

          <div className="bsa-widget">
            <h2 className="bsa-widget-title">This Article</h2>
            <dl className="bsa-facts">
              <dt>Author</dt>
              <dd>{piece.author}</dd>
              <dt>Channel</dt>
              <dd>{piece.category}</dd>
              {piece.created ? (
                <>
                  <dt>Updated</dt>
                  <dd>{piece.created}</dd>
                </>
              ) : null}
            </dl>
            <Link href={`/${piece.category_slug}`} className="bsa-listen">
              Read more in {piece.category}
            </Link>
          </div>
        </aside>
      </div>

      {/* ---- More from Backstage --------------------------------------------- */}
      {related.length > 0 ? (
        <section className="bsa-more">
          <div className="bsa-more-header">
            <h2 className="bsa-more-title">More from Backstage</h2>
            <Link href="/backstage" className="bsa-more-all">
              View all &rarr;
            </Link>
          </div>
          <div className="bs-grid">
            {related.map((p) => (
              <BackstageCard key={p.slug} piece={p} />
            ))}
          </div>
        </section>
      ) : null}
    </article>
  );
}
