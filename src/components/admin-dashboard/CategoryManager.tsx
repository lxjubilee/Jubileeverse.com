'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AdminAlbum, DashCategory } from './types';
import styles from '@/app/(admin)/admin/dashboard.module.css';

/**
 * Category tree panel (left side of the dashboard). Faithfully ports the
 * original dashboard.html JIT (Just-In-Time) lazy-loading tree:
 *   - roots come from GET /api/admin/categories?level=2
 *   - each branch loads its children on first expand
 *     (GET /api/admin/categories?parent_id= + GET /api/admin/albums?category_id=)
 *   - albums are folded into the tree as accent-coloured, leaf "🎵" pseudo-nodes
 *   - double-click a name to rename (PUT) or delete (DELETE)
 * Expanded/selected state persists to localStorage under the original keys.
 */

const EXPANDED_KEY = 'expandedNodes';
const SELECTED_KEY = 'selectedCategoryId';

interface CategoryManagerProps {
  /**
   * Notifies the parent which category was selected (id may be number or
   * album-string). `hasChildren` reflects whether children are already loaded —
   * the page uses it to decide the `aggregate` flag for article loading.
   */
  onSelect: (category: DashCategory, hasChildren: boolean) => void;
  /** Surfaces transient success/error messages to the page toast. */
  onToast: (msg: string, type: 'success' | 'error') => void;
}

