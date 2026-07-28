/**
 * WebsitesWorkspace.tsx — Three-panel Websites workspace (Part 4 S9–11)
 *
 * Left 280px:  WebsiteNavPanel (site tree + section nav)
 * Center flex: section-specific panel (overview stats / taxonomy / pages / packages / preview)
 * Right 420px: WebsiteEditorPanel (slides in for overview; panels handle own right side for taxonomy/pages/packages)
 */

import * as React from 'react'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { WebsiteNavPanel } from './WebsiteNavPanel'
import { WebsiteEditorPanel } from './WebsiteEditorPanel'
import { WebsiteTaxonomyPanel } from './WebsiteTaxonomyPanel'
import { WebsitePagesPanel } from './WebsitePagesPanel'
import { WebsitePackagesPanel } from './WebsitePackagesPanel'
import { WebsitePreviewPanel } from './WebsitePreviewPanel'
import { useSite } from '../../hooks/useSites'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useSatelliteSyncStatus } from '../../hooks/useImages'
import type { SatelliteSyncStatus } from '../../types/content-objects'

type WebsiteSection = 'overview' | 'taxonomy' | 'pages' | 'packages' | 'preview' | null

// ── Overview stats panel ─────────────────────────────────────────────────────

function SyncStatusBadge({ status }: { status: SatelliteSyncStatus }) {
  const map: Record<string, { cls: string; label: string }> = {
    in_sync: { cls: 'bg-green-50 text-green-700 border-green-200', label: 'In Sync' },
    behind:  { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Behind' },
    error:   { cls: 'bg-red-50 text-red-700 border-red-200', label: 'Error' },
    unknown: { cls: 'bg-muted text-muted-foreground border-border', label: 'Unknown' },
  }
  const s = map[status.sync_status] ?? map.unknown
  return (
    <div className="rounded border bg-muted/10 p-3 space-y-1">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${s.cls}`}>{s.label}</span>
        {status.sync_status === 'behind' && status.pending_updates !== undefined && status.pending_updates > 0 && (
          <span className="text-xs text-muted-foreground">{status.pending_updates} update{status.pending_updates !== 1 ? 's' : ''} pending</span>
        )}
      </div>
      {status.last_check_at && (
        <p className="text-xs text-muted-foreground">
          Last check: {new Date(status.last_check_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
      )}
      {status.current_package_version && (
        <p className="text-xs text-muted-foreground font-mono">
          Package: v{status.current_package_version}
          {status.current_update_version && ` · Update: ${status.current_update_version}`}
        </p>
      )}
      {status.sync_status === 'error' && status.last_error && (
        <p className="text-xs text-destructive mt-1">{status.last_error}</p>
      )}
    </div>
  )
}

function OverviewPanel({ siteId }: { siteId: string }) {
  const { data: site } = useSite(siteId)
  const { data: syncStatus } = useSatelliteSyncStatus(siteId)
  if (!site) return null
  const ext = (site.extension_data ?? {}) as Record<string, unknown>
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <h2 className="text-sm font-semibold mb-4">{site.title}</h2>
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <StatCard label="Domain" value={String(ext.domain ?? '—')} />
        <StatCard label="Status" value={site.status ?? '—'} />
        <StatCard label="Tone" value={String(ext.site_tone ?? '—')} />
      </div>
      {syncStatus && (
        <div className="mt-6 max-w-md">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Satellite Status</p>
          <SyncStatusBadge status={syncStatus} />
        </div>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Select a section in the left panel to manage taxonomy, pages, or packages.
      </p>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  )
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function WebsitesWorkspace() {
  const user = useCockpitStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const isSiteOwner = user?.role === 'site_owner'
  const canManage = isAdmin || isSiteOwner

  const [selectedSiteId, setSelectedSiteId] = React.useState<string | null>(null)
  const [selectedSection, setSelectedSection] = React.useState<WebsiteSection>(null)
  const { width: leftWidth, startResize } = useResizablePanel('websites')

  // Reset section when site changes
  function handleSelectSite(id: string) {
    setSelectedSiteId(id)
    setSelectedSection('overview')
  }

  // Right panel visible for overview section only
  const showRightPanel = selectedSiteId !== null && selectedSection === 'overview'

  function renderCenter() {
    if (!selectedSiteId) {
      return (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Select a website in the left panel
        </div>
      )
    }
    switch (selectedSection) {
      case 'overview':  return <OverviewPanel siteId={selectedSiteId} />
      case 'taxonomy':  return <WebsiteTaxonomyPanel siteId={selectedSiteId} canManage={canManage} />
      case 'pages':     return <WebsitePagesPanel siteId={selectedSiteId} canManage={canManage} />
      case 'packages':  return <WebsitePackagesPanel siteId={selectedSiteId} canManage={canManage} />
      case 'preview':   return <WebsitePreviewPanel siteId={selectedSiteId} />
      default:
        return (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            Select a section in the left panel
          </div>
        )
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left panel */}
      <div className="shrink-0 border-r flex flex-col overflow-hidden" style={{ width: `${leftWidth}px` }}>
        <WebsiteNavPanel
          selectedSiteId={selectedSiteId}
          onSelectSite={handleSelectSite}
          selectedSection={selectedSection}
          onSelectSection={setSelectedSection}
          isAdmin={isAdmin}
        />
      </div>
      <ResizeDivider onMouseDown={startResize} />

      {/* Center panel */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {renderCenter()}
      </div>

      {/* Right panel — overview/config only */}
      <div
        className="shrink-0 border-l flex flex-col overflow-hidden transition-all duration-250"
        style={{
          width: showRightPanel ? '420px' : '0px',
          opacity: showRightPanel ? 1 : 0,
        }}
      >
        {showRightPanel && (
          <WebsiteEditorPanel
            siteId={selectedSiteId}
            onClose={() => setSelectedSection(null)}
          />
        )}
      </div>
    </div>
  )
}
