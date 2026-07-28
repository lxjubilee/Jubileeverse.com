'use client';

import { useRouter } from 'next/navigation';
import { FALLBACK_IMAGE, handleImgError } from '@/lib/api';
import { storeSelectedArticle, trackView } from '@/lib/article';
import type { Story } from '@/lib/types';

/** Item shape from GET /api/local-news -> { ..., stories: [...] }. */
export interface LocalNewsItem {
  title?: string;
  link?: string;
  source?: string;
  pubDate?: string;
  excerpt?: string;
  image_url?: string | null;
  score?: number;
}

interface Props {
  item: LocalNewsItem;
}

/**
 * Stable, URL-safe id derived from the article link, so the shared article
 * detail page (which keys off the route id and a sessionStorage stash) matches
 * the stashed story, and so view tracking is consistent across clicks.
 */
function localArticleId(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return 'local-' + (h >>> 0).toString(36);
}

/**
 * Local-news story in the standard home-feed article-card format
 * (`.content-card`), matching Current Events. Clicking opens the story on our
 * own article detail page (same layout as other news) via the shared
 * stash-and-navigate flow — not the external source. The full body isn't
 * available for aggregated links, so the detail page shows a short intro plus a
 * "Read the original source" link.
 */
export default function LocalNewsCard({ item }: Props) {
  const router = useRouter();
  const source = item.source || 'Local';
  const img = item.image_url || FALLBACK_IMAGE;

  const open = () => {
    const id = localArticleId(item.link || item.title || '');
    const intro = `This local news story${item.source ? ` from **${item.source}**` : ''} is featured on JubileeVerse. Read the complete article at the original source linked below.`;
    const story: Story = {
      id,
      headline: item.title || '',
      title: item.title || '',
      excerpt: item.excerpt || '',
      full_article: intro,
      image_url: item.image_url || FALLBACK_IMAGE,
      source_name: source,
      source_url: item.link || '',
      topic: 'Local News',
      category: 'Local News',
      pub_date: item.pubDate || '',
      isCurrentEvent: false,
    };
    storeSelectedArticle(story);
    trackView(id, 'click', 'article');
    router.push(`/article/${id}`);
  };

  return (
    <article className="content-card" onClick={open}>
      <div className="content-card-image">
        <img src={img} alt={item.title || ''} loading="lazy" onError={handleImgError} />
      </div>
      <div className="content-card-body">
        <span className="content-card-category">{source}</span>
        <h3 className="content-card-title">{item.title}</h3>
        <div className="content-card-meta">
          <span>{source}</span>
        </div>
      </div>
    </article>
  );
}
