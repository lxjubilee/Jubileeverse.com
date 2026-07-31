import Link from 'next/link';
import type { BackstagePiece } from '@/lib/backstage';

/**
 * One card in the Backstage grid. Ported from JubiLujah's BackstageCard.
 *
 * A plain server component wrapping a Link, deliberately: the card carries no
 * click handler and no stashed state, so the whole tile is one real anchor that
 * middle-click, right-click and prefetch all understand. An article whose image
 * has not been rendered yet falls back to its title on a plain panel rather
 * than a broken image.
 */
export default function BackstageCard({ piece }: { piece: BackstagePiece }) {
  return (
    <Link href={`/backstage/${piece.slug}`} className="bs-card">
      <div className="bs-card-image">
        {piece.image ? (
          <img src={piece.image} alt="" loading="lazy" />
        ) : (
          <div className="bs-card-image-fallback">{piece.title}</div>
        )}
      </div>
      <div className="bs-card-body">
        <div className="bs-card-category">{piece.category}</div>
        <h3 className="bs-card-title">{piece.title}</h3>
        <div className="bs-card-meta">
          <span>{piece.author}</span>
          {piece.created ? (
            <>
              <span className="bs-card-dot" aria-hidden="true">
                &middot;
              </span>
              <span className="bs-card-song">{piece.created}</span>
            </>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
