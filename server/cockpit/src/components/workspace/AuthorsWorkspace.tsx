/**
 * AuthorsWorkspace.tsx — Part 3 Section 5 three-panel Authors workspace
 *
 * Layout mirrors ContentWorkspace / PromptsWorkspace:
 *   Left 280px (AuthorListPanel) | Center flex-1 (AuthorSummaryPanel) | Right 420px (AuthorEditorPanel)
 *
 * Bio editing is now handled inline inside AuthorEditorPanel (Section 3: Channel Bios).
 */

import * as React from 'react'
import { PenLine } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { useAuthor } from '../../hooks/useAuthors'
import { AuthorListPanel } from './AuthorListPanel'
import { AuthorSummaryPanel } from './AuthorSummaryPanel'
import { AuthorEditorPanel } from './AuthorEditorPanel'
import type { AuthorExtension } from '../../types/content-objects'

export function AuthorsWorkspace() {
  const user                = useCockpitStore(s => s.user)
  const selectedObjectId    = useCockpitStore(s => s.selectedObjectId)
  const setSelectedObjectId = useCockpitStore(s => s.setSelectedObjectId)
  const editModeActive      = useCockpitStore(s => s.editModeActive)
  const leftPanelOpen       = useCockpitStore(s => s.leftPanelOpen)

  const isAdmin = user?.role === 'admin'
  const { width: leftWidth, startResize } = useResizablePanel('authors')

  // Clear any Content workspace selection when Authors workspace mounts
  React.useEffect(() => {
    setSelectedObjectId(null)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: selectedAuthor } = useAuthor(selectedObjectId)

  function handleSelectAuthor(id: string) {
    setSelectedObjectId(id)
  }

  function handleCloseEditor() {
    setSelectedObjectId(null)
  }

  const breadcrumbLabel = selectedAuthor
    ? (selectedAuthor.extension_data as AuthorExtension)?.display_name || selectedAuthor.title || 'Author'
    : 'Authors'

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* ── Left panel (Author list) ─────────────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden border-r bg-background"
        style={{
          width: `${leftWidth}px`,
          transform: editModeActive ? `translateX(-${leftWidth}px)` : 'translateX(0)',
          marginLeft: editModeActive ? `-${leftWidth}px` : '0',
          transition: 'transform 250ms ease-in-out, margin-left 250ms ease-in-out',
        }}
      >
        <AuthorListPanel
          selectedAuthorId={selectedObjectId}
          onSelectAuthor={handleSelectAuthor}
          isAdmin={isAdmin}
        />
      </div>
      {!editModeActive && <ResizeDivider onMouseDown={startResize} />}

      {/* ── Center panel ─────────────────────────────────────────────────── */}
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
              onClick={handleCloseEditor}
              className="flex items-center gap-1.5 hover:text-foreground transition-colors"
              title="Back to authors list"
            >
              <PenLine size={12} />
              <span>Authors</span>
            </button>
            {selectedAuthor && (
              <>
                <span>/</span>
                <span className="font-medium text-foreground">{breadcrumbLabel}</span>
              </>
            )}
          </div>
        </div>

        <AuthorSummaryPanel
          authorId={selectedObjectId}
          isAdmin={isAdmin}
        />
      </div>

      {/* ── Right panel (Author editor) ───────────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden border-l bg-background"
        style={{
          width: '420px',
          transform: selectedObjectId ? 'translateX(0)' : 'translateX(420px)',
          marginRight: selectedObjectId ? '0' : '-420px',
          transition: 'transform 250ms ease-in-out, margin-right 250ms ease-in-out',
        }}
      >
        <AuthorEditorPanel
          authorId={selectedObjectId}
          onClose={handleCloseEditor}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}
