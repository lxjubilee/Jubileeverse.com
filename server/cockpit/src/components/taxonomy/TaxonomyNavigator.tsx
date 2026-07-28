/**
 * TaxonomyNavigator.tsx — Left-panel taxonomy type selector + tree (Phase 4)
 */

import * as React from 'react'
import { Select }       from '../ui/Select'
import { Input }        from '../ui/Input'
import { ScrollArea }   from '../ui/ScrollArea'
import { TaxonomyTree } from './TaxonomyTree'
import { useTaxonomyType } from '../../hooks/useTaxonomy'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { TAXONOMY_TYPES, TAXONOMY_TYPE_LABELS } from '../../types/taxonomy'
import type { TaxonomyType } from '../../types/taxonomy'

const TYPE_OPTIONS = TAXONOMY_TYPES.map(t => ({
  value: t,
  label: TAXONOMY_TYPE_LABELS[t],
}))

export function TaxonomyNavigator() {
  const selectedTaxonomyType = useCockpitStore(s => s.selectedTaxonomyType)
  const setSelectedTaxonomyType = useCockpitStore(s => s.setSelectedTaxonomyType)
  const [search, setSearch] = React.useState('')

  const { data, isLoading, isError } = useTaxonomyType(selectedTaxonomyType as TaxonomyType)

  return (
    <div className="flex h-full flex-col border-r bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-shrink-0">
          Taxonomy
        </span>
        <Select
          className="flex-1 text-xs h-7"
          value={selectedTaxonomyType}
          onValueChange={v => setSelectedTaxonomyType(v as TaxonomyType)}
          options={TYPE_OPTIONS}
          placeholder="Select type…"
        />
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b">
        <Input
          placeholder="Filter nodes…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-7 text-xs"
        />
      </div>

      {/* Tree */}
      <ScrollArea className="flex-1">
        {isLoading && (
          <p className="px-4 py-3 text-xs text-muted-foreground">Loading…</p>
        )}
        {isError && (
          <p className="px-4 py-3 text-xs text-destructive">Failed to load taxonomy</p>
        )}
        {data && (
          <TaxonomyTree
            nodes={data.nodes}
            searchQuery={search}
            taxonomyType={selectedTaxonomyType as TaxonomyType}
          />
        )}
      </ScrollArea>
    </div>
  )
}
