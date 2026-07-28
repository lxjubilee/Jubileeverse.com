/**
 * WebsiteTaxonomyPanel.tsx — Taxonomy assignment management (Part 4 S9–11)
 *
 * Center: assignment grid with ▲/▼ reorder + delete
 * Right: assignment editor (slides in when row selected)
 */

import * as React from 'react'
import { ChevronUp, ChevronDown, Trash2, Plus, Check, X, Search } from 'lucide-react'
import {
  useTaxonomyAssignments,
  useAssignTaxonomy,
  useUpdateTaxonomyAssignment,
  useRemoveTaxonomyAssignment,
  useReorderTaxonomyAssignment,
} from '../../hooks/useWebsites'
import { useAllTaxonomyNodes } from '../../hooks/useTaxonomy'
import type { WebsiteTaxonomyAssignment } from '../../types/content-objects'

const NAV_POSITIONS = [
  { value: 'primary_nav',   label: 'Primary Nav' },
  { value: 'secondary_nav', label: 'Secondary Nav' },
  { value: 'footer_nav',    label: 'Footer Nav' },
  { value: 'sidebar',       label: 'Sidebar' },
  { value: 'hidden',        label: 'Hidden' },
]

interface WebsiteTaxonomyPanelProps {
  siteId: string
  canManage: boolean
}

// ── Assignment editor right panel ─────────────────────────────────────────────

