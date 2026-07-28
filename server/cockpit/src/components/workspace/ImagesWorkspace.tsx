/**
 * ImagesWorkspace.tsx — Part 5 S12: Image generation review workflow
 *
 * Left 64px-aware panel: 4 fixed queue nodes (Pending, In Review, Completed, Rejected)
 * Center: grid for selected queue
 * Right: job detail slide-in
 */

import * as React from 'react'
import { Loader2, CheckCircle2, XCircle, Clock, Image as ImageIcon, CheckCheck, RotateCcw, X, Archive, RefreshCw } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import {
  useImageCounts, useImageQueue, useGenerateImages, useCheckoutImages,
  useApproveImage, useApproveAllImages, useRejectImage, useRequeueImage,
  useEditImagePrompt, useArchiveImage, useRegenerateImage,
} from '../../hooks/useImages'
import type { ImageGenerationJob } from '../../types/content-objects'

type QueueNode = 'pending' | 'in_review' | 'approved' | 'rejected'

// ── Formatting helpers ────────────────────────────────────────────────────────

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ── Image thumbnail ───────────────────────────────────────────────────────────

function Thumbnail({ url, size = 80 }: { url: string | null; size?: number }) {
  if (!url) {
    return (
      <div
        className="bg-muted/40 rounded flex items-center justify-center shrink-0 text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <ImageIcon size={size / 3} />
      </div>
    )
  }
  return (
    <img
      src={url}
      alt="Generated"
      className="rounded object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:    'bg-muted text-muted-foreground',
    generating: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    in_review:  'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    approved:   'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300',
    rejected:   'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
    archived:   'bg-muted text-muted-foreground',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium capitalize ${map[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status === 'generating' && <Loader2 size={10} className="animate-spin" />}
      {status.replace('_', ' ')}
    </span>
  )
}

// ── Left panel queue nav ──────────────────────────────────────────────────────

const QUEUE_NODES: { id: QueueNode; label: string; icon: React.ReactNode }[] = [
  { id: 'pending',   label: 'Pending',             icon: <Clock size={14} /> },
  { id: 'in_review', label: 'In Review',           icon: <ImageIcon size={14} /> },
  { id: 'approved',  label: 'Completed / Published', icon: <CheckCircle2 size={14} /> },
  { id: 'rejected',  label: 'Rejected',            icon: <XCircle size={14} /> },
]

function QueueNav({
  selected, onSelect, counts, isAdmin,
}: {
  selected: QueueNode
  onSelect: (n: QueueNode) => void
  counts: Record<string, number>
  isAdmin: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5 p-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-2 py-1">Image Queue</p>
      {QUEUE_NODES.map(node => {
        if (node.id === 'rejected' && !isAdmin) return null
        const count = node.id === 'pending'
          ? (counts.pending ?? 0) + (counts.generating ?? 0)
          : counts[node.id] ?? 0
        return (
          <button
            key={node.id}
            onClick={() => onSelect(node.id)}
            className={[
              'flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors',
              selected === node.id
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-foreground hover:bg-muted/60',
            ].join(' ')}
          >
            {node.icon}
            <span className="flex-1">{node.label}</span>
            {count > 0 && (
              <span className="ml-auto text-xs font-medium bg-muted rounded px-1.5 py-0.5 tabular-nums">
                {count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ── Reject dialog ─────────────────────────────────────────────────────────────

function RejectDialog({ job, onClose }: { job: ImageGenerationJob; onClose: () => void }) {
  const reject = useRejectImage()
  const [reason, setReason] = React.useState('')
  const [error, setError] = React.useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (reason.trim().length < 10) { setError('Reason must be at least 10 characters'); return }
    reject.mutate({ jobId: job.id, reason: reason.trim() }, { onSuccess: onClose, onError: () => setError('Failed to reject') })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-96 p-4">
        <h3 className="text-sm font-semibold mb-1">Decline Image</h3>
        <p className="text-xs text-muted-foreground mb-3">Please describe why this image was rejected (min 10 characters).</p>
        <form onSubmit={handleSubmit} className="space-y-3">
          <textarea
            value={reason}
            onChange={e => { setReason(e.target.value); setError('') }}
            rows={4}
            placeholder="Reason for rejection…"
            className="w-full border rounded px-2 py-1.5 text-xs bg-background resize-none"
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-xs px-3 h-7 rounded border hover:bg-muted/50 transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={reject.isPending}
              className="flex items-center gap-1.5 text-xs px-3 h-7 rounded bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              {reject.isPending && <Loader2 size={11} className="animate-spin" />}
              Decline
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Edit prompt dialog (admin) ────────────────────────────────────────────────

function EditPromptDialog({ job, onClose }: { job: ImageGenerationJob; onClose: () => void }) {
  const edit = useEditImagePrompt()
  const requeue = useRequeueImage()
  const [context, setContext] = React.useState(job.prompt_context ?? '')
  const [error, setError] = React.useState('')

  function handleSaveAndRequeue(e: React.FormEvent) {
    e.preventDefault()
    edit.mutate(
      { jobId: job.id, data: { prompt_context: context } },
      {
        onSuccess: () => {
          requeue.mutate(job.id, { onSuccess: onClose, onError: () => setError('Requeue failed') })
        },
        onError: () => setError('Failed to save prompt'),
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border rounded-lg shadow-lg w-[480px] p-4">
        <h3 className="text-sm font-semibold mb-3">Edit Prompt & Requeue</h3>
        <form onSubmit={handleSaveAndRequeue} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Prompt context</label>
            <textarea
              value={context}
              onChange={e => { setContext(e.target.value); setError('') }}
              rows={6}
              className="w-full border rounded px-2 py-1.5 text-xs bg-background resize-none font-mono"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="text-xs px-3 h-7 rounded border hover:bg-muted/50">Cancel</button>
            <button
              type="submit"
              disabled={edit.isPending || requeue.isPending}
              className="flex items-center gap-1.5 text-xs px-3 h-7 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {(edit.isPending || requeue.isPending) && <Loader2 size={11} className="animate-spin" />}
              Save & Requeue
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Pending queue grid ────────────────────────────────────────────────────────

function PendingGrid({ canGenerate }: { canGenerate: boolean }) {
  const qc = useQueryClient()
  const { data: jobs = [], isLoading, refetch } = useImageQueue('pending')
  const generate = useGenerateImages()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['images'] })
    refetch()
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelected(prev => prev.size === jobs.length ? new Set() : new Set(jobs.map(j => j.id)))
  }
  function handleGenerate() {
    const ids = selected.size > 0 ? [...selected] : jobs.map(j => j.content_object_id)
    if (!ids.length) return
    generate.mutate({ ids }, { onSuccess: () => { setSelected(new Set()); refetch() } })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
        <span className="text-xs font-medium flex-1">Pending ({jobs.length})</span>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh queue"
          className="flex items-center gap-1 px-2 h-6 text-xs rounded border hover:bg-muted/50 disabled:opacity-50 transition-opacity"
        >
          {isLoading && <RefreshCw size={10} className="animate-spin" />}
          {!isLoading && <RefreshCw size={10} />}
        </button>
        {canGenerate && (
          <button
            onClick={handleGenerate}
            disabled={generate.isPending || (!jobs.length)}
            className="flex items-center gap-1.5 text-xs px-3 h-7 rounded bg-primary text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {generate.isPending && <Loader2 size={11} className="animate-spin" />}
            Generate Images {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        )}
      </div>
      {isLoading ? (
        <div className="flex-1 p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />)}</div>
      ) : !jobs.length ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No pending items</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr className="border-b">
                <th className="px-3 py-2 w-8">
                  <input type="checkbox" checked={selected.size === jobs.length && jobs.length > 0} onChange={toggleAll} className="rounded" />
                </th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Article Title</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Requested</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Status</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(job.id)} onChange={() => toggleSelect(job.id)} className="rounded" />
                  </td>
                  <td className="px-3 py-2 font-medium">{job.content_title ?? '(no title)'}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{relativeTime(job.created_at)}</td>
                  <td className="px-3 py-2"><StatusBadge status={job.image_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── In Review queue grid ──────────────────────────────────────────────────────

function InReviewGrid({ canReview }: { canReview: boolean }) {
  const qc = useQueryClient()
  const { data: allJobs = [], isLoading, refetch } = useImageQueue('in_review')
  const checkout = useCheckoutImages()
  const approve = useApproveImage()
  const approveAll = useApproveAllImages()
  const [showMyItems, setShowMyItems] = React.useState(false)
  const [rejectTarget, setRejectTarget] = React.useState<ImageGenerationJob | null>(null)
  const [previewJob, setPreviewJob] = React.useState<ImageGenerationJob | null>(null)
  const { data: myJobs = [] } = useImageQueue('in_review', true)

  const displayJobs = showMyItems ? myJobs : allJobs
  const hasMyItems = myJobs.length > 0

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['images'] })
    refetch()
  }

  function handleCheckout() {
    checkout.mutate(undefined, { onSuccess: () => { setShowMyItems(true); refetch() } })
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0 flex-wrap">
        <span className="text-xs font-medium flex-1">In Review ({allJobs.length})</span>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh queue"
          className="flex items-center gap-1 px-2 h-6 text-xs rounded border hover:bg-muted/50 disabled:opacity-50 transition-opacity"
        >
          {isLoading && <RefreshCw size={10} className="animate-spin" />}
          {!isLoading && <RefreshCw size={10} />}
        </button>
        {canReview && (
          <>
            {hasMyItems && (
              <>
                <button
                  onClick={() => setShowMyItems(s => !s)}
                  className="text-xs px-2 h-6 rounded border hover:bg-muted/50 transition-colors"
                >
                  {showMyItems ? 'Show All' : `My Items (${myJobs.length})`}
                </button>
                <button
                  onClick={() => approveAll.mutate(undefined, { onSuccess: () => refetch() })}
                  disabled={approveAll.isPending}
                  className="flex items-center gap-1 text-xs px-2 h-6 rounded bg-green-600 text-white hover:opacity-90 disabled:opacity-50"
                >
                  {approveAll.isPending && <Loader2 size={10} className="animate-spin" />}
                  <CheckCheck size={10} />
                  Approve All
                </button>
              </>
            )}
            <button
              onClick={handleCheckout}
              disabled={checkout.isPending}
              className="flex items-center gap-1 text-xs px-2 h-6 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {checkout.isPending && <Loader2 size={10} className="animate-spin" />}
              Check Out for Review
            </button>
          </>
        )}
      </div>
      {isLoading ? (
        <div className="flex-1 p-4 space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-muted/40 animate-pulse rounded" />)}</div>
      ) : !displayJobs.length ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No items in review</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[108px]">Thumbnail</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Article Title</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Generated</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">Reviewer</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[270px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {displayJobs.map(job => (
                <tr key={job.id} className="border-b hover:bg-muted/30 transition-colors" style={{ minHeight: '100px' }}>
                  <td className="px-3 py-2">
                    <button onClick={() => setPreviewJob(job)}>
                      <Thumbnail url={job.image_url} size={80} />
                    </button>
                  </td>
                  <td className="px-3 py-2 font-medium">{job.content_title ?? '(no title)'}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{relativeTime(job.created_at)}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate max-w-[140px]">
                    {job.reviewer_id ?? 'Unassigned'}
                  </td>
                  <td className="px-3 py-2">
                    {canReview && (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPreviewJob(job)}
                          className="px-2 h-6 text-xs rounded border hover:bg-muted/50"
                        >
                          Review
                        </button>
                        <button
                          onClick={() => approve.mutate(job.id, { onSuccess: () => refetch() })}
                          disabled={approve.isPending}
                          className="px-2 h-6 text-xs rounded bg-green-600 text-white hover:opacity-90 disabled:opacity-50"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => setRejectTarget(job)}
                          className="px-2 h-6 text-xs rounded bg-red-600 text-white hover:opacity-90"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Full-size preview modal */}
      {previewJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setPreviewJob(null)}>
          <div className="relative max-w-4xl max-h-[90vh] p-2" onClick={e => e.stopPropagation()}>
            <button onClick={() => setPreviewJob(null)} className="absolute -top-3 -right-3 bg-background border rounded-full p-1">
              <X size={14} />
            </button>
            {previewJob.image_url ? (
              <img src={previewJob.image_url} alt="Preview" className="max-h-[80vh] rounded shadow-xl" />
            ) : (
              <div className="w-96 h-64 bg-muted rounded flex items-center justify-center text-muted-foreground text-sm">No image available</div>
            )}
            <p className="text-center text-xs text-white mt-2">{previewJob.content_title}</p>
          </div>
        </div>
      )}

      {rejectTarget && <RejectDialog job={rejectTarget} onClose={() => setRejectTarget(null)} />}
    </div>
  )
}

// ── Completed queue grid ──────────────────────────────────────────────────────

function CompletedGrid() {
  const qc = useQueryClient()
  const { data: jobs = [], isLoading, refetch } = useImageQueue('approved')
  const regenerate = useRegenerateImage()
  const [regeneratingIds, setRegeneratingIds] = React.useState<Set<string>>(new Set())
  const [regeneratingCount, setRegeneratingCount] = React.useState(0)

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['images'] })
    refetch()
  }

  const handleRegenerate = (jobId: string) => {
    setRegeneratingIds(prev => new Set([...prev, jobId]))
    setRegeneratingCount(prev => prev + 1)

    regenerate.mutate(jobId, {
      onSuccess: () => {
        console.log(`✅ Regeneration submitted for job ${jobId}`)
        // Keep the regenerating state for a bit longer while polling happens
        // Don't clear it until the next refetch shows the updated image
      },
      onError: (error) => {
        console.error('Regeneration failed:', error)
        setRegeneratingIds(prev => {
          const next = new Set(prev)
          next.delete(jobId)
          return next
        })
        setRegeneratingCount(prev => Math.max(0, prev - 1))
        alert(`Failed to regenerate image: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    })
  }

  // Update regenerating state based on actual job data
  React.useEffect(() => {
    if (jobs.length > 0) {
      const stillRegenerating = new Set<string>()
      let count = 0
      for (const job of jobs) {
        // Check if job is being regenerated by looking at gpu_job_status
        const isRegenerating = (job as any).gpu_job_status === 'resubmitted' || regeneratingIds.has(job.id)
        if (isRegenerating) {
          stillRegenerating.add(job.id)
          count++
        }
      }
      setRegeneratingIds(stillRegenerating)
      setRegeneratingCount(count)
    }
  }, [jobs])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
        <span className="text-xs font-medium flex-1">
          Completed / Published ({jobs.length})
          {regeneratingCount > 0 && (
            <span className="ml-2 text-blue-600 font-semibold">{regeneratingCount} regenerating...</span>
          )}
        </span>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh queue"
          className="flex items-center gap-1 px-2 h-6 text-xs rounded border hover:bg-muted/50 disabled:opacity-50 transition-opacity"
        >
          {isLoading && <RefreshCw size={10} className="animate-spin" />}
          {!isLoading && <RefreshCw size={10} />}
        </button>
      </div>
      {isLoading ? (
        <div className="flex-1 p-4 space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />)}</div>
      ) : !jobs.length ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No approved images yet</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4">
            {jobs.map(job => (
              <div key={job.id} className="relative group rounded-lg overflow-hidden border hover:border-primary/50 transition-colors">
                <div className="aspect-square bg-muted/40 relative">
                  {job.image_url ? (
                    <img src={job.image_url} alt={job.content_title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                      <ImageIcon size={32} />
                    </div>
                  )}

                  {/* Red refresh circle icon - top right */}
                  <button
                    onClick={() => handleRegenerate(job.id)}
                    disabled={regeneratingIds.has(job.id)}
                    title="Regenerate image with IC API"
                    className="absolute top-2 right-2 w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 disabled:bg-red-500 text-white flex items-center justify-center shadow-lg hover:shadow-xl transition-all disabled:opacity-70"
                  >
                    {regeneratingIds.has(job.id) ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                  </button>
                </div>

                {/* Card info */}
                <div className="p-3 bg-background">
                  <p className="text-xs font-medium truncate">{job.content_title ?? '(no title)'}</p>
                  <p className="text-xs text-muted-foreground mt-1">Approved {relativeTime(job.approved_at)}</p>
                  <p className="text-xs text-muted-foreground">by {job.approved_by ?? '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Rejected queue grid (admin only) ─────────────────────────────────────────

function RejectedGrid() {
  const qc = useQueryClient()
  const { data: jobs = [], isLoading, refetch } = useImageQueue('rejected')
  const requeue = useRequeueImage()
  const archive = useArchiveImage()
  const [editTarget, setEditTarget] = React.useState<ImageGenerationJob | null>(null)

  const handleRefresh = () => {
    qc.invalidateQueries({ queryKey: ['images'] })
    refetch()
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-10 border-b shrink-0">
        <span className="text-xs font-medium flex-1">Rejected ({jobs.length})</span>
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          title="Refresh queue"
          className="flex items-center gap-1 px-2 h-6 text-xs rounded border hover:bg-muted/50 disabled:opacity-50 transition-opacity"
        >
          {isLoading && <RefreshCw size={10} className="animate-spin" />}
          {!isLoading && <RefreshCw size={10} />}
        </button>
      </div>
      {isLoading ? (
        <div className="flex-1 p-4 space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-10 bg-muted/40 animate-pulse rounded" />)}</div>
      ) : !jobs.length ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">No rejected images</div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
              <tr className="border-b">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[92px]">Thumbnail</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Article Title</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-36">Rejected By</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-44">Reason</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-32">Rejected At</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-52">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className="border-b hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2"><Thumbnail url={job.image_url} size={64} /></td>
                  <td className="px-3 py-2 font-medium">{job.content_title ?? '(no title)'}</td>
                  <td className="px-3 py-2 text-muted-foreground truncate">{job.rejected_by ?? '—'}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    <span title={job.rejection_reason ?? ''} className="block truncate max-w-[160px]">
                      {job.rejection_reason ?? '—'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{relativeTime(job.rejected_at)}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => requeue.mutate(job.id, { onSuccess: () => refetch() })}
                        disabled={requeue.isPending}
                        title="Requeue for regeneration"
                        className="flex items-center gap-1 px-2 h-6 text-xs rounded border hover:bg-muted/50 disabled:opacity-50"
                      >
                        <RotateCcw size={10} />
                        Requeue
                      </button>
                      <button
                        onClick={() => setEditTarget(job)}
                        className="flex items-center gap-1 px-2 h-6 text-xs rounded border hover:bg-muted/50"
                        title="Edit prompt and requeue"
                      >
                        Edit Prompt
                      </button>
                      <button
                        onClick={() => archive.mutate(job.id, { onSuccess: () => refetch() })}
                        disabled={archive.isPending}
                        title="Permanently archive"
                        className="flex items-center gap-1 px-2 h-6 text-xs rounded border text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
                      >
                        <Archive size={10} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editTarget && <EditPromptDialog job={editTarget} onClose={() => setEditTarget(null)} />}
    </div>
  )
}

// ── Main workspace ────────────────────────────────────────────────────────────

export function ImagesWorkspace() {
  const user = useCockpitStore(s => s.user)
  const isAdmin = user?.role === 'admin'
  const canGenerate = ['admin', 'publisher', 'editor'].includes(user?.role ?? '')
  const canReview = ['admin', 'publisher', 'reviewer'].includes(user?.role ?? '')

  const [selectedQueue, setSelectedQueue] = React.useState<QueueNode>('pending')
  const { data: counts = {} } = useImageCounts()

  function renderQueue() {
    switch (selectedQueue) {
      case 'pending':   return <PendingGrid canGenerate={canGenerate} />
      case 'in_review': return <InReviewGrid canReview={canReview} />
      case 'approved':  return <CompletedGrid />
      case 'rejected':  return isAdmin ? <RejectedGrid /> : (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Access restricted</div>
      )
    }
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left queue nav — 220px */}
      <div className="w-[220px] shrink-0 border-r flex flex-col overflow-hidden bg-background">
        <QueueNav
          selected={selectedQueue}
          onSelect={setSelectedQueue}
          counts={counts}
          isAdmin={isAdmin}
        />
      </div>

      {/* Center — queue grid */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {renderQueue()}
      </div>
    </div>
  )
}
