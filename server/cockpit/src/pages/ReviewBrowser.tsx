/**
 * ReviewBrowser.tsx — Dedicated review window for content approval (Part 6 S9)
 *
 * Route: /review/:id
 * No rail navigation — just the red review bar + rendered content.
 */

import * as React from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle, XCircle, ChevronDown } from 'lucide-react'
import { useReviewContent, useApproveContent, useRejectContent } from '../hooks/useAudit'
import type { AuditFinding, AuditScores } from '../types/content-objects'

// ── Score badge (inline in review bar) ───────────────────────────────────────

function AuditScoreBadge({ score }: { score?: number | null }) {
  if (!score && score !== 0) return null
  const cls = score >= 80 ? 'bg-green-100 text-green-800'
    : score >= 60 ? 'bg-amber-100 text-amber-800'
    : 'bg-red-100 text-red-800'
  return (
    <span className={`text-xs font-bold px-2 py-1 rounded ${cls}`}>
      {score.toFixed(0)}%
    </span>
  )
}

// ── Audit report slide-out ────────────────────────────────────────────────────

function AuditSlideout({ scores, findings, onClose }: {
  scores: AuditScores
  findings: AuditFinding[]
  onClose: () => void
}) {
  return (
    <div className="fixed top-14 right-0 bottom-0 w-80 bg-background border-l shadow-xl overflow-y-auto z-50">
      <div className="flex items-center justify-between p-3 border-b">
        <span className="text-sm font-semibold">Audit Report</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>
      <div className="p-4 space-y-3">
        {/* Sub-scores */}
        <div className="space-y-1.5">
          {Object.entries(scores).filter(([k]) => k !== 'composite').map(([key, val]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-36 truncate capitalize">
                {key.replace(/_/g, ' ')}
              </span>
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${(val as number) >= 80 ? 'bg-green-500' : (val as number) >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${val}%` }}
                />
              </div>
              <span className="text-xs font-medium w-8 text-right">{(val as number).toFixed(0)}%</span>
            </div>
          ))}
        </div>

        {/* Findings */}
        {findings && findings.length > 0 && (
          <div>
            <p className="text-xs font-semibold mb-2">Findings</p>
            {findings.map((f, i) => (
              <div key={i} className={`rounded border p-2 mb-2 text-xs ${
                f.severity === 'critical' ? 'border-red-200 bg-red-50'
                : f.severity === 'warning' ? 'border-amber-200 bg-amber-50'
                : 'border-border bg-muted/10'
              }`}>
                <span className="font-medium capitalize">{f.severity} · {f.category.replace(/_/g, ' ')}</span>
                {f.excerpt && <p className="italic text-muted-foreground mt-0.5">"{f.excerpt}"</p>}
                <p className="mt-0.5">{f.explanation}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reject dialog ─────────────────────────────────────────────────────────────

function RejectDialog({ objectId, onClose, onRejected }: { objectId: string; onClose: () => void; onRejected: () => void }) {
  const [reason, setReason] = React.useState('')
  const reject = useRejectContent()
  const isValid = reason.trim().length >= 10

  function handleSubmit() {
    if (!isValid) return
    reject.mutate({ objectId, reason }, {
      onSuccess: () => { onRejected(); onClose() },
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
        <h2 className="text-base font-semibold mb-3">Reject Content</h2>
        <p className="text-sm text-muted-foreground mb-3">Please provide a reason for rejection (minimum 10 characters).</p>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          rows={4}
          placeholder="Describe why this content needs additional work…"
          className="w-full text-sm border rounded p-2 resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1">{reason.trim().length}/10 characters minimum</p>
        <div className="flex gap-2 justify-end mt-4">
          <button onClick={onClose} className="text-sm px-4 py-2 border rounded hover:bg-muted">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={!isValid || reject.isPending}
            className="text-sm px-4 py-2 bg-destructive text-destructive-foreground rounded disabled:opacity-50 hover:opacity-90"
          >
            {reject.isPending ? 'Rejecting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main review browser ───────────────────────────────────────────────────────

export function ReviewBrowser() {
  const { id } = useParams<{ id: string }>()
  const { data: content, isLoading, error } = useReviewContent(id ?? null)
  const approve = useApproveContent()

  const [showAuditReport, setShowAuditReport] = React.useState(false)
  const [showRejectDialog, setShowRejectDialog] = React.useState(false)
  const [actionDone, setActionDone] = React.useState<'approved' | 'rejected' | null>(null)

  const auditScore = (content as Record<string, unknown> | undefined)?.audit_score as number | undefined
  const scores = (content as Record<string, unknown> | undefined)?.scores as AuditScores | undefined
  const findings = ((content as Record<string, unknown> | undefined)?.findings as AuditFinding[]) ?? []
  const title = (content as Record<string, unknown> | undefined)?.title as string | undefined
  const objectType = (content as Record<string, unknown> | undefined)?.object_type as string | undefined

  function handleApprove() {
    if (!id) return
    approve.mutate(id, { onSuccess: () => setActionDone('approved') })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">
        Loading content…
      </div>
    )
  }

  if (error || !content) {
    return (
      <div className="flex items-center justify-center h-screen text-sm text-destructive">
        Content not found or access denied.
      </div>
    )
  }

  if (actionDone) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        {actionDone === 'approved' ? (
          <>
            <CheckCircle size={48} className="text-green-500" />
            <p className="text-lg font-semibold">Content Approved</p>
            <p className="text-sm text-muted-foreground">Cache regeneration and propagation triggered.</p>
          </>
        ) : (
          <>
            <XCircle size={48} className="text-destructive" />
            <p className="text-lg font-semibold">Content Rejected</p>
            <p className="text-sm text-muted-foreground">Content moved to Additional Work.</p>
          </>
        )}
        <button onClick={() => window.close()} className="text-sm px-4 py-2 border rounded hover:bg-muted mt-2">Close Window</button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Red review bar */}
      <div
        className="fixed top-0 left-0 right-0 h-14 flex items-center justify-between px-4 z-40 shadow-md"
        style={{ backgroundColor: '#CC0000', color: 'white' }}
      >
        {/* Left: title + type + score */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{title ?? 'Untitled'}</p>
            {objectType && <p className="text-xs opacity-80 capitalize">{objectType.replace(/_/g, ' ')}</p>}
          </div>
          {auditScore !== undefined && <AuditScoreBadge score={auditScore} />}
          {scores && (
            <button
              onClick={() => setShowAuditReport(s => !s)}
              className="flex items-center gap-1 text-xs opacity-80 hover:opacity-100 underline"
            >
              View Audit Report <ChevronDown size={12} />
            </button>
          )}
        </div>

        {/* Right: Approve / Reject */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleApprove}
            disabled={approve.isPending}
            className="flex items-center gap-1.5 text-sm font-semibold bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
          >
            <CheckCircle size={16} />
            {approve.isPending ? 'Approving…' : 'Approve'}
          </button>
          <button
            onClick={() => setShowRejectDialog(true)}
            className="flex items-center gap-1.5 text-sm font-semibold border border-white/50 hover:bg-white/10 px-4 py-2 rounded"
          >
            <XCircle size={16} />
            Reject
          </button>
        </div>
      </div>

      {/* Content area (offset below review bar) */}
      <div className="pt-14">
        <article className="max-w-3xl mx-auto px-6 py-8">
          <h1 className="text-2xl font-bold mb-4">{title}</h1>
          <div className="prose prose-sm max-w-none text-sm leading-relaxed text-foreground">
            {((content as Record<string, unknown>)?.summary as string) ?? (
              <p className="text-muted-foreground italic">No content preview available.</p>
            )}
          </div>
        </article>
      </div>

      {/* Audit report slideout */}
      {showAuditReport && scores && (
        <AuditSlideout
          scores={scores}
          findings={findings}
          onClose={() => setShowAuditReport(false)}
        />
      )}

      {/* Reject dialog */}
      {showRejectDialog && id && (
        <RejectDialog
          objectId={id}
          onClose={() => setShowRejectDialog(false)}
          onRejected={() => setActionDone('rejected')}
        />
      )}
    </div>
  )
}