function AssignmentEditor({
  siteId,
  assignment,
  onClose,
}: {
  siteId: string
  assignment: WebsiteTaxonomyAssignment
  onClose: () => void
}) {
  const update = useUpdateTaxonomyAssignment()
  const [customLabel, setCustomLabel] = React.useState(assignment.custom_label ?? '')
  const [navPosition, setNavPosition] = React.useState(assignment.nav_position)
  const [isFeatured, setIsFeatured] = React.useState(assignment.is_featured)
  const [dirty, setDirty] = React.useState(false)

  function handleSave() {
    update.mutate({
      siteId,
      assignmentId: assignment.id,
      data: { custom_label: customLabel || null, nav_position: navPosition, is_featured: isFeatured },
    }, { onSuccess: () => setDirty(false) })
  }

  return (
    <div className="flex flex-col h-full border-l">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
        <span className="text-xs font-medium flex-1 truncate">{assignment.name}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4 text-xs">
        <div>
          <label className="block text-muted-foreground mb-1">Taxonomy name</label>
          <p className="font-medium">{assignment.name}</p>
          <p className="text-muted-foreground">{assignment.slug}</p>
        </div>
        <div>
          <label className="block text-muted-foreground mb-1">Custom label</label>
          <input
            type="text"
            value={customLabel}
            placeholder={assignment.name}
            onChange={e => { setCustomLabel(e.target.value); setDirty(true) }}
            className="w-full border rounded px-2 h-7 bg-background text-xs"
          />
        </div>
        <div>
          <label className="block text-muted-foreground mb-1">Nav position</label>
          <select
            value={navPosition}
            onChange={e => { setNavPosition(e.target.value as WebsiteTaxonomyAssignment['nav_position']); setDirty(true) }}
            className="w-full border rounded px-2 h-7 bg-background text-xs"
          >
            {NAV_POSITIONS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="is-featured"
            type="checkbox"
            checked={isFeatured}
            onChange={e => { setIsFeatured(e.target.checked); setDirty(true) }}
            className="rounded"
          />
          <label htmlFor="is-featured" className="text-foreground">Featured</label>
        </div>
        {dirty && (
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="flex items-center gap-1 text-xs text-primary hover:opacity-80 disabled:opacity-50 transition-opacity"
          >
            <Check size={11} />
            Save changes
          </button>
        )}
        {update.isError && (
          <p className="text-xs text-destructive">Save failed</p>
        )}
      </div>
    </div>
  )
}

// ── Assign taxonomy modal ─────────────────────────────────────────────────────

function AssignModal({
  siteId,
  onClose,
  existingIds,
}: {
  siteId: string
  onClose: () => void
  existingIds: number[]
}) {
  const assign = useAssignTaxonomy()
  const { data: allNodes } = useAllTaxonomyNodes()
  const [search, setSearch] = React.useState('')
  const [selectedId, setSelectedId] = React.useState<number | null>(null)
  const [navPos, setNavPos] = React.useState('primary_nav')
  const [error, setError] = React.useState('')

  const nodes = React.useMemo(() => {
    const available = (allNodes?.nodes ?? []).filter(n => !existingIds.includes(n.id))
    if (!search.trim()) return available.slice(0, 12)
    const q = search.toLowerCase()
    return available.filter(n => n.name.toLowerCase().includes(q) || n.slug.toLowerCase().includes(q)).slice(0, 20)
  }, [allNodes, search, existingIds])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedId) { setError('Select a taxonomy node'); return }
    assign.mutate(
      { siteId, data: { taxonomy_node_id: selectedId, nav_position: navPos } },
      {
        onSuccess: onClose,
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Assignment failed'
          setError(msg.includes('422') ? 'Taxonomy assignment limit reached (max 12)' : msg)
        },
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-96 p-4">
        <h3 className="text-sm font-semibold mb-3">Assign Taxonomy Node</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Search input */}
          <div className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedId(null); setError('') }}
              placeholder="Search taxonomy nodes…"
              className="w-full border rounded pl-6 pr-2 h-7 text-xs bg-background"
              autoFocus
            />
          </div>
          {/* Node list */}
          <div className="border rounded max-h-48 overflow-y-auto">
            {nodes.length === 0 && (
              <p className="text-xs text-muted-foreground p-3 text-center">
                {allNodes ? 'No matching nodes' : 'Loading…'}
              </p>
            )}
            {nodes.map(node => (
              <button
                key={node.id}
                type="button"
                onClick={() => { setSelectedId(node.id); setError('') }}
                className={[
                  'w-full text-left px-3 py-2 text-xs border-b last:border-b-0 transition-colors',
                  selectedId === node.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-muted/50',
                ].join(' ')}
              >
                <span className="font-medium">{node.name}</span>
                <span className="ml-2 text-muted-foreground">{node.slug}</span>
                {node.taxonomy_type && (
                  <span className="ml-2 text-[10px] border rounded px-1 text-muted-foreground">{node.taxonomy_type}</span>
                )}
              </button>
            ))}
          </div>
          {/* Nav position */}
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Nav position</label>
            <select
              value={navPos}
              onChange={e => setNavPos(e.target.value)}
              className="w-full border rounded px-2 h-7 text-xs bg-background"
            >
              {NAV_POSITIONS.map(p => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-xs px-3 h-7 rounded border hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={assign.isPending || !selectedId}
              className="text-xs px-3 h-7 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Assign
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function WebsiteTaxonomyPanel({ siteId, canManage }: WebsiteTaxonomyPanelProps) {
  const { data: assignments = [], isLoading, error } = useTaxonomyAssignments(siteId)
  const remove = useRemoveTaxonomyAssignment()
  const reorder = useReorderTaxonomyAssignment()

  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [showAssignModal, setShowAssignModal] = React.useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = React.useState<string | null>(null)

  const selectedAssignment = assignments.find(a => a.id === selectedId) ?? null
  const atLimit = assignments.length >= 12

  function handleDelete(id: string) {
    remove.mutate({ siteId, assignmentId: id }, {
      onSuccess: () => {
        if (selectedId === id) setSelectedId(null)
        setConfirmDeleteId(null)
      },
    })
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Center grid */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
          <span className="text-xs font-medium flex-1">
            Taxonomy Assignments ({assignments.length}/12)
          </span>
          {canManage && (
            <button
              onClick={() => setShowAssignModal(true)}
              disabled={atLimit}
              title={atLimit ? 'Assignment limit reached (12)' : 'Assign taxonomy node'}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40 transition-colors"
            >
              <Plus size={12} />
              Assign
            </button>
          )}
        </div>

        {/* Table */}
        {isLoading && (
          <div className="flex-1 p-4 space-y-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-muted/40 animate-pulse rounded" />)}
          </div>
        )}
        {error && (
          <div className="flex-1 flex items-center justify-center text-sm text-destructive">
            Failed to load taxonomy assignments
          </div>
        )}
        {!isLoading && !error && (
          <div className="flex-1 overflow-auto">
            {!assignments.length ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No taxonomy nodes assigned
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                  <tr className="border-b">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Custom Label</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Nav Position</th>
                    <th className="text-center px-3 py-2 font-medium text-muted-foreground">Featured</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Order</th>
                    {canManage && <th className="px-3 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a, idx) => (
                    <tr
                      key={a.id}
                      className={[
                        'border-b cursor-pointer transition-colors',
                        selectedId === a.id ? 'bg-primary/5' : 'hover:bg-muted/40',
                      ].join(' ')}
                      onClick={() => setSelectedId(prev => prev === a.id ? null : a.id)}
                    >
                      <td className="px-3 py-2 font-medium">{a.name}</td>
                      <td className="px-3 py-2 text-muted-foreground">{a.custom_label ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground capitalize">{a.nav_position.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 text-center">{a.is_featured ? '✓' : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.display_order}</td>
                      {canManage && (
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                            <button
                              onClick={() => reorder.mutate({ siteId, id: a.id, direction: 'up' })}
                              disabled={idx === 0 || reorder.isPending}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                              title="Move up"
                            >
                              <ChevronUp size={13} />
                            </button>
                            <button
                              onClick={() => reorder.mutate({ siteId, id: a.id, direction: 'down' })}
                              disabled={idx === assignments.length - 1 || reorder.isPending}
                              className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
                              title="Move down"
                            >
                              <ChevronDown size={13} />
                            </button>
                            {confirmDeleteId === a.id ? (
                              <>
                                <button
                                  onClick={() => handleDelete(a.id)}
                                  className="text-xs text-destructive hover:opacity-80 transition-opacity"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(a.id)}
                                className="text-muted-foreground hover:text-destructive transition-colors"
                                title="Remove assignment"
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Right panel */}
      {selectedAssignment && (
        <div className="w-[340px] shrink-0">
          <AssignmentEditor
            siteId={siteId}
            assignment={selectedAssignment}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      {/* Assign modal */}
      {showAssignModal && (
        <AssignModal
          siteId={siteId}
          onClose={() => setShowAssignModal(false)}
          existingIds={assignments.map(a => a.taxonomy_node_id)}
        />
      )}
    </div>
  )
}
