/**
 * BreadcrumbBar.tsx — Taxonomy path breadcrumb shown when left panel is collapsed (Phase 4A)
 */

import { ChevronRight, PanelLeftOpen } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useTaxonomyNode } from '../../hooks/useTaxonomy'

export function BreadcrumbBar() {
  const selectedTaxonomyType = useCockpitStore(s => s.selectedTaxonomyType)
  const selectedNodeSlug = useCockpitStore(s => s.selectedNodeSlug)
  const setLeftPanelOpen = useCockpitStore(s => s.setLeftPanelOpen)
  const setEditModeActive = useCockpitStore(s => s.setEditModeActive)

  const { data: node } = useTaxonomyNode(
    selectedTaxonomyType,
    selectedNodeSlug
  )

  const segments = node?.materialized_path
    ? node.materialized_path.split('/').filter(Boolean)
    : []

  function showTree() {
    setLeftPanelOpen(true)
    setEditModeActive(false)
  }

  return (
    <div className="flex items-center gap-1 px-3 h-10 border-b bg-muted/30 text-xs shrink-0">
      <button
        onClick={showTree}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors mr-1"
        title="Show taxonomy tree"
      >
        <PanelLeftOpen size={14} />
        <span className="sr-only">Show Tree</span>
      </button>

      {segments.length === 0 ? (
        <span className="text-muted-foreground italic">No node selected</span>
      ) : (
        segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={12} className="text-muted-foreground" />}
            <span className={i === segments.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'}>
              {seg}
            </span>
          </span>
        ))
      )}
    </div>
  )
}
