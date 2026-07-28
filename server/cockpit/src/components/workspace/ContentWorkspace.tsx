/**
 * ContentWorkspace.tsx — CSS-transform three-panel workspace (Phase 4A)
 *
 * Layout:
 *   [Left: TaxonomyPanelFull (280px)] [Center: WorkspaceCenter (flex-1)] [Right: InlineEditorPanel (420px)]
 *
 * Animation: CSS transform translateX (GPU-accelerated), NOT react-resizable-panels.
 * - Left panel: collapses (translateX -280px) when editModeActive
 * - Right panel: starts off-screen (translateX +420px), slides in on selectedObjectId
 * - BreadcrumbBar: appears when leftPanelOpen is false
 *
 * Block M (Part 6): Adds "Pending Review" queue node at the top of the left panel.
 */

import * as React from 'react'
import { ClipboardList, ExternalLink } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useResizablePanel } from '../../hooks/useResizablePanel'
import { ResizeDivider } from '../ui/ResizeDivider'
import { TaxonomyPanelFull } from './TaxonomyPanelFull'
import { BreadcrumbBar } from './BreadcrumbBar'
import { WorkspaceCenter } from './WorkspaceCenter'
import { InlineEditorPanel } from './InlineEditorPanel'
import { CurrentEventsGrid } from './grids/CurrentEventsGrid'
import { usePendingReview } from '../../hooks/useAudit'
import type { AuditReport } from '../../types/content-objects'

// ── Pending Review Panel ──────────────────────────────────────────────────────

function PendingReviewPanel() {
  const [tab, setTab] = React.useState<'article' | 'image'>('article')
  const { data: articlesData, isLoading: loadingArticles } = usePendingReview('article')
  const { data: imagesData,   isLoading: loadingImages   } = usePendingReview('image')

  const articles: AuditReport[] = articlesData?.items ?? []
  const images:   AuditReport[] = imagesData?.items   ?? []

  const items     = tab === 'article' ? articles : images
  const isLoading = tab === 'article' ? loadingArticles : loadingImages

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
        <ClipboardList size={14} className="text-muted-foreground" />
        <span className="text-xs font-semibold">Pending Review</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b shrink-0">
        {(['article', 'image'] as const).map(t => {
          const count = t === 'article' ? articles.length : images.length
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={[
                'flex-1 text-xs py-2 font-medium capitalize transition-colors',
                tab === t
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {t === 'article' ? 'Articles' : 'Images'}
              {count > 0 && (
                <span className="ml-1.5 bg-primary/10 text-primary text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-xs text-muted-foreground p-4">Loading…</p>
        )}
        {!isLoading && items.length === 0 && (
          <p className="text-xs text-muted-foreground p-4">No items pending review.</p>
        )}
        {!isLoading && items.length > 0 && (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-20">Score</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-28">Submitted</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const id          = item.object_id ?? item.id
                const title       = item.title ?? 'Untitled'
                const score       = item.audit_score
                const submittedAt = item.submitted_for_review_at

                const scoreCls = score == null ? 'text-muted-foreground'
                  : score >= 80 ? 'text-green-600'
                  : score >= 60 ? 'text-amber-600'
                  : 'text-red-600'

                return (
                  <tr key={id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2 max-w-0">
                      <p className="truncate font-medium">{title}</p>
                    </td>
                    <td className={`px-3 py-2 font-medium ${scoreCls}`}>
                      {score != null ? `${score.toFixed(0)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {submittedAt ? new Date(submittedAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-2">
                      <a
                        href={`/backoffice/review/${id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-0.5 text-primary hover:underline"
                        title="Open review window"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function ContentWorkspace() {
  const leftPanelOpen    = useCockpitStore(s => s.leftPanelOpen)
  const editModeActive   = useCockpitStore(s => s.editModeActive)
  const selectedObjectId = useCockpitStore(s => s.selectedObjectId)
  const selectedNodePath = useCockpitStore(s => s.selectedNodePath)
  const { width: leftWidth, startResize } = useResizablePanel('content')

  const [selectedView, setSelectedView] = React.useState<'pending-review' | null>(null)

  // Detect whether the selected taxonomy node is under /current-events
  const isCurrentEventsNode = !!(
    selectedNodePath === '/current-events' ||
    selectedNodePath?.startsWith('/current-events/')
  )

  // Badge count for "Pending Review" button (articles + images combined)
  const { data: pendingArticlesData } = usePendingReview('article')
  const { data: pendingImagesData   } = usePendingReview('image')
  const pendingCount = (pendingArticlesData?.items?.length ?? 0) + (pendingImagesData?.items?.length ?? 0)

  return (
    <div className="relative flex h-full overflow-hidden">
      {/* ── Left panel (Taxonomy + Pending Review button) ─────────────── */}
      <div
        className="shrink-0 overflow-hidden border-r bg-background flex flex-col"
        style={{
          width: `${leftWidth}px`,
          transform: editModeActive ? `translateX(-${leftWidth}px)` : 'translateX(0)',
          marginLeft: editModeActive ? `-${leftWidth}px` : '0',
          transition: 'transform 250ms ease-in-out, margin-left 250ms ease-in-out',
        }}
      >
        {/* Pending Review quick-access button */}
        <button
          onClick={() => setSelectedView(v => v === 'pending-review' ? null : 'pending-review')}
          className={[
            'shrink-0 flex items-center gap-2 px-3 py-2 border-b text-xs font-medium transition-colors w-full text-left',
            selectedView === 'pending-review'
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
          ].join(' ')}
        >
          <ClipboardList size={14} />
          <span className="flex-1">Pending Review</span>
          {pendingCount > 0 && (
            <span className="bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0.5 rounded-full font-semibold">
              {pendingCount}
            </span>
          )}
        </button>

        {/* Taxonomy tree — fills the remainder; clicking it clears pending-review view */}
        <div className="flex-1 overflow-hidden" onClick={() => selectedView === 'pending-review' && setSelectedView(null)}>
          <TaxonomyPanelFull />
        </div>
      </div>
      {!editModeActive && <ResizeDivider onMouseDown={startResize} />}

      {/* ── Center panel ─────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Breadcrumb bar — visible when left panel is collapsed */}
        <div
          style={{
            maxHeight: leftPanelOpen ? '0' : '40px',
            overflow: 'hidden',
            transition: 'max-height 250ms ease-in-out',
          }}
        >
          <BreadcrumbBar />
        </div>

        {selectedView === 'pending-review' ? (
          <PendingReviewPanel />
        ) : isCurrentEventsNode ? (
          <CurrentEventsGrid />
        ) : (
          <WorkspaceCenter
            onRowSelect={(id) => useCockpitStore.getState().setSelectedObjectId(id)}
          />
        )}
      </div>

      {/* ── Right panel (Inline Editor) ───────────────────────────────── */}
      <div
        className="shrink-0 overflow-hidden border-l bg-background"
        style={{
          width: '420px',
          transform: selectedObjectId ? 'translateX(0)' : 'translateX(420px)',
          marginRight: selectedObjectId ? '0' : '-420px',
          transition: 'transform 250ms ease-in-out, margin-right 250ms ease-in-out',
        }}
      >
        <InlineEditorPanel />
      </div>
    </div>
  )
}
