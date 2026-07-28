/**
 * PromptGrid.tsx — 7-column prompt recipe grid for the Prompts workspace center panel
 *
 * Columns: Prompt Name | Target Type (140) | Version (80) | Author (140) |
 *          Variables (100) | Status (120) | Updated (140)
 */

import * as React from 'react'
import { Plus, ChevronUp, ChevronDown } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { useContentList } from '../../hooks/useContent'
import type { ContentObject } from '../../types/content-objects'

interface PromptGridProps {
  selectedNodeId: string | null
  onRowSelect: (id: string) => void
}

const STATUS_VARIANT: Record<string, 'success' | 'secondary' | 'warning' | 'outline'> = {
  published:  'success',
  draft:      'secondary',
  deprecated: 'warning',
  archived:   'outline',
}

export function PromptGrid({ selectedNodeId: _selectedNodeId, onRowSelect }: PromptGridProps) {
  const [sortBy, setSortBy] = React.useState('updated_at')
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('desc')
  const [filterStatus, setFilterStatus] = React.useState('')

  const { data, isLoading } = useContentList({
    type: 'prompt_recipe',
    status: filterStatus || undefined,
    sortBy,
    sortDir,
    limit: 100,
  })
  const items: ContentObject[] = data?.items ?? []

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortBy(col); setSortDir('desc') }
  }

  function SortIcon({ col }: { col: string }) {
    if (sortBy !== col) return null
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <span className="text-sm font-semibold">Prompts</span>
        <button
          onClick={() => onRowSelect('new')}
          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
        >
          <Plus size={12} /> New Prompt
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-4 py-1.5 border-b bg-muted/30 shrink-0">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="h-6 rounded border bg-background px-1 text-xs"
        >
          <option value="">All Statuses</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="deprecated">Deprecated</option>
          <option value="archived">Archived</option>
        </select>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/90 border-b">
            <tr className="text-xs text-muted-foreground">
              <th
                className="text-left px-4 py-2 cursor-pointer"
                onClick={() => handleSort('title')}
              >
                <span className="flex items-center gap-1">
                  Prompt Name <SortIcon col="title" />
                </span>
              </th>
              <th className="text-left px-2 py-2" style={{ width: 140 }}>Target Type</th>
              <th className="text-left px-2 py-2" style={{ width: 80 }}>Version</th>
              <th className="text-left px-2 py-2" style={{ width: 140 }}>Author</th>
              <th className="text-left px-2 py-2" style={{ width: 100 }}>Variables</th>
              <th className="text-left px-2 py-2" style={{ width: 120 }}>Status</th>
              <th
                className="text-left px-2 py-2 cursor-pointer"
                style={{ width: 140 }}
                onClick={() => handleSort('updated_at')}
              >
                <span className="flex items-center gap-1">
                  Updated <SortIcon col="updated_at" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-xs text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No prompts in this category
                  <div className="mt-2">
                    <button
                      onClick={() => onRowSelect('new')}
                      className="rounded border px-3 py-1 text-xs hover:bg-muted"
                    >
                      + Create Prompt
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {items.map(item => (
              <PromptGridRow key={item.id} item={item} onSelect={onRowSelect} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PromptGridRow({
  item,
  onSelect,
}: {
  item: ContentObject
  onSelect: (id: string) => void
}) {
  const ext = (item.extension_data ?? {}) as Record<string, unknown>
  const recipeName = (ext.recipe_name as string) || item.title || '—'
  const targetType = (ext.target_content_type as string) || '—'
  const variables  = Array.isArray(ext.required_variables) ? ext.required_variables.length : 0
  const status     = item.status ?? 'draft'
  const version    = item.version ?? 1
  const updatedAt  = item.updated_at
    ? new Date(item.updated_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—'

  return (
    <tr
      className="border-b hover:bg-muted/30 cursor-pointer"
      onClick={() => onSelect(item.id)}
    >
      <td className="px-4 py-2 font-medium truncate max-w-0 w-full">{recipeName}</td>
      <td className="px-2 py-2">
        <Badge variant="secondary">{targetType}</Badge>
      </td>
      <td className="px-2 py-2 text-xs text-muted-foreground">v{version}</td>
      <td className="px-2 py-2 text-xs text-muted-foreground">—</td>
      <td className="px-2 py-2 text-xs text-muted-foreground">{variables} vars</td>
      <td className="px-2 py-2">
        <Badge variant={STATUS_VARIANT[status] ?? 'secondary'} className="capitalize">
          {status}
        </Badge>
      </td>
      <td className="px-2 py-2 text-xs text-muted-foreground">{updatedAt}</td>
    </tr>
  )
}
