/**
 * ContentGrid.tsx — Sortable article/blog/page/devotional grid (Phase 4A)
 *
 * Columns: ☐ | Title | Status | Updated | Author | Publish Target
 */

import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { useContentList, useContentSearch } from '../../../hooks/useContent'
import { Badge } from '../../ui/Badge'
import { Checkbox } from '../../ui/Checkbox'
import { ChevronUp, ChevronDown } from 'lucide-react'
import type { ContentObject } from '../../../types/content-objects'

const ARTICLE_TYPES = 'article,blog_post,page,news_item,devotional'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  draft:      'secondary',
  review:     'warning',
  approved:   'default',
  scheduled:  'warning',
  published:  'success',
  archived:   'destructive',
}

function truncatePath(path: string | undefined): string {
  if (!path) return '—'
  const segs = path.split('/').filter(Boolean)
  return segs.slice(-2).join(' / ')
}

interface ContentGridProps {
  onRowSelect: (id: string) => void
}

export function ContentGrid({ onRowSelect }: ContentGridProps) {
  const selectedNodeId     = useCockpitStore(s => s.selectedNodeId)
  const filters            = useCockpitStore(s => s.filters)
  const sortBy             = useCockpitStore(s => s.sortBy)
  const sortDir            = useCockpitStore(s => s.sortDir)
  const setSort            = useCockpitStore(s => s.setSort)
  const selectedObjectIds  = useCockpitStore(s => s.selectedObjectIds)
  const toggleObjectSelection = useCockpitStore(s => s.toggleObjectSelection)
  const selectAllObjects   = useCockpitStore(s => s.selectAllObjects)
  const clearSelection     = useCockpitStore(s => s.clearSelection)

  const searchMode = !!(selectedNodeId ?? filters.q)

  const { data: listData, isLoading: listLoading } = useContentList(
    { ...filters, type: ARTICLE_TYPES, sortBy, sortDir }
  )
  const { data: searchData, isLoading: searchLoading } = useContentSearch(
    searchMode
      ? { type: ARTICLE_TYPES, taxonomy_node_id: selectedNodeId ?? undefined, q: filters.q, limit: filters.limit, offset: filters.offset }
      : {}
  )

  const data    = searchMode ? searchData : listData
  const loading = searchMode ? searchLoading : listLoading
  const items: ContentObject[] = (data?.items ?? []) as ContentObject[]
  const allIds = items.map(i => i.id)

  function handleHeaderCheck(checked: boolean | 'indeterminate') {
    if (checked === true) selectAllObjects(allIds)
    else clearSelection()
  }

  function handleSortColumn(col: string) {
    if (sortBy === col) setSort(col, sortDir === 'asc' ? 'desc' : 'asc')
    else setSort(col, 'desc')
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return null
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  const allSelected = allIds.length > 0 && allIds.every(id => selectedObjectIds.has(id))

  if (loading) {
    return <p className="text-xs text-muted-foreground p-4">Loading…</p>
  }
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground p-4">No content found.</p>
  }

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-background border-b">
        <tr>
          <th className="w-8 px-2 py-2 text-left">
            <Checkbox
              checked={allSelected}
              onCheckedChange={handleHeaderCheck}
              aria-label="Select all"
            />
          </th>
          <th
            className="px-3 py-2 text-left font-medium cursor-pointer hover:text-foreground text-muted-foreground select-none"
            onClick={() => handleSortColumn('title')}
          >
            <span className="flex items-center gap-1">Title <SortIcon col="title" /></span>
          </th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
          <th
            className="px-3 py-2 text-left font-medium cursor-pointer hover:text-foreground text-muted-foreground select-none hidden md:table-cell"
            onClick={() => handleSortColumn('updated_at')}
          >
            <span className="flex items-center gap-1">Updated <SortIcon col="updated_at" /></span>
          </th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Author</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden xl:table-cell">Publish Target</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => (
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
            <td className="px-3 py-2 max-w-[220px]">
              <span className="truncate block font-medium">{item.title}</span>
            </td>
            <td className="px-3 py-2">
              <Badge variant={STATUS_VARIANT[item.status] ?? 'secondary'} className="text-xs capitalize">
                {item.status}
              </Badge>
            </td>
            <td className="px-3 py-2 text-muted-foreground hidden md:table-cell whitespace-nowrap">
              {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}
            </td>
            <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">
              {item.created_by ?? '—'}
            </td>
            <td className="px-3 py-2 text-muted-foreground hidden xl:table-cell">
              {truncatePath((item as unknown as { materialized_path?: string }).materialized_path)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
