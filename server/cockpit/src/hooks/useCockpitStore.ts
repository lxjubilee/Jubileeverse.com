/**
 * hooks/useCockpitStore.ts — Zustand UI State (Phase 4 + 4A + Sections 10-11)
 *
 * Manages cross-component state for the editorial cockpit:
 *   - Auth user (via session cookie — no localStorage)
 *   - Selected taxonomy type + node
 *   - Content list filters, sort, bulk selection
 *   - Editor state (Phase 4: full-screen editor)
 *   - Workspace state (Phase 4A: inline panel, edit mode, active tab)
 */

import { create } from 'zustand'
import type { TaxonomyType } from '../types/taxonomy'
import type { ContentFilters } from '../lib/api'

interface SessionUser {
  id: number
  email: string
  name: string | null
  role: string
  entitlements?: string[]
  has_cms_access?: boolean
}

interface CockpitStore {
  // ── Auth (cookie-based — no localStorage) ────────────────────────────────
  user: SessionUser | null
  sessionChecked: boolean
  checkSession(): Promise<void>
  clearSession(): void

  // ── Left panel (taxonomy) ─────────────────────────────────────────────────
  selectedTaxonomyType: TaxonomyType
  setSelectedTaxonomyType(type: TaxonomyType): void
  selectedNodeId: number | null
  selectedNodeSlug: string | null
  selectedNodePath: string | null
  setSelectedNode(id: number | null, slug: string | null, path?: string | null): void

  // ── Center panel (content list) ───────────────────────────────────────────
  filters: ContentFilters
  setFilters(filters: Partial<ContentFilters>): void
  sortBy: string
  sortDir: 'asc' | 'desc'
  setSort(by: string, dir: 'asc' | 'desc'): void
  selectedObjectIds: Set<string>
  toggleObjectSelection(id: string): void
  selectAllObjects(ids: string[]): void
  clearSelection(): void

  // ── Phase 4: Full-screen editor ───────────────────────────────────────────
  editingObjectId: string | null
  setEditingObject(id: string | null): void

  // ── Phase 4A: Workspace state ─────────────────────────────────────────────
  selectedObjectId: string | null        // inline editor selection
  setSelectedObjectId(id: string | null): void
  editModeActive: boolean                // right panel open + left panel collapsed
  setEditModeActive(active: boolean): void
  leftPanelOpen: boolean                 // taxonomy panel visible
  setLeftPanelOpen(open: boolean): void
  activeTab: 'content' | 'prayers' | 'music' | 'authors' | 'images'
  setActiveTab(tab: 'content' | 'prayers' | 'music' | 'authors' | 'images'): void
}

export const useCockpitStore = create<CockpitStore>((set) => ({
  // ── Auth ──────────────────────────────────────────────────────────────────
  user: null,
  sessionChecked: false,
  async checkSession() {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1500))
        const res = await fetch('/api/auth/me', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          set({ user: data.user ?? null, sessionChecked: true })
          return
        } else if (res.status === 401) {
          // No session — BackOfficeShell will redirect to login
          set({ user: null, sessionChecked: true })
          return
        }
        // 429/5xx: retry after backoff
      } catch {
        // Network error — only fail out on last attempt
        if (attempt === 3) set({ user: null, sessionChecked: true })
      }
    }
    // All retries exhausted (e.g. persistent 5xx) — surface as unauthenticated
    set({ user: null, sessionChecked: true })
  },
  clearSession() {
    set({ user: null, sessionChecked: false })
  },

  // ── Left panel ────────────────────────────────────────────────────────────
  selectedTaxonomyType: 'topics',
  setSelectedTaxonomyType(type) {
    set({ selectedTaxonomyType: type, selectedNodeId: null, selectedNodeSlug: null, selectedNodePath: null })
  },
  selectedNodeId: null,
  selectedNodeSlug: null,
  selectedNodePath: null,
  setSelectedNode(id, slug, path) {
    set({ selectedNodeId: id, selectedNodeSlug: slug, selectedNodePath: path ?? null })
  },

  // ── Center panel ──────────────────────────────────────────────────────────
  filters: { limit: 50, offset: 0 },
  setFilters(partial) {
    set(s => ({ filters: { ...s.filters, ...partial, offset: 0 } }))
  },
  sortBy: 'updated_at',
  sortDir: 'desc',
  setSort(by, dir) {
    set({ sortBy: by, sortDir: dir })
  },
  selectedObjectIds: new Set<string>(),
  toggleObjectSelection(id) {
    set(s => {
      const next = new Set(s.selectedObjectIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { selectedObjectIds: next }
    })
  },
  selectAllObjects(ids) {
    set({ selectedObjectIds: new Set(ids) })
  },
  clearSelection() {
    set({ selectedObjectIds: new Set<string>() })
  },

  // ── Phase 4: Full-screen editor ───────────────────────────────────────────
  editingObjectId: null,
  setEditingObject(id) {
    set({ editingObjectId: id })
  },

  // ── Phase 4A: Workspace state ─────────────────────────────────────────────
  selectedObjectId: null,
  setSelectedObjectId(id) {
    set({ selectedObjectId: id })
    if (id) {
      // Opening inline editor → collapse left panel
      set({ editModeActive: true, leftPanelOpen: false })
    } else {
      // Closing inline editor → restore left panel
      set({ editModeActive: false, leftPanelOpen: true })
    }
  },
  editModeActive: false,
  setEditModeActive(active) {
    set({ editModeActive: active })
  },
  leftPanelOpen: true,
  setLeftPanelOpen(open) {
    set({ leftPanelOpen: open })
  },
  activeTab: 'content',
  setActiveTab(tab) {
    set({ activeTab: tab })
  },
}))
