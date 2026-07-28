'use client';

/**
 * Loads the five-fold ministry nav links from /api/taxonomy/all?type=topics,
 * mirroring loadTaxonomyNavLinks() in the original index.html (find the
 * `taxonomy` root, take its depth-1 children, keep + order the five-fold set).
 */
import { useEffect, useState } from 'react';

interface RawTaxonomyNode {
  id: number;
  slug: string;
  depth?: number;
  parent_id?: number;
  title?: string;
  name?: string;
}

export interface NavLink {
  id: number;
  slug: string;
  label: string;
}

const FIVE_FOLD_ORDER = [957, 958, 959, 960, 961];

export function useTaxonomyNav(): NavLink[] {
  const [links, setLinks] = useState<NavLink[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch('/api/taxonomy/all?type=topics');
        if (!resp.ok) return;
        const data = await resp.json();
        const nodes: RawTaxonomyNode[] = data.nodes || [];
        const root = nodes.find((n) => n.slug === 'taxonomy' && n.depth === 0);
        if (!root) return;
        const subcategories = nodes
          .filter((n) => n.parent_id === root.id && n.depth === 1)
          .filter((n) => FIVE_FOLD_ORDER.includes(n.id))
          .sort((a, b) => FIVE_FOLD_ORDER.indexOf(a.id) - FIVE_FOLD_ORDER.indexOf(b.id));
        if (cancelled) return;
        setLinks(
          subcategories.map((n) => ({
            id: n.id,
            slug: n.slug,
            label: (n.title || n.name || '').toUpperCase(),
          })),
        );
      } catch {
        /* nav is non-critical — fail quietly */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return links;
}
