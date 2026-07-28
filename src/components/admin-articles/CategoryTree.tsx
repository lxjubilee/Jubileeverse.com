'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminCategory, CategoriesResponse } from './types';
import styles from '../../app/(admin)/admin/articles/articles.module.css';

/** Root taxonomy nodes shown at the top of the tree (from the original site). */
const ROOT_IDS = [64166, 64148];
const EXPANDED_STORAGE_KEY = 'jvAdminExpanded';

interface CategoryTreeProps {
  /** Currently selected category id (null = none). */
  selectedId: number | null;
  /** Lowercased search query used to filter root-level branches by name. */
  filter: string;
  onSelect: (categoryId: number) => void;
}

function sortByName(cats: AdminCategory[]): AdminCategory[] {
  return [...cats].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

async function fetchChildren(parentId: number): Promise<AdminCategory[]> {
  const data = await api.get<CategoriesResponse>(`/api/admin/categories?parent_id=${parentId}`);
  const cats = data.success && data.categories ? data.categories : [];
  return sortByName(cats);
}

/** A single expandable category node and its lazily-loaded children. */
function CategoryNode({
  category,
  depth,
  selectedId,
  expanded,
  onToggleExpand,
  onSelect,
}: {
  category: AdminCategory;
  depth: number;
  selectedId: number | null;
  expanded: Record<number, boolean>;
  onToggleExpand: (id: number) => void;
  onSelect: (id: number) => void;
}) {
  const isOpen = !!expanded[category.id];
  const [children, setChildren] = useState<AdminCategory[] | null>(null);
  const [childState, setChildState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (!isOpen || children !== null || childState === 'loading') return;
    let cancelled = false;
    setChildState('loading');
    (async () => {
      try {
        const cats = await fetchChildren(category.id);
        if (cancelled) return;
        setChildren(cats);
        setChildState('idle');
      } catch {
        if (cancelled) return;
        setChildState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, children, childState, category.id]);

  const isActive = selectedId === category.id;

  return (
    <div data-name={(category.name || '').toLowerCase()}>
      <div
        className={`${styles.catNode} ${isActive ? styles.active : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => onSelect(category.id)}
      >
        <span
          className={styles.toggle}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(category.id);
          }}
        >
          {isOpen ? '▾' : '▸'}
        </span>
        <span className={styles.catLabel}>{category.name}</span>
      </div>

      {isOpen ? (
        <div className={styles.catChildren}>
          {childState === 'loading' ? (
            <div className={styles.catChildLoading}>Loading...</div>
          ) : childState === 'error' ? (
            <div className={styles.catChildError}>Error loading</div>
          ) : children && children.length === 0 ? (
            <div className={styles.catChildEmpty}>No subcategories</div>
          ) : (
            (children || []).map((child) => (
              <CategoryNode
                key={child.id}
                category={child}
                depth={depth + 1}
                selectedId={selectedId}
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function CategoryTree({ selectedId, filter, onSelect }: CategoryTreeProps) {
  const [roots, setRoots] = useState<AdminCategory[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const didLoad = useRef(false);

  // Hydrate expanded state from localStorage (matches the original key).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (raw) setExpanded(JSON.parse(raw) as Record<number, boolean>);
    } catch {
      /* ignore malformed persisted state */
    }
  }, []);

  const toggleExpand = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = { ...prev };
      if (next[id]) delete next[id];
      else next[id] = true;
      try {
        localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  }, []);

  // Load the configured root categories once.
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    (async () => {
      try {
        const groups = await Promise.all(ROOT_IDS.map((id) => fetchChildren(id)));
        setRoots(sortByName(groups.flat()));
        setState('ready');
      } catch {
        setState('error');
      }
    })();
  }, []);

  if (state === 'loading') {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner} />
        <br />
        Loading...
      </div>
    );
  }

  if (state === 'error') {
    return <div className={`${styles.loading} ${styles.loadingError}`}>Failed to load categories</div>;
  }

  const q = filter.trim().toLowerCase();
  const visibleRoots = (roots || []).filter(
    (cat) => !q || (cat.name || '').toLowerCase().includes(q),
  );

  return (
    <>
      {visibleRoots.map((cat) => (
        <CategoryNode
          key={cat.id}
          category={cat}
          depth={0}
          selectedId={selectedId}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onSelect={onSelect}
        />
      ))}
    </>
  );
}
