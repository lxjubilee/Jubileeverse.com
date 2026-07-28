/**
 * PromptsWorkspace.tsx — Three-panel Prompts workspace (Part 2 Section 4)
 *
 * Mirrors ContentWorkspace layout/animation exactly:
 *   Left 280px (PromptNavPanel) | Center flex-1 (PromptGrid) | Right 420px (PromptEditorPanel)
 *
 * Same CSS transform / margin animation pattern and useCockpitStore state machine.
 */

import * as React from 'react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { PromptNavPanel } from './PromptNavPanel'
import { PromptGrid } from './PromptGrid'
import { PromptEditorPanel } from './PromptEditorPanel'

export function PromptsWorkspace() {
  const leftPanelOpen      = useCockpitStore(s => s.leftPanelOpen)
  const editModeActive     = useCockpitStore(s => s.editModeActive)
  const selectedObjectId   = useCockpitStore(s => s.selectedObjectId)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)

  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null)
  const { width: leftWidth, startResize } = useResizablePanel('prompts')

  // Clean state on mount — don't inherit Content workspace selection
  React.useEffect(() => { setSelectedObjectId(null) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* Left — resizable, collapses when edit mode active (identical to ContentWorkspace) */}
      <div
        className="shrink-0 overflow-hidden border-r bg-background"
        style={{
          width: `${leftWidth}px`,
          transform: editModeActive ? `translateX(-${leftWidth}px)` : 'translateX(0)',
          marginLeft: editModeActive ? `-${leftWidth}px` : '0',
          transition: 'transform 250ms ease-in-out, margin-left 250ms ease-in-out',
        }}
      >
        <PromptNavPanel selectedNodeId={selectedNodeId} onNodeSelect={setSelectedNodeId} />
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
            Prompt Library
          </div>
        </div>
        <PromptGrid
          selectedNodeId={selectedNodeId}
          onRowSelect={id => setSelectedObjectId(id)}
        />
      </div>

      {/* Right — 420px, slides in when a prompt is selected */}
      <div
        className="shrink-0 overflow-hidden border-l bg-background"
        style={{
          width: '420px',
          transform: selectedObjectId ? 'translateX(0)' : 'translateX(420px)',
          marginRight: selectedObjectId ? '0' : '-420px',
          transition: 'transform 250ms ease-in-out, margin-right 250ms ease-in-out',
        }}
      >
        <PromptEditorPanel />
      </div>
    </div>
  )
}
