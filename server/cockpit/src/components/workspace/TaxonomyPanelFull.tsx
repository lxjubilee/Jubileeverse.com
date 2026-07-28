/**
 * TaxonomyPanelFull.tsx — Enhanced left taxonomy panel (Phase 4A)
 *
 * Features:
 * - Taxonomy type dropdown at top
 * - Scrollable tree in the middle (delegates selection to TaxonomyTree / useCockpitStore)
 * - Search input pinned to bottom with 200ms debounce
 * - Enter key jumps to first matching node
 */

import * as React from 'react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useTaxonomyType } from '../../hooks/useTaxonomy'
import { TaxonomyTree } from '../taxonomy/TaxonomyTree'
import { ScrollArea } from '../ui/ScrollArea'
import { Select } from '../ui/Select'
import { Search } from 'lucide-react'
import { TAXONOMY_TYPES, TAXONOMY_TYPE_LABELS } from '../../types/taxonomy'
import type { TaxonomyType, TaxonomyNode } from '../../types/taxonomy'
import type { TaxonomyNode as ApiTaxonomyNode } from '../../lib/api'

const TYPE_OPTIONS = TAXONOMY_TYPES.map(t => ({ value: t, label: TAXONOMY_TYPE_LABELS[t] }))

export function TaxonomyPanelFull() {
  const selectedTaxonomyType = useCockpitStore(s => s.selectedTaxonomyType)
  const setSelectedTaxonomyType = useCockpitStore(s => s.setSelectedTaxonomyType)
  const setSelectedNode = useCockpitStore(s => s.setSelectedNode)

  const { data: taxonomyData, isLoading } = useTaxonomyType(selectedTaxonomyType)
  const nodes: TaxonomyNode[] = taxonomyData?.nodes ?? []

  const [searchRaw, setSearchRaw] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setSearchRaw(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearchQuery(val), 200)
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !searchQuery.trim()) return
    function findNode(list: TaxonomyNode[]): TaxonomyNode | null {
      for (const n of list) {
        if ((n.title ?? n.name).toLowerCase().includes(searchQuery.toLowerCase())) return n
        const detail = n as TaxonomyNode & { children?: TaxonomyNode[] }
        if (detail.children) {
          const found = findNode(detail.children)
          if (found) return found
        }
      }
      return null
    }
    const match = findNode(nodes)
    if (match) {
      setSelectedNode(match.id, match.slug)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Taxonomy type selector */}
      <div className="p-2 border-b">
        <Select
          value={selectedTaxonomyType}
          onValueChange={(v) => setSelectedTaxonomyType(v as TaxonomyType)}
          options={TYPE_OPTIONS}
          className="h-8 text-xs"
        />
      </div>

      {/* Scrollable tree */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {isLoading && (
            <p className="text-xs text-muted-foreground px-2 py-1">Loading…</p>
          )}
          {!isLoading && nodes.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-1">No nodes found.</p>
          )}
          <TaxonomyTree
            nodes={nodes as unknown as ApiTaxonomyNode[]}
            taxonomyType={selectedTaxonomyType}
            searchQuery={searchQuery}
          />
        </div>
      </ScrollArea>

      {/* Search input pinned to bottom */}
      <div className="border-t p-2">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
          />
          <input
            type="text"
            placeholder="Search nodes… (Enter to jump)"
            value={searchRaw}
            onChange={handleSearchChange}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded border bg-background pl-6 pr-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
    </div>
  )
}
