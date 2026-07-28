/**
 * AutomationWorkspace.tsx — Three-panel Automation workspace (Part 2 Section 7)
 *
 * Mirrors PromptsWorkspace layout/animation exactly:
 *   Left 280px (AutomationNavPanel) | Center flex-1 (AutomationJobsPanel) | Right 420px (AutomationJobPanel)
 *
 * All back-office users can access — no admin guard.
 * Admin detection is used only to show/hide write controls in the left panel tree.
 */

import * as React from 'react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { AutomationNavPanel } from './AutomationNavPanel'
import { AutomationJobsPanel } from './AutomationJobsPanel'
import { AutomationJobPanel } from './AutomationJobPanel'
import { AutomationDashboard } from './AutomationDashboard'
import type { AutomationNavNode } from '../../lib/api'
import { useAutomationTree } from '../../hooks/useAutomationTree'

export function AutomationWorkspace() {
  const leftPanelOpen      = useCockpitStore(s => s.leftPanelOpen)
  const editModeActive     = useCockpitStore(s => s.editModeActive)
  const selectedObjectId   = useCockpitStore(s => s.selectedObjectId)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)
  const user               = useCockpitStore(s => s.user)

  const isAdmin = user?.role === 'admin'

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const { width: leftWidth, startResize } = useResizablePanel('automation')

  // Clean state on mount — don't inherit other workspace selection
  React.useEffect(() => { setSelectedObjectId(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Derive selected node title for the center panel header
  const { data: treeData } = useAutomationTree()
  const selectedNodeTitle = React.useMemo(() => {
    if (!selectedNodeId || !treeData) return null
    function find(nodes: AutomationNavNode[]): string | null {
      for (const n of nodes) {
        if (n.id === selectedNodeId) return n.title
        const found = find(n.children ?? [])
        if (found) return found
      }
      return null
    }
    return find(treeData.nodes)
  }, [selectedNodeId, treeData])

  function handleJobSelect(id: string) {
    setSelectedObjectId(id)
  }

  function handleNewJob() {
    setSelectedObjectId('new')
  }

  function handleClosePanel() {
    setSelectedObjectId(null)
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Left — resizable, collapses when edit mode active */}
      <div
        className="shrink-0 overflow-hidden border-r bg-background"
        style={{
          width: `${leftWidth}px`,
          transform: editModeActive ? `translateX(-${leftWidth}px)` : 'translateX(0)',
          marginLeft: editModeActive ? `-${leftWidth}px` : '0',
          transition: 'transform 250ms ease-in-out, margin-left 250ms ease-in-out',
        }}
      >
        <AutomationNavPanel
          isAdmin={isAdmin}
          selectedNodeId={selectedNodeId}
          onNodeSelect={setSelectedNodeId}
        />
      </div>
      {!editModeActive && <ResizeDivider onMouseDown={startResize} />}

      {/* Center — flex-1 */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Breadcrumb bar — visible when left panel is collapsed */}
        <div
          style={{
            maxHeight: leftPanelOpen ? '0' : '40px',
            overflow: 'hidden',
            transition: 'max-height 250ms ease-in-out',
          }}
        >
          <div className="flex items-center px-4 h-10 border-b text-xs text-muted-foreground bg-muted/30">
            {selectedNodeTitle ? (
              <button
                onClick={() => setSelectedNodeId(null)}
                className="hover:underline"
              >
                {selectedNodeTitle}
              </button>
            ) : (
              'Automation'
            )}
          </div>
        </div>
        {selectedNodeId ? (
          <AutomationJobsPanel
            selectedNodeId={selectedNodeId}
            selectedNodeTitle={selectedNodeTitle}
            onJobSelect={handleJobSelect}
            onNewJob={handleNewJob}
            isAdmin={isAdmin}
          />
        ) : (
          <AutomationDashboard />
        )}
      </div>

      {/* Right — 420px, slides in when a job is selected */}
      <div
        className="shrink-0 overflow-hidden border-l bg-background"
        style={{
          width: '420px',
          transform: selectedObjectId ? 'translateX(0)' : 'translateX(420px)',
          marginRight: selectedObjectId ? '0' : '-420px',
          transition: 'transform 250ms ease-in-out, margin-right 250ms ease-in-out',
        }}
      >
        <AutomationJobPanel
          jobId={selectedObjectId}
          automationNodeId={selectedNodeId}
          onClose={handleClosePanel}
        />
      </div>
    </div>
  )
}
