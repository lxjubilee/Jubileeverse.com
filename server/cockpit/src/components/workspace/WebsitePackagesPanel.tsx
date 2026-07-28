/**
 * WebsitePackagesPanel.tsx — Part 4 S9–11 + Part 5 S10: Packages & Updates
 *
 * Center split: Packages Queue (top) + Updates Feed (bottom)
 * Right: package/update detail slide-in
 */

import * as React from 'react'
import { Package, X, Download, Loader2, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import {
  useWebsitePackages,
  useGenerateWebsitePackage,
} from '../../hooks/useWebsites'
import {
  useSatelliteUpdates,
  useGenerateSatelliteUpdate,
} from '../../hooks/useImages'
import type { WebsitePackage, SatelliteUpdate } from '../../types/content-objects'

interface WebsitePackagesPanelProps {
  siteId: string
  canManage: boolean
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ── Package status badge ───────────────────────────────────────────────────────

function PackageStatusBadge({ status }: { status: WebsitePackage['status'] }) {
  const classes =
    status === 'ready'       ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' :
    status === 'building'    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' :
    status === 'failed'      ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' :
    'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${classes}`}>
      {status === 'building' && <Loader2 size={10} className="animate-spin mr-1" />}
      {status}
    </span>
  )
}

// ── Update type badge ──────────────────────────────────────────────────────────

function UpdateTypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    content_change:  'bg-blue-50 text-blue-700',
    taxonomy_change: 'bg-purple-50 text-purple-700',
    theme_change:    'bg-pink-50 text-pink-700',
    config_change:   'bg-amber-50 text-amber-700',
    runtime_patch:   'bg-orange-50 text-orange-700',
    mixed:           'bg-muted text-muted-foreground',
  }
  const label = type.replace('_change', '').replace('_', ' ')
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${map[type] ?? 'bg-muted text-muted-foreground'}`}>
      {label.charAt(0).toUpperCase() + label.slice(1)}
    </span>
  )
}

function UpdateStatusBadge({ status }: { status: SatelliteUpdate['status'] }) {
  const classes =
    status === 'ready'      ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300' :
    status === 'building'   ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' :
    status === 'failed'     ? 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' :
    status === 'superseded' ? 'bg-muted/60 text-muted-foreground line-through' :
    'bg-muted text-muted-foreground'
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium capitalize ${classes}`}>
      {status === 'building' && <Loader2 size={10} className="animate-spin mr-1" />}
      {status}
    </span>
  )
}

// ── Package detail right panel ─────────────────────────────────────────────────

