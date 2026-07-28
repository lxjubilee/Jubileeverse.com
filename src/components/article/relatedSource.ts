import type { Story } from '@/lib/types';

interface IndexItem {
  id?: string | number;
  title?: string;
  headline?: string;
  category?: string;
  topic?: string;
  image?: string;
}

/**
 * Builds the related-stories list from what the home/feed pages cached in
 * sessionStorage: the full feed (`jubileeFeedStories`, preferred — carries
 * article bodies) or the lighter search index (`jubileeSearchIndex`). Excludes
 * the current article and sorts same-category first.
 */
export function getRelatedStories(
  currentId: string | number,
  category: string | undefined,
  limit = 8,
): Story[] {
  let pool: Story[] = [];

  try {
    const full = sessionStorage.getItem('jubileeFeedStories');
    if (full) {
      pool = JSON.parse(full) as Story[];
    } else {
      const idx = sessionStorage.getItem('jubileeSearchIndex');
      if (idx) {
        pool = (JSON.parse(idx) as IndexItem[]).map((it) => ({
          id: it.id ?? '',
          headline: it.title || it.headline || '',
          title: it.title || it.headline || '',
          topic: it.category || it.topic || '',
          category: it.category || it.topic || '',
          cached_image_path: it.image || null,
        }));
      }
    }
  } catch {
    pool = [];
  }

  const cat = (category || '').toLowerCase();
  const seen = new Set<string>();
  const deduped = pool.filter((s) => {
    if (s.id == null || String(s.id) === String(currentId)) return false;
    const key = String(s.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return !!(s.headline || s.title);
  });

  deduped.sort((a, b) => {
    const ac = (a.topic || a.category || '').toLowerCase() === cat ? 0 : 1;
    const bc = (b.topic || b.category || '').toLowerCase() === cat ? 0 : 1;
    return ac - bc;
  });

  return deduped.slice(0, limit);
}
