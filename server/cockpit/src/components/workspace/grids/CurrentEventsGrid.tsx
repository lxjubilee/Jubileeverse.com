/**
 * CurrentEventsGrid.tsx — Displays current_events articles for a date taxonomy node.
 *
 * Used when the selected taxonomy node's materialized_path starts with /current-events.
 * Calls GET /api/taxonomy/topics/:slug/content?node_id=:id which returns rows from
 * the current_events table filtered by the date encoded in the node's path.
 */

import * as React from 'react'
import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { useTaxonomyNodeContent } from '../../../hooks/useTaxonomy'
import { Newspaper } from 'lucide-react'

interface CurrentEventsItem {
  id: number
  title?: string
  excerpt?: string
  image_url?: string
  cached_image_path?: string
  source_name?: string
  source_url?: string
  pub_date?: string
  topic?: string
  object_table: string
}

const PAGE_SIZE = 50

function formatDate(iso: string | undefined) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return iso }
}

export function CurrentEventsGrid() {
  const selectedNodeId   = useCockpitStore(s => s.selectedNodeId)
  const selectedNodeSlug = useCockpitStore(s => s.selectedNodeSlug)
  const selectedNodePath = useCockpitStore(s => s.selectedNodePath)

  const [offset, setOffset] = React.useState(0)

  // Reset pagination when node changes
  React.useEffect(() => { setOffset(0) }, [selectedNodeId])

  const { data, isLoading } = useTaxonomyNodeContent(
    'topics',
    selectedNodeSlug ?? null,
    { limit: PAGE_SIZE, offset, nodeId: selectedNodeId ?? undefined }
  )

  const items  = (data?.items ?? []) as unknown as CurrentEventsItem[]
  const total  = data?.total ?? 0
  const pages  = Math.ceil(total / PAGE_SIZE)
  const page   = Math.floor(offset / PAGE_SIZE)

  // Derive a readable label from the path segments
  // Path format: /current-events[/year[/month-name[/day]]]
  const pathLabel = React.useMemo(() => {
    if (!selectedNodePath) return 'Current Events'
    const segs = selectedNodePath.split('/').filter(Boolean)
    // segs: ['current-events'] | ['current-events','2026'] | ['current-events','2026','february'] | ['current-events','2026','february','18']
    function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
    if (segs.length === 1) return 'All Current Events'
    if (segs.length === 2) return segs[1]
    if (segs.length === 3) return `${capitalize(segs[2])} ${segs[1]}`
    if (segs.length === 4) return `${capitalize(segs[2])} ${parseInt(segs[3])}, ${segs[1]}`
    return 'Current Events'
  }, [selectedNodePath])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b shrink-0">
        <Newspaper size={14} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground">Current Events</span>
        <span className="text-xs font-semibold mx-1">·</span>
        <span className="text-xs font-semibold">{pathLabel}</span>
        {total > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">{total} article{total !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Article list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-xs text-muted-foreground p-4">Loading…</p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="text-xs text-muted-foreground p-4">No articles found for this date.</p>
        )}
        {!isLoading && items.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30 sticky top-0">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Headline</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Source</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Topic</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Date</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 max-w-0">
                    <p className="truncate font-medium">{item.title ?? '—'}</p>
                    {item.excerpt && (
                      <p className="truncate text-muted-foreground mt-0.5 text-[11px]">{item.excerpt}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[7rem]">
                    {item.source_url ? (
                      <a href={item.source_url} target="_blank" rel="noopener noreferrer"
                         className="hover:underline text-primary">{item.source_name ?? '—'}</a>
                    ) : (item.source_name ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground capitalize">
                    {item.topic?.replace(/-/g, ' ') ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                    {formatDate(item.pub_date)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t shrink-0">
          <span className="text-xs text-muted-foreground">
            Page {page + 1} of {pages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={page + 1 >= pages}
              className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
