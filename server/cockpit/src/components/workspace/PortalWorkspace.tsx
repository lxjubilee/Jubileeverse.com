/**
 * PortalWorkspace.tsx — Three-panel Portal workspace (Part 4 S7–8)
 *
 * Layout mirrors AuthorsWorkspace:
 *   Left 280px (PortalNavPanel) | Center flex-1 (PortalGridPanel) | Right 420px (PortalInspectorPanel)
 */

import * as React from 'react'
import { LayoutDashboard } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { PortalNavPanel } from './PortalNavPanel'
import { PortalGridPanel } from './PortalGridPanel'
import { PortalInspectorPanel } from './PortalInspectorPanel'

export function PortalWorkspace() {
  const user                = useCockpitStore(s => s.user)
  const selectedObjectId    = useCockpitStore(s => s.selectedObjectId)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)
  const editModeActive      = useCockpitStore(s => s.editModeActive)
  const leftPanelOpen       = useCockpitStore(s => s.leftPanelOpen)

  const canManage = ['admin', 'site_owner', 'publisher'].includes(user?.role ?? '')
  const { width: leftWidth, startResize } = useResizablePanel('portal')

  const [selectedSiteId, setSelectedSiteId] = React.useState<number | null>(null)
  const [selectedDate, setSelectedDate]     = React.useState<string | null>(null)

  // Clear any prior selection when workspace mounts
  React.useEffect(() => {
    setSelectedObjectId(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleSelectPortal(id: string) {
    setSelectedObjectId(id)
  }

  function handleCloseInspector() {
    setSelectedObjectId(null)
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* ── Left panel (Nav tree) ─────────────────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden border-r bg-background"
        style={{
          width: `${leftWidth}px`,
          transform: editModeActive ? `translateX(-${leftWidth}px)` : 'translateX(0)',
          marginLeft: editModeActive ? `-${leftWidth}px` : '0',
          transition: 'transform 250ms ease-in-out, margin-left 250ms ease-in-out',
        }}
      >
        <PortalNavPanel
          selectedSiteId={selectedSiteId}
          onSelectSite={setSelectedSiteId}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          selectedPortalId={selectedObjectId}
          onSelectPortal={handleSelectPortal}
        />
      </div>
      {!editModeActive && <ResizeDivider onMouseDown={startResize} />}

      {/* ── Center panel (Grid) ───────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Breadcrumb bar — visible when left panel is collapsed */}
        <div
          style={{
            maxHeight: leftPanelOpen ? '0' : '40px',
            overflow: 'hidden',
            transition: 'max-height 250ms ease-in-out',
          }}
        >
          <div className="flex items-center gap-2 px-4 h-10 border-b text-xs text-muted-foreground bg-muted/30 shrink-0">
            <button
              onClick={handleCloseInspector}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
            >
              <LayoutDashboard size={12} />
              <span>Portal</span>
            </button>
          </div>
        </div>

        <PortalGridPanel
          siteId={selectedSiteId}
          portalDate={selectedDate}
          selectedPortalId={selectedObjectId}
          onSelectPortal={handleSelectPortal}
          canManage={canManage}
        />
      </div>

      {/* ── Right panel (Inspector) ───────────────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden border-l bg-background"
        style={{
          width: '420px',
          transform: selectedObjectId ? 'translateX(0)' : 'translateX(420px)',
          marginRight: selectedObjectId ? '0' : '-420px',
          transition: 'transform 250ms ease-in-out, margin-right 250ms ease-in-out',
        }}
      >
        <PortalInspectorPanel
          portalId={selectedObjectId}
          onClose={handleCloseInspector}
          canManage={canManage}
        />
      </div>
    </div>
  )
}
