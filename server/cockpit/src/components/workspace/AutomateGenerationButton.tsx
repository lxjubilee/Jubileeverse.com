/**
 * AutomateGenerationButton.tsx — Section 9 Pathway 2
 *
 * Shows a small floating panel for scheduling a batch generation job
 * directly from the Content workspace InlineEditorPanel.
 *
 * Pre-fills:
 *   - target_taxonomy_node_id from Zustand selectedNodeId
 *   - target_content_type from the current content object's object_type
 *   - prompt recipe select (published prompt_recipe objects)
 *   - quantity input (default 1)
 */

import * as React from 'react'
import { CalendarClock, X, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'
import { useCockpitStore } from '../../hooks/useCockpitStore'
import { useContentList } from '../../hooks/useContent'
import { useCreateAutomationJob } from '../../hooks/useAutomationJobs'
import type { ContentObject } from '../../types/content-objects'

// Content types that support automation
const AUTOMATABLE_TYPES = new Set([
  'article', 'blog_post', 'page', 'news_item', 'devotional',
  'prayer', 'music', 'radio_episode', 'podcast', 'social_snippet',
])

interface AutomateGenerationButtonProps {
  item: ContentObject
}

export function AutomateGenerationButton({ item }: AutomateGenerationButtonProps) {
  const selectedNodeId = useCockpitStore(s => s.selectedNodeId)

  const [open, setOpen]           = React.useState(false)
  const [promptId, setPromptId]   = React.useState('')
  const [quantity, setQuantity]   = React.useState(1)
  const [priority, setPriority]   = React.useState(3)
  const [jobName, setJobName]     = React.useState(`Generate ${item.title ?? item.object_type}`)
  const [result, setResult]       = React.useState<string | null>(null)
  const [errMsg, setErrMsg]       = React.useState<string | null>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)

  const createJob = useCreateAutomationJob()

  const { data: recipesData } = useContentList({ type: 'prompt_recipe', status: 'published', limit: 200 })
  const recipes = recipesData?.items ?? []

  // Only show for automatable content types
  if (!AUTOMATABLE_TYPES.has(item.object_type)) return null

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function handleOpen() {
    setOpen(o => !o)
    setResult(null)
    setErrMsg(null)
    setJobName(`Generate ${item.title ?? item.object_type}`)
    setQuantity(1)
    setPriority(3)
  }

  async function handleSchedule() {
    setResult(null)
    setErrMsg(null)
    try {
      const created = await createJob.mutateAsync({
        name:                   jobName || `Generate ${item.object_type}`,
        target_content_type:    item.object_type,
        target_taxonomy_node_id: selectedNodeId ?? undefined,
        prompt_recipe_id:       promptId || null,
        quantity,
        priority,
        identity_type:          'system',
      })
      setResult(created.job.id)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to create job')
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={handleOpen}
        className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        aria-label="Schedule batch generation job"
        title="Automate Generation"
        disabled={createJob.isPending}
      >
        {createJob.isPending
          ? <Loader2 size={13} className="animate-spin" />
          : <CalendarClock size={13} />
        }
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-72 rounded-md border bg-popover shadow-md text-xs">
          <div className="flex items-center justify-between px-3 py-2 border-b">
            <span className="font-medium">Automate Generation</span>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
              <X size={11} />
            </button>
          </div>

          <div className="p-3 space-y-2.5">
            <div>
              <label className="block text-muted-foreground mb-1">Job Name</label>
              <input
                className="w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={jobName}
                onChange={e => setJobName(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-muted-foreground mb-1">
                Prompt Recipe
                {!promptId && <span className="text-amber-600 ml-1">(required for execution)</span>}
              </label>
              <select
                className="w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={promptId}
                onChange={e => setPromptId(e.target.value)}
              >
                <option value="">— None —</option>
                {recipes.map(r => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-muted-foreground mb-1">Qty</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, Math.min(100, Number(e.target.value))))}
                />
              </div>
              <div className="flex-1">
                <label className="block text-muted-foreground mb-1">Priority</label>
                <select
                  className="w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  value={priority}
                  onChange={e => setPriority(Number(e.target.value))}
                >
                  <option value={1}>1-Critical</option>
                  <option value={2}>2-High</option>
                  <option value={3}>3-Normal</option>
                  <option value={4}>4-Low</option>
                  <option value={5}>5-Bg</option>
                </select>
              </div>
            </div>
            {selectedNodeId && (
              <div className="text-muted-foreground">
                Target node: <span className="font-medium">{selectedNodeId}</span>
              </div>
            )}
          </div>

          <div className="px-3 pb-3">
            <button
              onClick={handleSchedule}
              disabled={createJob.isPending}
              className="w-full py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {createJob.isPending ? 'Scheduling…' : 'Schedule Job'}
            </button>
          </div>

          {result && (
            <div className="px-3 py-2 border-t flex items-center gap-1.5 text-green-700">
              <CheckCircle size={10} />
              <span>Job queued successfully.</span>
            </div>
          )}
          {errMsg && (
            <div className="px-3 py-2 border-t flex items-start gap-1.5 text-destructive">
              <AlertTriangle size={10} className="shrink-0 mt-0.5" />
              <span className="break-words">{errMsg}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
