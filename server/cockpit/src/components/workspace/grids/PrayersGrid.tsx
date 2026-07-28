/**
 * PrayersGrid.tsx — Prayer content grid (Phase 4A)
 *
 * Columns: ☐ | Title | Occasion | Scripture Refs | Status | Updated
 */

import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { useContentList, useContentSearch } from '../../../hooks/useContent'
import { Badge } from '../../ui/Badge'
import { Checkbox } from '../../ui/Checkbox'
import type { ContentObject } from '../../../types/content-objects'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  draft:      'secondary',
  review:     'warning',
  approved:   'default',
  published:  'success',
  archived:   'destructive',
}

interface PrayersGridProps {
  onRowSelect: (id: string) => void
}

export function PrayersGrid({ onRowSelect }: PrayersGridProps) {
  const selectedNodeId     = useCockpitStore(s => s.selectedNodeId)
  const filters            = useCockpitStore(s => s.filters)
  const selectedObjectIds  = useCockpitStore(s => s.selectedObjectIds)
  const toggleObjectSelection = useCockpitStore(s => s.toggleObjectSelection)

  const searchMode = !!selectedNodeId

  const { data: listData,   isLoading: listLoading   } = useContentList({ type: 'prayer', limit: filters.limit, offset: filters.offset })
  const { data: searchData, isLoading: searchLoading } = useContentSearch(
    searchMode ? { type: 'prayer', taxonomy_node_id: selectedNodeId!, limit: filters.limit, offset: filters.offset } : {}
  )

  const data    = searchMode ? searchData : listData
  const loading = searchMode ? searchLoading : listLoading
  const items: ContentObject[] = (data?.items ?? []) as ContentObject[]

  if (loading) return <p className="text-xs text-muted-foreground p-4">Loading…</p>
  if (items.length === 0) return <p className="text-xs text-muted-foreground p-4">No prayers found.</p>

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-background border-b">
        <tr>
          <th className="w-8 px-2 py-2 text-left" />
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Title</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Occasion</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Refs</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const ext = (item.extension_data ?? {}) as Record<string, unknown>
          const occasion = (ext.occasion_type as string | undefined) ?? '—'
          const refs = Array.isArray(ext.scripture_refs) ? ext.scripture_refs.length : 0

          return (
            <tr
              key={item.id}
              className="border-b hover:bg-muted/30 cursor-pointer"
              onClick={() => onRowSelect(item.id)}
            >
              <td className="w-8 px-2 py-2" onClick={e => e.stopPropagation()}>
                <Checkbox
                  checked={selectedObjectIds.has(item.id)}
                  onCheckedChange={() => toggleObjectSelection(item.id)}
                  aria-label={`Select ${item.title}`}
                />
              </td>
              <td className="px-3 py-2 font-medium max-w-[200px]">
                <span className="truncate block">{item.title}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell capitalize">{occasion}</td>
              <td className="px-3 py-2 hidden md:table-cell">
                {refs > 0 ? (
                  <Badge variant="secondary" className="text-xs px-1.5 py-0">{refs}</Badge>
                ) : '—'}
              </td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_VARIANT[item.status] ?? 'secondary'} className="text-xs capitalize">
                  {item.status}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground hidden md:table-cell whitespace-nowrap">
                {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