function sortByName(cats: DashCategory[]): DashCategory[] {
  return [...cats].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function keyOf(id: number | string): string {
  return String(id);
}

export default function CategoryManager({ onSelect, onToast }: CategoryManagerProps) {
  // Flat store of every loaded category, keyed by string id (mirrors categoriesData).
  const [byId, setById] = useState<Map<string, DashCategory>>(new Map());
  const [rootIds, setRootIds] = useState<string[]>([]);
  const [loadedParents, setLoadedParents] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [totalLabel, setTotalLabel] = useState('Categories');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  // Inline-edit state (which node id is being renamed + the draft value).
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const loadingChildren = useRef<Set<string>>(new Set());
  const didLoad = useRef(false);
  // Always-current view of `byId` for reads inside effects/callbacks that must
  // not re-run when the map changes (e.g. the one-shot auto-restore effect).
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  // Snapshot of persisted state captured on mount, consumed once roots are ready
  // to auto-restore the expanded branches + selected category (see effect below).
  const pendingRestore = useRef<{ expanded: string[]; selected: string | null } | null>(null);
  const didRestore = useRef(false);

  // Persist expanded set to localStorage (original used a JSON array).
  const persistExpanded = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore quota errors */
    }
  }, []);

  const mergeCategories = useCallback((incoming: DashCategory[]) => {
    setById((prev) => {
      const next = new Map(prev);
      for (const cat of incoming) {
        if (cat && cat.id != null) next.set(keyOf(cat.id), cat);
      }
      return next;
    });
  }, []);

  // ----- Load roots (level-2 content categories) -------------------------
  const loadRoots = useCallback(async () => {
    setState('loading');
    try {
      const roots = await api.get<DashCategory[]>('/api/admin/categories?level=2');
      const list = Array.isArray(roots) ? roots : [];
      mergeCategories(list);
      setRootIds(list.map((c) => keyOf(c.id)));
      setLoadedParents((prev) => new Set(prev).add('__root__'));
      setState('ready');

      // Total count (best-effort; falls back to root count).
      try {
        const count = await api.get<{ total?: number }>('/api/admin/categories/count');
        if (count && typeof count.total === 'number') {
          setTotalLabel(`Categories (${count.total.toLocaleString()} total)`);
        } else {
          setTotalLabel(`Categories (${list.length} root)`);
        }
      } catch {
        setTotalLabel(`Categories (${list.length} root)`);
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to load categories');
      setState('error');
    }
  }, [mergeCategories]);

  // Hydrate persisted expanded set, then load roots once.
  useEffect(() => {
    if (didLoad.current) return;
    didLoad.current = true;
    let restoreExpanded: string[] = [];
    let restoreSelected: string | null = null;
    try {
      const rawExp = localStorage.getItem(EXPANDED_KEY);
      if (rawExp) {
        const arr = JSON.parse(rawExp) as (number | string)[];
        restoreExpanded = Array.isArray(arr) ? arr.map(keyOf) : [];
        setExpanded(new Set(restoreExpanded));
      }
      const sel = localStorage.getItem(SELECTED_KEY);
      if (sel) {
        restoreSelected = sel;
        setSelectedId(sel);
      }
    } catch {
      /* ignore malformed persisted state */
    }
    // Hand off to the auto-restore effect, which runs once roots are loaded.
    pendingRestore.current = { expanded: restoreExpanded, selected: restoreSelected };
    void loadRoots();
  }, [loadRoots]);

  // ----- Lazy-load children (categories + albums) for a parent -----------
  const loadChildren = useCallback(
    async (parentId: string): Promise<DashCategory[]> => {
      if (loadedParents.has(parentId)) {
        return [...byId.values()].filter((c) => keyOf(c.parent_id ?? '') === parentId);
      }
      if (loadingChildren.current.has(parentId)) return [];
      loadingChildren.current.add(parentId);
      try {
        const [children, albums] = await Promise.all([
          api.get<DashCategory[]>(`/api/admin/categories?parent_id=${parentId}`),
          api
            .get<AdminAlbum[]>(`/api/admin/albums?category_id=${parentId}`)
            .catch(() => [] as AdminAlbum[]),
        ]);
        const catNodes = Array.isArray(children) ? children : [];
        const albumNodes: DashCategory[] = (Array.isArray(albums) ? albums : []).map((album) => ({
          id: `album-${album.id}`,
          name: album.title,
          slug: album.slug,
          parent_id: Number(parentId) || null,
          level: 99,
          sort_order: album.sort_order,
          is_album: true,
          album_data: album,
        }));
        const all = [...catNodes, ...albumNodes];
        mergeCategories(all);
        setLoadedParents((prev) => new Set(prev).add(parentId));
        return all;
      } catch {
        return [];
      } finally {
        loadingChildren.current.delete(parentId);
      }
    },
    [byId, loadedParents, mergeCategories],
  );

  // ----- Toggle expand (loads children on first expand) ------------------
  const toggleNode = useCallback(
    async (id: string) => {
      if (expanded.has(id)) {
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(id);
          persistExpanded(next);
          return next;
        });
        return;
      }
      // Expand
      setExpanded((prev) => {
        const next = new Set(prev).add(id);
        persistExpanded(next);
        return next;
      });
      if (!loadedParents.has(id)) {
        const children = await loadChildren(id);
        if (children.length === 0) {
          setExpanded((prev) => {
            const next = new Set(prev);
            next.delete(id);
            persistExpanded(next);
            return next;
          });
        }
      }
    },
    [expanded, loadedParents, loadChildren, persistExpanded],
  );

  const selectCategory = useCallback(
    (cat: DashCategory) => {
      const id = keyOf(cat.id);
      setSelectedId(id);
      try {
        localStorage.setItem(SELECTED_KEY, id);
      } catch {
        /* ignore */
      }
      const hasChildren = [...byIdRef.current.values()].some(
        (c) => keyOf(c.parent_id ?? '') === id,
      );
      onSelect(cat, hasChildren);
    },
    [onSelect],
  );

  // ----- Auto-restore persisted expanded branches + selected category ----
  // Keep always-current refs for the callbacks the one-shot restore loop uses,
  // so the effect can depend only on `state` and never abort mid-flight when
  // these callbacks' identities change as the tree fills in.
  const loadChildrenRef = useRef(loadChildren);
  loadChildrenRef.current = loadChildren;
  const selectCategoryRef = useRef(selectCategory);
  selectCategoryRef.current = selectCategory;
  const rootIdsRef = useRef(rootIds);
  rootIdsRef.current = rootIds;
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // The original dashboard.html did this via `autoLoadExpandedNodes()` plus the
  // selected-category restore in renderCategoryTree(). Without it, persisted
  // branches render empty ("Loading...") until re-clicked and the selected
  // category's articles never reload. Runs once, after roots are ready.
  useEffect(() => {
    if (didRestore.current) return;
    if (state !== 'ready') return;
    const snapshot = pendingRestore.current;
    if (!snapshot) return;
    didRestore.current = true;
    pendingRestore.current = null;

    const run = async () => {
      // Build a presence set seeded with the roots we just loaded. We rely on
      // loadChildren's return value (not React state) to learn which nodes exist
      // as we descend, so timing of state updates can't cause us to skip a level.
      const present = new Set<string>(rootIdsRef.current);
      const expandedTargets = new Set(snapshot.expanded);
      const processed = new Set<string>();

      // Iterate level-by-level: each pass loads the children of any expanded,
      // present, not-yet-processed node, then the freshly-loaded children become
      // candidates for the next pass. Album pseudo-nodes are leaves (skip them).
      // The `processed` guard + finite expanded set + capped passes prevent loops.
      const MAX_PASSES = 50;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        if (unmountedRef.current) return;
        const toLoad = [...expandedTargets].filter(
          (id) => present.has(id) && !processed.has(id) && !id.startsWith('album-'),
        );
        if (toLoad.length === 0) break;
        for (const id of toLoad) {
          processed.add(id);
          if (unmountedRef.current) return;
          // loadChildren is idempotent (loadedParents/loadingChildren guards) and
          // resilient (returns [] on 404/network error), so a stale/missing node
          // simply contributes nothing.
          const children = await loadChildrenRef.current(id);
          for (const child of children) {
            if (child && child.id != null) present.add(keyOf(child.id));
          }
        }
      }

      if (unmountedRef.current) return;

      // Restore the selected category: re-run the same selection path a click
      // would, so its articles load. Only if the node actually exists now.
      const selId = snapshot.selected;
      if (selId && present.has(selId)) {
        const cat = byIdRef.current.get(selId);
        if (cat) selectCategoryRef.current(cat);
      }
    };

    void run();
  }, [state]);

  const collapseAll = useCallback(() => {
    setExpanded(() => {
      const next = new Set<string>();
      persistExpanded(next);
      return next;
    });
  }, [persistExpanded]);

  const refresh = useCallback(() => {
    setById(new Map());
    setRootIds([]);
    setLoadedParents(new Set());
    loadingChildren.current.clear();
    void loadRoots();
  }, [loadRoots]);

  // ----- Rename / delete -------------------------------------------------
  const beginEdit = useCallback((cat: DashCategory) => {
    setEditingId(keyOf(cat.id));
    setEditValue(cat.name || '');
  }, []);

  const saveName = useCallback(
    async (id: string) => {
      const name = editValue.trim();
      if (!name) {
        onToast('Category name cannot be empty', 'error');
        return;
      }
      try {
        await api.put(`/api/admin/categories/${id}`, { name });
        setById((prev) => {
          const next = new Map(prev);
          const cur = next.get(id);
          if (cur) next.set(id, { ...cur, name });
          return next;
        });
        setEditingId(null);
        onToast(`Category renamed to "${name}"`, 'success');
      } catch {
        onToast('Failed to update category name', 'error');
      }
    },
    [editValue, onToast],
  );

  const deleteCategory = useCallback(
    async (cat: DashCategory) => {
      const id = keyOf(cat.id);
      const confirmed = window.confirm(
        `Are you sure you want to delete "${cat.name}"?\n\nThis will also delete all subcategories and articles under it.`,
      );
      if (!confirmed) return;
      try {
        await api.delete(`/api/admin/categories/${id}`);
        setById((prev) => {
          const next = new Map(prev);
          next.delete(id);
          for (const [k, v] of next) {
            if (keyOf(v.parent_id ?? '') === id) next.delete(k);
          }
          return next;
        });
        setExpanded((prev) => {
          const next = new Set(prev);
          next.delete(id);
          persistExpanded(next);
          return next;
        });
        setLoadedParents((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setEditingId(null);
        onToast('Category deleted', 'success');
      } catch {
        onToast('Failed to delete category', 'error');
      }
    },
    [onToast, persistExpanded],
  );

  // ----- Rendering helpers ----------------------------------------------
  const childrenOf = useCallback(
    (parentId: string): DashCategory[] =>
      sortByName([...byId.values()].filter((c) => keyOf(c.parent_id ?? '') === parentId)),
    [byId],
  );

  const q = search.trim().toLowerCase();

  // Deep search over LOADED nodes: collect every matching node plus its ancestor
  // chain (so the path stays visible), and force-expand those ancestors. Matches
  // in not-yet-loaded branches can't be found without fetching the whole tree —
  // that's an accepted limitation (search what's loaded).
  const { visibleSet, forceOpen } = useMemo(() => {
    if (!q) return { visibleSet: null as Set<string> | null, forceOpen: new Set<string>() };
    const vis = new Set<string>();
    const open = new Set<string>();
    for (const cat of byId.values()) {
      if (!(cat.name || '').toLowerCase().includes(q)) continue;
      vis.add(keyOf(cat.id));
      let pid = cat.parent_id;
      let guard = 0;
      while (pid != null && guard++ < 20) {
        const pk = keyOf(pid);
        vis.add(pk);
        open.add(pk);
        pid = byId.get(pk)?.parent_id ?? null;
      }
    }
    return { visibleSet: vis, forceOpen: open };
  }, [q, byId]);

  const renderNode = (cat: DashCategory, depth: number): React.ReactNode => {
    const id = keyOf(cat.id);
    const isAlbum = cat.is_album === true;
    const isOpen = expanded.has(id) || forceOpen.has(id);
    const allKids = childrenOf(id);
    // While searching, only render children on the path to a match.
    const kids = visibleSet ? allKids.filter((k) => visibleSet.has(keyOf(k.id))) : allKids;
    const hasLoadedChildren = kids.length > 0;
    const level = cat.level ?? 0;
    const mightHaveChildren = !isAlbum && (loadedParents.has(id) ? hasLoadedChildren : level < 5);
    const isActive = selectedId === id;
    const isEditing = editingId === id;

    let icon = '+';
    if (isAlbum) icon = '🎵';
    else if (!mightHaveChildren) icon = '•';
    else if (isOpen && hasLoadedChildren) icon = '−';
    else if (isOpen && !hasLoadedChildren) icon = '⏳';

    // Highlight matching text when searching.
    const nameNode =
      q && (cat.name || '').toLowerCase().includes(q) ? (
        <span
          className={styles.categoryName}
          dangerouslySetInnerHTML={{
            __html: (cat.name || '').replace(
              new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'),
              '<mark>$1</mark>',
            ),
          }}
        />
      ) : (
        <span className={styles.categoryName}>{cat.name}</span>
      );

    return (
      <li key={id} className={styles.categoryTreeItem}>
        <div
          className={`${styles.categoryNode} ${isActive ? styles.active : ''} ${
            isAlbum ? styles.albumNode : ''
          }`}
          style={{ paddingLeft: 12 + depth * 14 }}
          data-level={level}
          onClick={() => selectCategory(cat)}
        >
          <span
            className={`${styles.treeToggle} ${mightHaveChildren ? styles.hasChildren : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              if (mightHaveChildren) void toggleNode(id);
            }}
          >
            {icon}
          </span>

          {isEditing ? (
            <>
              <input
                className={styles.categoryNameEdit}
                value={editValue}
                autoFocus
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void saveName(id);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
              />
              <span className={styles.editButtons} onClick={(e) => e.stopPropagation()}>
                <button
                  className={`${styles.catEditBtn} ${styles.catEditSave}`}
                  title="Save"
                  onClick={() => void saveName(id)}
                >
                  ✓
                </button>
                <button
                  className={`${styles.catEditBtn} ${styles.catEditCancel}`}
                  title="Cancel"
                  onClick={() => setEditingId(null)}
                >
                  ✕
                </button>
                <button
                  className={`${styles.catEditBtn} ${styles.catEditDelete}`}
                  title="Delete category"
                  onClick={() => void deleteCategory(cat)}
                >
                  🗑
                </button>
              </span>
            </>
          ) : (
            <span
              style={{ flex: 1, minWidth: 0, cursor: 'pointer' }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isAlbum) beginEdit(cat);
              }}
            >
              {nameNode}
            </span>
          )}

          {!isEditing && hasLoadedChildren ? (
            <span className={styles.categoryCount}>({kids.length})</span>
          ) : !isEditing && mightHaveChildren && !loadedParents.has(id) ? (
            <span className={styles.categoryCount} style={{ opacity: 0.5 }}>
              (?)
            </span>
          ) : null}
        </div>

        {isOpen && hasLoadedChildren ? (
          <ul className={styles.categoryChildren}>
            {kids.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : isOpen && !loadedParents.has(id) ? (
          <ul className={styles.categoryChildren}>
            <li style={{ padding: '8px 16px', opacity: 0.6 }}>Loading...</li>
          </ul>
        ) : null}
      </li>
    );
  };

  // When searching, show roots that are themselves a match or an ancestor of one
  // (deep search): visibleSet already contains matches + their ancestor chains.
  const roots = sortByName(rootIds.map((id) => byId.get(id)).filter(Boolean) as DashCategory[]);
  const visibleRoots =
    visibleSet ? roots.filter((r) => visibleSet.has(keyOf(r.id))) : roots;

  return (
    <div className={styles.categoryPanel}>
      <div className={styles.categoryPanelHeader}>
        <h2>
          <span>{totalLabel}</span>
          <span className={styles.treeControls}>
            <button className={styles.btnTreeControl} title="Refresh tree" onClick={refresh}>
              🔄 Refresh
            </button>
            <button className={styles.btnTreeControl} title="Collapse all" onClick={collapseAll}>
              Collapse All
            </button>
          </span>
        </h2>
      </div>

      <div className={styles.categoryList}>
        {state === 'loading' ? (
          <div className={styles.loadingSpinner}>
            <p>Loading categories...</p>
          </div>
        ) : state === 'error' ? (
          <div className={styles.treeError}>Error loading categories: {errorMsg}</div>
        ) : visibleRoots.length === 0 ? (
          <div className={styles.treeError}>No categories found.</div>
        ) : (
          <ul className={styles.categoryTree}>{visibleRoots.map((r) => renderNode(r, 0))}</ul>
        )}
      </div>

      <div className={styles.categorySearchFooter}>
        <input
          className={styles.searchBox}
          type="text"
          placeholder="Search categories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
    </div>
  );
}
