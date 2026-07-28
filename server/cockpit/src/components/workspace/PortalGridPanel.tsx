/**
 * PortalGridPanel.tsx — Center panel: portal composition grid (Part 4 S7)
 */

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { usePortalPages, useRegeneratePortal } from '../../hooks/usePortal'
import type { PortalGridRow } from '../../types/content-objects'

interface PortalGridPanelProps {
  siteId: number | null
  portalDate: string | null
  selectedPortalId: string | null
  onSelectPortal: (id: string) => void
  canManage: boolean
}

const METHOD_LABEL: Record<string, string> = {
  manual: 'Manual',
  auto_on_demand: 'On-demand',
  scheduled: 'Scheduled',
}

const METHOD_CLASS: Record<string, string> = {
  manual: 'bg-muted text-muted-foreground border border-border',
  auto_on_demand: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  scheduled: 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function StatusBadge({ status }: { status: PortalGridRow['status'] }) {
  const classes = status === 'active'
    ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
    : 'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${classes}`}>
      {status}
    </span>
  )
}

function MethodBadge({ method }: { method: PortalGridRow['generation_method'] }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${METHOD_CLASS[method] ?? METHOD_CLASS.manual}`}>
      {METHOD_LABEL[method] ?? method}
    </span>
  )
}

export function PortalGridPanel({
  siteId,
  portalDate,
  selectedPortalId,
  onSelectPortal,
  canManage,
}: PortalGridPanelProps) {
  const { data: rows = [], isLoading, error } = usePortalPages(
    siteId,
    portalDate ?? undefined,
  )
  const generate = useRegeneratePortal()
  const [genMsg, setGenMsg] = React.useState('')

  function handleGenerate() {
    if (!siteId) return
    const today = new Date().toISOString().slice(0, 10)
    setGenMsg('')
    generate.mutate(
      { site_id: siteId, portal_type: 'homepage', portal_date: today },
      {
        onSuccess: () => setGenMsg('Portal pages generated for today.'),
        onError: () => setGenMsg('Generation failed — check server logs.'),
      }
    )
  }

  if (!siteId) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        Select a site in the left panel
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-auto p-4">
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-destructive">
        Failed to load portal pages
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>
          {portalDate
            ? `No active portal pages for ${portalDate}`
            : 'No active portal pages found for this site'}
        </span>
        {canManage && !portalDate && (
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={handleGenerate}
              disabled={generate.isPending}
              className="flex items-center gap-1.5 text-xs px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {generate.isPending && <Loader2 size={12} className="animate-spin" />}
              Generate Portal Pages for Today
            </button>
            {genMsg && <p className="text-xs">{genMsg}</p>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
          <tr className="border-b">
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Taxonomy</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Date</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Items</th>
            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Hits</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Method</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Generated</th>
            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.id}
              className={[
                'border-b cursor-pointer transition-colors',
                selectedPortalId === row.id
                  ? 'bg-primary/5'
                  : 'hover:bg-muted/40',
              ].join(' ')}
              onClick={() => onSelectPortal(row.id)}
            >
              <td className="px-3 py-2 capitalize font-medium">{row.portal_type}</td>
              <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">
                {row.taxonomy_name ?? '—'}
              </td>
              <td className="px-3 py-2 text-muted-foreground tabular-nums">{row.portal_date}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.item_count}</td>
              <td className="px-3 py-2 text-right tabular-nums">{row.hit_count.toLocaleString()}</td>
              <td className="px-3 py-2">
                <MethodBadge method={row.generation_method} />
              </td>
              <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                {formatDate(row.generated_at)}
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
