/**
 * ContentList.tsx — Sortable content object table with pagination (Phase 4)
 */

import { ScrollArea }       from '../ui/ScrollArea'
import { Button }           from '../ui/Button'
import { Checkbox }         from '../ui/Checkbox'
import { BulkActionBar }    from './BulkActionBar'
import { ContentRow }       from './ContentRow'
import { useContentList, useContentSearch } from '../../hooks/useContent'
import { useCockpitStore }  from '../../hooks/useCockpitStore'
import { useNavigate }      from 'react-router-dom'

const PAGE_SIZE = 50

type Column = { key: string; label: string; sortable?: boolean }
const COLUMNS: Column[] = [
  { key: 'checkbox', label: '' },
  { key: 'object_type', label: 'Type' },
  { key: 'title', label: 'Title', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'language', label: 'Lang' },
  { key: 'updated_at', label: 'Updated', sortable: true },
]

export function ContentList() {
  const navigate = useNavigate()
  const filters = useCockpitStore(s => s.filters)
  const sortBy = useCockpitStore(s => s.sortBy)
  const sortDir = useCockpitStore(s => s.sortDir)
  const setSort = useCockpitStore(s => s.setSort)
  const setFilters = useCockpitStore(s => s.setFilters)
  const selectedObjectIds = useCockpitStore(s => s.selectedObjectIds)
  const selectAllObjects = useCockpitStore(s => s.selectAllObjects)
  const clearSelection = useCockpitStore(s => s.clearSelection)
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)

  const page = Math.floor((filters.offset ?? 0) / PAGE_SIZE)

  // If a taxonomy node is selected, use the search endpoint (supports taxonomy filter)
  const useSearch  = !!selectedNodeId || !!filters.q
  const searchResult = useContentSearch(
    useSearch
      ? { q: filters.q, type: filters.type, status: filters.status, language: filters.language,
          taxonomy_node_id: selectedNodeId ?? undefined, limit: PAGE_SIZE, offset: filters.offset ?? 0 }
      : {}
  )
  const listResult = useContentList(
    useSearch ? {} : { ...filters, limit: PAGE_SIZE, offset: filters.offset ?? 0, sortBy, sortDir }
  )

  const result = useSearch ? searchResult : listResult
  const items  = result.data?.items ?? []
  const total  = result.data?.total ?? 0
  const pages  = Math.ceil(total / PAGE_SIZE)

  function handleSort(col: string) {
    if (!COLUMNS.find(c => c.key === col)?.sortable) return
    setSort(col, sortBy === col && sortDir === 'asc' ? 'desc' : 'asc')
  }

  function handleSelectAll() {
    if (selectedObjectIds.size === items.length) {
      clearSelection()
    } else {
      selectAllObjects(items.map(i => i.id))
    }
  }

  function prevPage() {
    setFilters({ offset: Math.max(0, (filters.offset ?? 0) - PAGE_SIZE) })
  }
  function nextPage() {
    if (page + 1 < pages) setFilters({ offset: (filters.offset ?? 0) + PAGE_SIZE })
  }

  return (
    <div className="flex h-full flex-col">
      <BulkActionBar />

      <ScrollArea className="flex-1">
        {result.isLoading && (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">Loading…</p>
        )}
        {result.isError && (
          <p className="px-4 py-6 text-sm text-destructive text-center">Failed to load content</p>
        )}
        {!result.isLoading && items.length === 0 && (
          <p className="px-4 py-6 text-sm text-muted-foreground text-center">No content found</p>
        )}
        {items.length > 0 && (
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 sticky top-0">
              <tr>
                <th className="w-8 px-2 py-2">
                  <Checkbox
                    checked={selectedObjectIds.size > 0 && selectedObjectIds.size === items.length
                      ? true
                      : selectedObjectIds.size > 0 ? 'indeterminate' : false}
                    onCheckedChange={handleSelectAll}
                  />
                </th>
                {COLUMNS.slice(1).map(col => (
                  <th
                    key={col.key}
                    className={[
                      'px-2 py-2 text-left text-xs font-medium text-muted-foreground',
                      col.sortable ? 'cursor-pointer hover:text-foreground select-none' : '',
                    ].join(' ')}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    {col.label}
                    {sortBy === col.key && (
                      <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <ContentRow
                  key={item.id}
                  item={item}
                  onEdit={id => navigate(`/editor/${id}`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </ScrollArea>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>{total} total</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={prevPage} disabled={page === 0}>
              ← Prev
            </Button>
            <span>Page {page + 1} of {pages}</span>
            <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={nextPage} disabled={page + 1 >= pages}>
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