function PackageDetail({ pkg, onClose }: { pkg: WebsitePackage; onClose: () => void }) {
  const taxonomyCount = Array.isArray(pkg.taxonomy_snapshot) ? pkg.taxonomy_snapshot.length : 0

  return (
    <div className="flex flex-col h-full border-l">
      <div className="flex items-center gap-2 px-3 h-10 border-b shrink-0">
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
          <X size={14} />
        </button>
        <span className="text-xs font-medium flex-1">v{pkg.version_number}</span>
        <PackageStatusBadge status={pkg.status} />
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        <div className="space-y-0">
          {[
            ['Version', <span className="font-mono font-medium">{pkg.version_number}</span>],
            ['Built', formatDate(pkg.build_timestamp)],
            ['Size', formatBytes(pkg.file_size_bytes)],
            ['Taxonomy nodes', String(taxonomyCount)],
            ['Runtime', pkg.runtime_version ?? '—'],
            ['Content objects', String(pkg.content_object_count)],
            ['Checksum', <span className="font-mono truncate max-w-[140px] block">{pkg.checksum_sha256 ?? '—'}</span>],
          ].map(([label, value]) => (
            <div key={String(label)} className="flex justify-between py-1 border-b">
              <span className="text-muted-foreground">{label}</span>
              <span>{value}</span>
            </div>
          ))}
        </div>

        {pkg.release_notes && (
          <div>
            <p className="text-muted-foreground mb-1">Release notes</p>
            <p className="whitespace-pre-wrap text-foreground">{pkg.release_notes}</p>
          </div>
        )}

        {pkg.deployment_targets?.length > 0 && (
          <div>
            <p className="text-muted-foreground mb-1">Deployment targets</p>
            <div className="flex gap-1 flex-wrap">
              {pkg.deployment_targets.map(t => (
                <span key={t} className="bg-muted rounded px-1.5 py-0.5 text-xs">{t}</span>
              ))}
            </div>
          </div>
        )}

        <div className="pt-2">
          {pkg.cdn_download_url ? (
            <a
              href={pkg.cdn_download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:opacity-80 transition-opacity"
            >
              <Download size={12} />
              Download package
            </a>
          ) : (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Download size={12} />
              No download available (stub)
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Generate package modal ─────────────────────────────────────────────────────

function GenerateModal({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const generate = useGenerateWebsitePackage()
  const [version, setVersion] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [targets, setTargets] = React.useState<string[]>([])
  const [error, setError] = React.useState('')

  const TARGET_OPTIONS = ['static', 'node', 'docker']

  function toggleTarget(t: string) {
    setTargets(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!version.trim()) { setError('Version number is required'); return }
    generate.mutate(
      { siteId, data: { version_number: version.trim(), release_notes: notes.trim() || undefined } },
      { onSuccess: onClose, onError: () => setError('Failed to generate package') }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-96 p-4">
        <h3 className="text-sm font-semibold mb-3">Generate Deployment Package</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Version number</label>
            <input
              type="text"
              value={version}
              onChange={e => { setVersion(e.target.value); setError('') }}
              placeholder="e.g. 1.0.0"
              className="w-full border rounded px-2 h-7 text-xs bg-background font-mono"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Release notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full border rounded px-2 py-1.5 text-xs bg-background resize-none"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Deployment targets</label>
            <div className="flex gap-2">
              {TARGET_OPTIONS.map(t => (
                <label key={t} className="flex items-center gap-1 text-xs cursor-pointer">
                  <input type="checkbox" checked={targets.includes(t)} onChange={() => toggleTarget(t)} className="rounded" />
                  {t}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-xs px-3 h-7 rounded border hover:bg-muted/50 transition-colors">Cancel</button>
            <button
              type="submit"
              disabled={generate.isPending}
              className="flex items-center gap-1.5 text-xs px-3 h-7 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {generate.isPending && <Loader2 size={11} className="animate-spin" />}
              Generate
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Publish Update modal ───────────────────────────────────────────────────────

function PublishUpdateModal({ siteId, onClose }: { siteId: string; onClose: () => void }) {
  const publish = useGenerateSatelliteUpdate()
  const [version, setVersion] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [error, setError] = React.useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!version.trim()) { setError('Version number is required'); return }
    publish.mutate(
      { siteId, data: { version_number: version.trim(), release_notes: notes.trim() || undefined } },
      { onSuccess: onClose, onError: () => setError('Failed to publish update') }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-96 p-4">
        <h3 className="text-sm font-semibold mb-3">Publish Incremental Update</h3>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Update version</label>
            <input
              type="text"
              value={version}
              onChange={e => { setVersion(e.target.value); setError('') }}
              placeholder="e.g. 1.0.1"
              className="w-full border rounded px-2 h-7 text-xs bg-background font-mono"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Release notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              className="w-full border rounded px-2 py-1.5 text-xs bg-background resize-none"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="text-xs px-3 h-7 rounded border hover:bg-muted/50">Cancel</button>
            <button
              type="submit"
              disabled={publish.isPending}
              className="flex items-center gap-1.5 text-xs px-3 h-7 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {publish.isPending && <Loader2 size={11} className="animate-spin" />}
              Publish Update
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────────

export function WebsitePackagesPanel({ siteId, canManage }: WebsitePackagesPanelProps) {
  const { data: packages = [], isLoading: pkgLoading } = useWebsitePackages(siteId)
  const { data: updates = [], isLoading: updLoading } = useSatelliteUpdates(siteId)
  const [selectedPkgId, setSelectedPkgId] = React.useState<string | null>(null)
  const [showGenerateModal, setShowGenerateModal] = React.useState(false)
  const [showPublishModal, setShowPublishModal] = React.useState(false)
  const [updatesCollapsed, setUpdatesCollapsed] = React.useState(false)

  const selectedPkg = packages.find(p => p.id === selectedPkgId) ?? null

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Center — stacked sections */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* ── Packages Queue (top) ── */}
        <div className="flex flex-col border-b" style={{ flex: '1 1 0', minHeight: 0 }}>
          <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
            <span className="text-xs font-medium flex-1">Deployment Packages ({packages.length})</span>
            {canManage && (
              <button
                onClick={() => setShowGenerateModal(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Package size={12} />
                Generate Package
              </button>
            )}
          </div>

          {pkgLoading ? (
            <div className="flex-1 p-4 space-y-2">
              {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-muted/40 animate-pulse rounded" />)}
            </div>
          ) : !packages.length ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No deployment packages yet</div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                  <tr className="border-b">
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Version</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Runtime</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Built</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Objects</th>
                    <th className="text-right px-3 py-2 font-medium text-muted-foreground">Size</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Download</th>
                  </tr>
                </thead>
                <tbody>
                  {packages.map(pkg => (
                    <tr
                      key={pkg.id}
                      className={[
                        'border-b cursor-pointer transition-colors',
                        selectedPkgId === pkg.id ? 'bg-primary/5' : 'hover:bg-muted/40',
                      ].join(' ')}
                      onClick={() => setSelectedPkgId(prev => prev === pkg.id ? null : pkg.id)}
                    >
                      <td className="px-3 py-2 font-mono font-medium">v{pkg.version_number}</td>
                      <td className="px-3 py-2 font-mono text-muted-foreground">{pkg.runtime_version ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(pkg.build_timestamp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{pkg.content_object_count || '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatBytes(pkg.file_size_bytes)}</td>
                      <td className="px-3 py-2"><PackageStatusBadge status={pkg.status} /></td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {pkg.cdn_download_url ? (
                          <a href={pkg.cdn_download_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:opacity-80 transition-opacity" title="Download package">
                            <Download size={12} />
                          </a>
                        ) : (
                          <span className="text-muted-foreground/40"><Download size={12} /></span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Updates Feed (bottom) ── */}
        <div className="flex flex-col" style={{ flex: updatesCollapsed ? '0 0 40px' : '1 1 0', minHeight: 0 }}>
          <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
            <span className="text-xs font-medium flex-1">Incremental Updates ({updates.length})</span>
            {canManage && (
              <button
                onClick={() => setShowPublishModal(true)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RefreshCw size={12} />
                Publish Update
              </button>
            )}
            <button onClick={() => setUpdatesCollapsed(c => !c)} className="text-muted-foreground hover:text-foreground transition-colors">
              {updatesCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>

          {!updatesCollapsed && (
            <>
              {updLoading ? (
                <div className="flex-1 p-4 space-y-2">
                  {[...Array(2)].map((_, i) => <div key={i} className="h-8 bg-muted/40 animate-pulse rounded" />)}
                </div>
              ) : !updates.length ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No incremental updates yet</div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
                      <tr className="border-b">
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Version</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Type</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Scope</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Min Pkg</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Size</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Status</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Published</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Download</th>
                      </tr>
                    </thead>
                    <tbody>
                      {updates.map(upd => (
                        <tr key={upd.id} className="border-b hover:bg-muted/40 transition-colors">
                          <td className="px-3 py-2 font-mono font-medium">{upd.update_version}</td>
                          <td className="px-3 py-2"><UpdateTypeBadge type={upd.update_type} /></td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{upd.scope_summary ?? '—'}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{upd.min_package_version ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{formatBytes(upd.payload_size_bytes)}</td>
                          <td className="px-3 py-2"><UpdateStatusBadge status={upd.status} /></td>
                          <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formatDate(upd.created_at)}</td>
                          <td className="px-3 py-2">
                            {upd.payload_url ? (
                              <a href={upd.payload_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:opacity-80">
                                <Download size={12} />
                              </a>
                            ) : (
                              <span className="text-muted-foreground/40"><Download size={12} /></span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Right panel — package detail */}
      {selectedPkg && (
        <div className="w-[320px] shrink-0">
          <PackageDetail pkg={selectedPkg} onClose={() => setSelectedPkgId(null)} />
        </div>
      )}

      {showGenerateModal && <GenerateModal siteId={siteId} onClose={() => setShowGenerateModal(false)} />}
      {showPublishModal && <PublishUpdateModal siteId={siteId} onClose={() => setShowPublishModal(false)} />}
    </div>
  )
}
