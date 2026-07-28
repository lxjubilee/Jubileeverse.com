/**
 * ImagesGrid.tsx — Image gallery for content objects in the selected taxonomy node.
 * Header shows "X of Y articles have images" with a "Generate Images" button.
 * Reviewer+ users can batch-generate missing images via IC API (RTX 5090).
 * Per-image refresh button sits in the upper-right corner of each card.
 * Jobs are polled every 5 s; new images appear live without page reload.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCockpitStore } from '../../../hooks/useCockpitStore'
import { useContentSearch } from '../../../hooks/useContent'
import {
  regenerateJVArticleImage,
  batchGenerateJVImages,
  getImageJobStatus,
  type JVBatchGenerateJob,
} from '../../../lib/api'
import type { ContentObject } from '../../../types/content-objects'

const ARTICLE_TYPES = 'article,blog_post,page,news_item,devotional'

interface ImagesGridProps {
  onRowSelect: (id: string) => void
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        width: 13, height: 13, pointerEvents: 'none',
        transition: 'transform 0.4s ease',
        transform: spinning ? 'rotate(360deg)' : 'none',
      }}
    >
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 .49-4.59" />
    </svg>
  )
}

export function ImagesGrid({ onRowSelect }: ImagesGridProps) {
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)

  // Per-card state
  const [refreshing, setRefreshing]     = useState<Record<string, boolean>>({})
  const [imgVersions, setImgVersions]   = useState<Record<string, number>>({})
  // Live additions as batch jobs complete: articleId → imagePath
  const [localImages, setLocalImages]   = useState<Record<string, string>>({})

  // Batch generation
  const [pendingJobs, setPendingJobs]   = useState<JVBatchGenerateJob[]>([])
  const pendingJobsRef                  = useRef<JVBatchGenerateJob[]>([])
  pendingJobsRef.current                = pendingJobs

  const [showQtyForm, setShowQtyForm]   = useState(false)
  const [generateQty, setGenerateQty]   = useState(20)
  const [generating, setGenerating]     = useState(false)
  const [genMessage, setGenMessage]     = useState('')

  // Query client for cache invalidation
  const queryClient = useQueryClient()

  // Fetch ALL articles in this taxonomy (with + without images)
  const { data, isLoading } = useContentSearch(
    selectedNodeId
      ? { type: ARTICLE_TYPES, taxonomy_node_id: selectedNodeId, limit: 500 }
      : {}
  )

  const items: ContentObject[] = (data?.items ?? []) as ContentObject[]

  // Items that currently have an image (DB or locally generated)
  const withImages = items.filter(item => {
    const dbPath = (item.extension_data as Record<string, unknown>)?.hero_image_path
    return !!(dbPath || localImages[item.id])
  })

  const totalCount = items.length
  const imageCount = withImages.length

  // Reset local state whenever the user navigates to a different category
  useEffect(() => {
    setLocalImages({})
    setPendingJobs([])
    setShowQtyForm(false)
    setGenerating(false)
    setGenMessage('')
  }, [selectedNodeId])

  // Poll pending jobs every 5 s; only run when jobs exist
  const isPolling = pendingJobs.length > 0
  useEffect(() => {
    if (!isPolling) return

    const interval = setInterval(async () => {
      const current = pendingJobsRef.current
      if (current.length === 0) return

      const stillPending: JVBatchGenerateJob[] = []
      for (const job of current) {
        try {
          const result = await getImageJobStatus(job.jobId)
          if (result.status === 'completed') {
            const imagePath = result.imagePath ?? job.imagePath
            setLocalImages(prev => ({ ...prev, [job.articleId]: imagePath }))
            setImgVersions(prev => ({ ...prev, [job.articleId]: Date.now() }))
            // CRITICAL: Invalidate content search cache so UI fetches updated hero_image_path
            queryClient.invalidateQueries({ queryKey: ['content', 'search'] })
          } else if (result.status === 'pending') {
            stillPending.push(job)
          }
          // failed / not_found → drop silently
        } catch {
          stillPending.push(job) // keep on network error
        }
      }

      setPendingJobs(stillPending)
      if (stillPending.length === 0) {
        setGenerating(false)
        setGenMessage(`Done — ${imageCount} image${imageCount !== 1 ? 's' : ''} in this category.`)
      }
    }, 5000)

    return () => clearInterval(interval)
  }, [isPolling, queryClient]) // eslint-disable-line react-hooks/exhaustive-deps

  // Batch generate handler
  const handleGenerate = useCallback(async () => {
    if (!selectedNodeId || generating) return
    setGenerating(true)
    setShowQtyForm(false)
    setGenMessage(`Queuing ${generateQty} generation${generateQty !== 1 ? 's' : ''}…`)
    try {
      const result = await batchGenerateJVImages(selectedNodeId, generateQty)
      if (result.jobs.length === 0) {
        setGenMessage('All articles already have images.')
        setGenerating(false)
        return
      }
      setGenMessage(`Generating ${result.queued} image${result.queued !== 1 ? 's' : ''}…`)
      setPendingJobs(result.jobs)
    } catch {
      setGenMessage('Failed to start batch generation.')
      setGenerating(false)
    }
  }, [selectedNodeId, generateQty, generating])

  // Per-card refresh handler
  const handleRefresh = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (refreshing[id]) return
    setRefreshing(prev => ({ ...prev, [id]: true }))
    try {
      const result = await regenerateJVArticleImage(id)
      if (result.jobId) {
        const imagePath = result.imagePath ?? localImages[id] ?? ''
        // Add to polling queue so the image updates live when done
        setPendingJobs(prev => [
          ...prev,
          { articleId: id, title: '', jobId: result.jobId!, imagePath },
        ])
      }
      // Bump version immediately to show any prior change
      setImgVersions(prev => ({ ...prev, [id]: Date.now() }))
    } catch {
      // silent — image stays as-is
    } finally {
      setRefreshing(prev => ({ ...prev, [id]: false }))
    }
  }, [refreshing, localImages])

  // ── Early returns ─────────────────────────────────────────────────────────────

  if (!selectedNodeId) {
    return (
      <p className="text-xs text-muted-foreground p-6 text-center">
        Select a taxonomy category to browse its images.
      </p>
    )
  }

  if (isLoading) {
    return <p className="text-xs text-muted-foreground p-4">Loading…</p>
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="p-3">
      {/* Header: count on left, generate button on right */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{imageCount}</span>
          {' of '}
          <span className="font-medium text-foreground">{totalCount}</span>
          {' articles have images'}
          {pendingJobs.length > 0 && (
            <span className="ml-2 text-amber-600 font-medium">
              · {pendingJobs.length} generating…
            </span>
          )}
        </p>

        <div className="flex items-center gap-2 shrink-0">
          {genMessage && !showQtyForm && (
            <span className="text-xs text-muted-foreground">{genMessage}</span>
          )}
          {showQtyForm ? (
            <form
              className="flex items-center gap-1.5"
              onSubmit={e => { e.preventDefault(); void handleGenerate() }}
            >
              <label className="text-xs text-muted-foreground">Qty:</label>
              <input
                type="number"
                min={1}
                max={200}
                value={generateQty}
                onChange={e =>
                  setGenerateQty(Math.max(1, Math.min(200, parseInt(e.target.value) || 1)))
                }
                className="w-16 text-xs border rounded px-1.5 py-1 bg-background"
                autoFocus
              />
              <button
                type="submit"
                className="text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
              >
                Go
              </button>
              <button
                type="button"
                onClick={() => setShowQtyForm(false)}
                className="text-xs px-2 py-1 rounded text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => setShowQtyForm(true)}
              disabled={generating}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {generating ? 'Generating…' : 'Generate Images'}
            </button>
          )}
        </div>
      </div>

      {/* Grid or empty state */}
      {withImages.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-10">
          {totalCount > 0
            ? 'No images in this category yet. Click "Generate Images" to create them.'
            : 'No articles found in this category.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {withImages.map(item => {
            const dbPath       = String((item.extension_data as Record<string, unknown>).hero_image_path ?? '')
            const effectivePath = localImages[item.id] ?? dbPath
            const version      = imgVersions[item.id]
            const src          = version ? `${effectivePath}?t=${version}` : effectivePath
            const isRefreshing = !!refreshing[item.id]
            const isGenerating = pendingJobs.some(j => j.articleId === item.id)
            const spinning     = isRefreshing || isGenerating

            return (
              <div
                key={item.id}
                className="group relative rounded-md overflow-hidden border bg-muted aspect-video hover:border-[#ca9a00] transition-colors"
              >
                {/* Image click → open editor */}
                <button
                  className="absolute inset-0 w-full h-full focus:outline-none"
                  onClick={() => onRowSelect(item.id)}
                  title={item.title ?? undefined}
                >
                  <img
                    src={src}
                    alt={item.title ?? ''}
                    className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                    loading="lazy"
                    onError={e => {
                      const card = (e.currentTarget as HTMLElement).closest('.aspect-video') as HTMLElement
                      if (card) card.style.display = 'none'
                    }}
                  />
                </button>

                {/* Refresh button — upper-right */}
                <button
                  className="absolute top-1.5 right-1.5 z-10 flex items-center justify-center rounded-full text-white transition-colors focus:outline-none"
                  style={{
                    width: 26, height: 26,
                    background: spinning ? 'rgba(183,28,28,0.7)' : 'rgba(198,40,40,0.92)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.45)',
                    opacity: spinning ? 0.7 : undefined,
                  }}
                  onClick={e => handleRefresh(e, item.id)}
                  title="Regenerate image via IC API"
                  disabled={spinning}
                >
                  <RefreshIcon spinning={spinning} />
                </button>

                {/* Title overlay — slides up on hover */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 translate-y-full group-hover:translate-y-0 transition-transform duration-200 pointer-events-none">
                  <p className="text-white text-[10px] leading-tight line-clamp-2 font-medium">
                    {item.title}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
