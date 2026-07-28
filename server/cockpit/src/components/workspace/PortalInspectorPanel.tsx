/**
 * PortalInspectorPanel.tsx — Right 420px panel: composition inspector + override (Part 4 S8)
 *
 * Sections:
 *   1. Header: type/date, status badge, close button, regenerate button
 *   2. Overview: site, taxonomy, generation method, pool_size, hit_count
 *   3. Content Items: thumbnail list, optional edit mode (add/remove)
 *   4. Hit Analytics: 24h hourly sparkline (pure CSS bars, no chart library)
 */

import * as React from 'react'
import { X, RefreshCw, Edit2, Check, XCircle } from 'lucide-react'
import { usePortalDetail, useRegeneratePortal, useUpdatePortalItems } from '../../hooks/usePortal'
import type { PortalDetailItem, PortalHitTimeseries } from '../../types/content-objects'

interface PortalInspectorPanelProps {
  portalId: string | null
  onClose: () => void
  canManage: boolean
}

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="text-muted-foreground shrink-0 w-28">{label}</span>
      <span className="text-foreground break-all">{value ?? '—'}</span>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const classes = status === 'active'
    ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300 border border-green-200 dark:border-green-800'
    : 'bg-muted text-muted-foreground border border-border'
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium capitalize ${classes}`}>
      {status}
    </span>
  )
}

function HitSparkline({ timeseries }: { timeseries: PortalHitTimeseries[] }) {
  if (!timeseries.length) {
    return <p className="text-xs text-muted-foreground">No hits in last 24 hours</p>
  }
  const max = Math.max(...timeseries.map(r => r.hit_count), 1)
  return (
    <div className="flex items-end gap-0.5 h-12" title="Hourly hits (last 24h)">
      {timeseries.map(row => {
        const pct = Math.round((row.hit_count / max) * 100)
        const label = new Date(row.hour_bucket).getHours() + ':00'
        return (
          <div
            key={row.hour_bucket}
            className="flex-1 bg-primary/50 rounded-t transition-all"
            style={{ height: `${Math.max(pct, 4)}%` }}
            title={`${label}: ${row.hit_count} hits`}
          />
        )
      })}
    </div>
  )
}

function ItemRow({
  item,
  editMode,
  onRemove,
}: {
  item: PortalDetailItem
  editMode: boolean
  onRemove: (id: string) => void
}) {
  const imgSrc = item.cached_image_path
    ? `/images/${item.cached_image_path}`
    : item.image_url ?? undefined

  return (
    <div className="flex items-center gap-2 py-1.5 border-b last:border-0">
      {imgSrc ? (
        <img
          src={imgSrc}
          alt=""
          className="w-8 h-8 rounded object-cover shrink-0 bg-muted"
          loading="lazy"
        />
      ) : (
        <div className="w-8 h-8 rounded bg-muted shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{item.title}</p>
        {item.published_at && (
          <p className="text-xs text-muted-foreground">
            {new Date(item.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </div>
      {editMode && (
        <button
          onClick={() => onRemove(item.id)}
          className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
          title="Remove item"
        >
          <XCircle size={14} />
        </button>
      )}
    </div>
  )
}

export function PortalInspectorPanel({ portalId, onClose, canManage }: PortalInspectorPanelProps) {
  const { data: portal, isLoading, error } = usePortalDetail(portalId)
  const regenerate = useRegeneratePortal()
  const updateItems = useUpdatePortalItems()

  const [editMode, setEditMode]   = React.useState(false)
  const [editIds, setEditIds]     = React.useState<string[]>([])
  const [addIdInput, setAddIdInput] = React.useState('')
  const [addError, setAddError]   = React.useState('')

  // Reset edit state when portal changes
  React.useEffect(() => {
    setEditMode(false)
    setEditIds([])
    setAddIdInput('')
    setAddError('')
  }, [portalId])

  function handleEnterEdit() {
    setEditIds(portal?.content_ids ?? [])
    setEditMode(true)
  }

  function handleCancelEdit() {
    setEditMode(false)
    setEditIds([])
    setAddError('')
  }

  function handleRemoveItem(id: string) {
    setEditIds(prev => prev.filter(x => x !== id))
  }

  function handleAddItem() {
    const trimmed = addIdInput.trim()
    if (!trimmed) return
    if (editIds.includes(trimmed)) {
      setAddError('Already in list')
      return
    }
    setEditIds(prev => [...prev, trimmed])
    setAddIdInput('')
    setAddError('')
  }

  async function handleSaveEdit() {
    if (!portalId) return
    await updateItems.mutateAsync({ portalId, contentIds: editIds })
    setEditMode(false)
  }

  function handleRegenerate() {
    if (!portal) return
    regenerate.mutate({
      site_id: portal.site_id,
      portal_type: portal.portal_type,
      taxonomy_node_id: portal.taxonomy_node_id,
      portal_date: portal.portal_date,
    })
  }

  if (!portalId) return null

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Close inspector"
        >
          <X size={14} />
        </button>
        <div className="flex-1 min-w-0">
          {portal && (
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-xs font-semibold capitalize truncate">{portal.portal_type}</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{portal.portal_date}</span>
              <StatusBadge status={portal.status} />
            </div>
          )}
        </div>
        {canManage && portal && (
          <button
            onClick={handleRegenerate}
            disabled={regenerate.isPending}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Regenerate portal"
          >
            <RefreshCw size={12} className={regenerate.isPending ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="flex-1 p-4 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-5 bg-muted/40 animate-pulse rounded" />
          ))}
        </div>
      )}

      {error && (
        <div className="flex-1 flex items-center justify-center text-sm text-destructive px-4 text-center">
          Failed to load portal detail
        </div>
      )}

      {portal && (
        <div className="flex-1 overflow-y-auto">
          {/* Overview */}
          <div className="px-3 py-3 border-b text-xs">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Overview</p>
            <MetaRow label="Site ID" value={portal.site_id} />
            <MetaRow label="Taxonomy" value={(portal as { taxonomy_name?: string }).taxonomy_name ?? '—'} />
            <MetaRow label="Method" value={portal.generation_method} />
            <MetaRow label="Generated" value={formatTs(portal.generated_at)} />
            <MetaRow label="Pool size" value={(portal.metadata as Record<string, unknown>)?.pool_size as number ?? '—'} />
            <MetaRow label="Total hits" value={portal.hit_count.toLocaleString()} />
          </div>

          {/* Content Items */}
          <div className="px-3 py-3 border-b">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Content ({portal.items.length} items)
              </p>
              {canManage && !editMode && (
                <button
                  onClick={handleEnterEdit}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Edit2 size={11} />
                  Edit
                </button>
              )}
              {editMode && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveEdit}
                    disabled={updateItems.isPending}
                    className="flex items-center gap-1 text-xs text-primary hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    <Check size={11} />
                    Save
                  </button>
                  <button
                    onClick={handleCancelEdit}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X size={11} />
                    Cancel
                  </button>
                </div>
              )}
            </div>

            {/* Item list: in view mode show fetched items; in edit mode show by editIds */}
            <div className="text-xs">
              {!editMode
                ? portal.items.map(item => (
                    <ItemRow key={item.id} item={item} editMode={false} onRemove={handleRemoveItem} />
                  ))
                : editIds.map(id => {
                    const item = portal.items.find(x => x.id === id) ?? { id, title: id, excerpt: null, cached_image_path: null, image_url: null, published_at: null }
                    return <ItemRow key={id} item={item} editMode={true} onRemove={handleRemoveItem} />
                  })}
              {!editMode && !portal.items.length && (
                <p className="text-muted-foreground py-2">No content items</p>
              )}
              {editMode && !editIds.length && (
                <p className="text-muted-foreground py-2">No items — add below</p>
              )}
            </div>

            {/* Add by ID (edit mode only) */}
            {editMode && (
              <div className="mt-2 flex gap-1">
                <input
                  type="text"
                  placeholder="Content UUID"
                  value={addIdInput}
                  onChange={e => { setAddIdInput(e.target.value); setAddError('') }}
                  onKeyDown={e => { if (e.key === 'Enter') handleAddItem() }}
                  className="flex-1 text-xs border rounded px-2 h-7 bg-background"
                />
                <button
                  onClick={handleAddItem}
                  className="text-xs px-2 h-7 rounded border bg-muted hover:bg-muted/80 transition-colors"
                >
                  Add
                </button>
              </div>
            )}
            {addError && <p className="text-xs text-destructive mt-1">{addError}</p>}
            {updateItems.isError && (
              <p className="text-xs text-destructive mt-1">Save failed — one or more IDs not found</p>
            )}
          </div>

          {/* Hit Analytics */}
          <div className="px-3 py-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Hit Analytics (last 24h)
            </p>
            <HitSparkline timeseries={portal.timeseries} />
            {portal.timeseries.length > 0 && (
              <p className="text-xs text-muted-foreground mt-1">
                Total: {portal.timeseries.reduce((s, r) => s + r.hit_count, 0).toLocaleString()} hits
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
