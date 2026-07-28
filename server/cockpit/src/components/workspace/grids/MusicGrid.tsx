/**
 * MusicGrid.tsx — Music track content grid (Phase 4A)
 *
 * Columns: ☐ | Title | Key | BPM | CCLI | Lyrics | Status | Updated
 */

import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { useContentList, useContentSearch } from '../../../hooks/useContent'
import { Badge } from '../../ui/Badge'
import { Checkbox } from '../../ui/Checkbox'
import { PopoverRoot, PopoverTrigger, PopoverContent } from '../../ui/Popover'
import { Eye, ExternalLink } from 'lucide-react'
import type { ContentObject } from '../../../types/content-objects'

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'success' | 'warning' | 'destructive' | 'outline'> = {
  draft:      'secondary',
  review:     'warning',
  approved:   'default',
  published:  'success',
  archived:   'destructive',
}

interface MusicGridProps {
  onRowSelect: (id: string) => void
}

export function MusicGrid({ onRowSelect }: MusicGridProps) {
  const selectedNodeId     = useCockpitStore(s => s.selectedNodeId)
  const filters            = useCockpitStore(s => s.filters)
  const selectedObjectIds  = useCockpitStore(s => s.selectedObjectIds)
  const toggleObjectSelection = useCockpitStore(s => s.toggleObjectSelection)

  const searchMode = !!selectedNodeId

  const { data: listData,   isLoading: listLoading   } = useContentList({ type: 'music', limit: filters.limit, offset: filters.offset })
  const { data: searchData, isLoading: searchLoading } = useContentSearch(
    searchMode ? { type: 'music', taxonomy_node_id: selectedNodeId!, limit: filters.limit, offset: filters.offset } : {}
  )

  const data    = searchMode ? searchData : listData
  const loading = searchMode ? searchLoading : listLoading
  const items: ContentObject[] = (data?.items ?? []) as ContentObject[]

  if (loading) return <p className="text-xs text-muted-foreground p-4">Loading…</p>
  if (items.length === 0) return <p className="text-xs text-muted-foreground p-4">No music tracks found.</p>

  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-background border-b">
        <tr>
          <th className="w-8 px-2 py-2 text-left" />
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Title</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Key</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">BPM</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">CCLI</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Lyrics</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden lg:table-cell">Updated</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const ext = (item.extension_data ?? {}) as Record<string, unknown>
          const key     = (ext.key  as string  | undefined) ?? '—'
          const bpm     = (ext.bpm  as number  | undefined) ?? '—'
          const ccli    = (ext.ccli as string  | undefined)
          const lyrics  = (ext.lyrics as string | undefined)

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
              <td className="px-3 py-2 font-medium max-w-[180px]">
                <span className="truncate block">{item.title}</span>
              </td>
              <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{key}</td>
              <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{bpm}</td>
              <td className="px-3 py-2 hidden md:table-cell">
                {ccli ? (
                  <a
                    href={`https://us.ccli.com/song/${ccli}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-primary hover:underline"
                    onClick={e => e.stopPropagation()}
                  >
                    {ccli} <ExternalLink size={10} />
                  </a>
                ) : '—'}
              </td>
              <td className="px-3 py-2 hidden md:table-cell" onClick={e => e.stopPropagation()}>
                {lyrics ? (
                  <PopoverRoot>
                    <PopoverTrigger asChild>
                      <button className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                        <Eye size={12} />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-72 p-3 text-xs whitespace-pre-wrap">
                      {lyrics.substring(0, 200)}{lyrics.length > 200 ? '…' : ''}
                    </PopoverContent>
                  </PopoverRoot>
                ) : '—'}
              </td>
              <td className="px-3 py-2">
                <Badge variant={STATUS_VARIANT[item.status] ?? 'secondary'} className="text-xs capitalize">
                  {item.status}
                </Badge>
              </td>
              <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '—'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
