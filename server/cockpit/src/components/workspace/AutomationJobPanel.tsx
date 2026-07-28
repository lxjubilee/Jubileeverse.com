/**
 * AutomationJobPanel.tsx — Right panel for the Automation workspace
 *
 * Status-dependent rendering:
 *   - queued / paused / isNew:        Editable form + Run/Pause/Cancel footer
 *   - running / retrying:             Editable form (limited) + Run/Pause/Cancel footer
 *   - completed / failed / cancelled: Read-only detail view + Close/Retry footer
 */

import * as React from 'react'
import { X } from 'lucide-react'
import { CollapsibleSection } from './prompt-editor/CollapsibleSection'
import { Badge } from '../ui/Badge'
import { ScrollArea } from '../ui/ScrollArea'
import { useContentList } from '../../hooks/useContent'
import {
  useAutomationJob,
  useCreateAutomationJob,
  useUpdateAutomationJob,
  useRunAutomationJob,
  usePauseAutomationJob,
  useCancelAutomationJob,
  useRetryAutomationJob,
} from '../../hooks/useAutomationJobs'
import { ConnectAccountSection } from './ConnectAccountSection'
import type { AutomationJob } from '../../lib/api'

const MonacoEditor = React.lazy(() => import('@monaco-editor/react'))

function MonacoFallback({ height }: { height: string }) {
  return (
    <div
      style={{ height }}
      className="rounded border bg-muted animate-pulse flex items-center justify-center text-xs text-muted-foreground"
    >
      Loading editor…
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AutomationJob['status'] | 'new' }) {
  const map: Record<string, { label: string; variant: 'secondary' | 'success' | 'destructive' | 'warning' | 'outline' }> = {
    new:       { label: 'New',       variant: 'outline' },
    queued:    { label: 'Queued',    variant: 'secondary' },
    running:   { label: 'Running',   variant: 'warning' },
    paused:    { label: 'Paused',    variant: 'secondary' },
    retrying:  { label: 'Retrying',  variant: 'warning' },
    completed: { label: 'Completed', variant: 'success' },
    failed:    { label: 'Failed',    variant: 'destructive' },
    cancelled: { label: 'Cancelled', variant: 'secondary' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'outline' }
  return <Badge variant={variant}>{label}</Badge>
}

// ── Timestamp helpers ─────────────────────────────────────────────────────────

function fmt(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── Editable form ─────────────────────────────────────────────────────────────

interface EditableFormProps {
  job: AutomationJob | null   // null = new job
  automationNodeId: string | null
  onClose: () => void
}

function EditableForm({ job, automationNodeId, onClose }: EditableFormProps) {
  const isNew = !job

  const [name, setName] = React.useState(job?.name ?? '')
  const [priority, setPriority] = React.useState(job?.priority ?? 3)
  const [identityType, setIdentityType] = React.useState<'system' | 'user'>(
    job?.identity_type ?? 'system',
  )
  const [identityId, setIdentityId] = React.useState(job?.identity_id ?? '')
  const [contentType, setContentType] = React.useState(
    job?.target_content_type ?? 'article',
  )
  const [promptRecipeId, setPromptRecipeId] = React.useState(
    job?.prompt_recipe_id ?? '',
  )
  const [targetTaxonomyNodeId, setTargetTaxonomyNodeId] = React.useState(
    job?.target_taxonomy_node_id ? String(job.target_taxonomy_node_id) : '',
  )
  const [quantity, setQuantity] = React.useState(job?.quantity ?? 1)
  const [maxRetries, setMaxRetries] = React.useState(job?.max_retries ?? 3)
  const [parameters, setParameters] = React.useState(
    JSON.stringify(job?.parameters ?? {}, null, 2),
  )
  const [saving, setSaving] = React.useState(false)
  const [saved, setSaved] = React.useState(false)

  const createJob = useCreateAutomationJob()
  const updateJob = useUpdateAutomationJob()
  const runJob    = useRunAutomationJob()
  const pauseJob  = usePauseAutomationJob()
  const cancelJob = useCancelAutomationJob()

  // Prompt recipes dropdown — published prompt_recipe objects
  const { data: recipesData } = useContentList({ type: 'prompt_recipe', status: 'published', limit: 200 })
  const recipes = recipesData?.items ?? []

  async function handleSave() {
    setSaving(true)
    try {
      let parsedParams: Record<string, unknown> = {}
      try { parsedParams = JSON.parse(parameters) } catch { /* use empty */ }

      const payload = {
        name,
        quantity,
        priority,
        identity_type: identityType,
        identity_id: identityId || null,
        target_content_type: contentType,
        prompt_recipe_id: promptRecipeId || null,
        target_taxonomy_node_id: targetTaxonomyNodeId ? Number(targetTaxonomyNodeId) : null,
        max_retries: maxRetries,
        parameters: parsedParams,
        automation_node_id: automationNodeId,
      }

      if (isNew) {
        if (!name.trim()) { alert('Job name is required.'); setSaving(false); return }
        await createJob.mutateAsync({ ...payload, name })
      } else {
        await updateJob.mutateAsync({ id: job.id, data: payload })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  async function handleRunNow() {
    if (!job) return
    await runJob.mutateAsync(job.id)
  }

  async function handlePause() {
    if (!job) return
    await pauseJob.mutateAsync(job.id)
  }

  async function handleCancel() {
    if (!job) return
    if (!confirm('Cancel this job?')) return
    await cancelJob.mutateAsync(job.id)
  }

  const isRunning = job?.status === 'running' || job?.status === 'retrying'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className="flex-1 truncate font-semibold text-sm">
          {isNew ? 'New Job' : name}
        </span>
        <StatusBadge status={isNew ? 'new' : (job?.status ?? 'queued')} />
        <button
          onClick={onClose}
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted"
        >
          <X size={14} />
        </button>
      </div>

      {/* Form body */}
      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-1">
          <CollapsibleSection title="Identity & Configuration">
            <div className="space-y-3 pb-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Job Name *</label>
                <input
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Generate Daily Articles"
                />
              </div>
              {job?.automation_node_title && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">Automation Node</label>
                  <span className="text-sm">{job.automation_node_title}</span>
                </div>
              )}
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Priority</label>
                <select
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={priority}
                  onChange={e => setPriority(Number(e.target.value))}
                >
                  <option value={1}>1 — Critical</option>
                  <option value={2}>2 — High</option>
                  <option value={3}>3 — Normal</option>
                  <option value={4}>4 — Low</option>
                  <option value={5}>5 — Background</option>
                </select>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs text-muted-foreground mb-1">Identity Type</label>
                  <select
                    className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    value={identityType}
                    onChange={e => setIdentityType(e.target.value as 'system' | 'user')}
                  >
                    <option value="system">System</option>
                    <option value="user">User</option>
                  </select>
                </div>
                {identityType === 'user' && (
                  <div className="flex-1">
                    <label className="block text-xs text-muted-foreground mb-1">Identity ID</label>
                    <input
                      className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                      value={identityId}
                      onChange={e => setIdentityId(e.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                )}
              </div>
              {identityType === 'user' && identityId && (
                <div>
                  <label className="block text-xs text-muted-foreground mb-1.5">Execution Account</label>
                  <ConnectAccountSection userEmail={identityId} provider="anthropic" />
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Content Target">
            <div className="space-y-3 pb-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Content Type</label>
                <select
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={contentType}
                  onChange={e => setContentType(e.target.value)}
                >
                  <option value="article">Article</option>
                  <option value="prayer">Prayer</option>
                  <option value="music">Music</option>
                  <option value="radio_episode">Radio Episode</option>
                  <option value="podcast">Podcast</option>
                  <option value="social_snippet">Social Snippet</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Prompt Recipe</label>
                <select
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={promptRecipeId}
                  onChange={e => setPromptRecipeId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {recipes.map(r => (
                    <option key={r.id} value={r.id}>{r.title}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Target Taxonomy Node ID
                </label>
                <input
                  type="number"
                  className="w-full rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={targetTaxonomyNodeId}
                  onChange={e => setTargetTaxonomyNodeId(e.target.value)}
                  placeholder="e.g. 64166"
                />
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Parameters">
            <div className="pb-2">
              <React.Suspense fallback={<MonacoFallback height="180px" />}>
                <MonacoEditor
                  height="180px"
                  language="json"
                  value={parameters}
                  onChange={v => setParameters(v ?? '')}
                  options={{
                    minimap: { enabled: false },
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                  }}
                />
              </React.Suspense>
            </div>
          </CollapsibleSection>

          <CollapsibleSection title="Retry Settings">
            <div className="space-y-3 pb-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Quantity <span className="text-muted-foreground font-normal">(objects to generate)</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="w-32 rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={quantity}
                  onChange={e => setQuantity(Math.max(1, Math.min(100, Number(e.target.value))))}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">Max Retries</label>
                <input
                  type="number"
                  min={0}
                  max={10}
                  className="w-32 rounded border px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  value={maxRetries}
                  onChange={e => setMaxRetries(Number(e.target.value))}
                />
              </div>
            </div>
          </CollapsibleSection>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save Changes'}
        </button>
        {!isNew && !isRunning && (
          <button
            onClick={handleRunNow}
            className="px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-muted"
          >
            Run Now
          </button>
        )}
        {!isNew && !isRunning && (
          <button
            onClick={handlePause}
            className="px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-muted"
          >
            Pause
          </button>
        )}
        {!isNew && (
          <button
            onClick={handleCancel}
            className="px-3 py-1.5 rounded-md text-xs font-medium border text-destructive hover:bg-muted"
          >
            Cancel Job
          </button>
        )}
      </div>
    </div>
  )
}

// ── Read-only detail view ─────────────────────────────────────────────────────

interface ReadOnlyDetailProps {
  job: AutomationJob
  onClose: () => void
}

function ReadOnlyDetail({ job, onClose }: ReadOnlyDetailProps) {
  const retryJob = useRetryAutomationJob()

  async function handleRetry() {
    await retryJob.mutateAsync(job.id)
    onClose()
  }

  // Prefer aggregated token_usage JSONB from worker; fall back to individual columns
  const tokenSrc = job.token_usage ?? {
    input_tokens:  job.input_tokens  ?? 0,
    output_tokens: job.output_tokens ?? 0,
    total_tokens:  (job.input_tokens ?? 0) + (job.output_tokens ?? 0),
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b">
        <span className="flex-1 truncate font-semibold text-sm">{job.name}</span>
        <StatusBadge status={job.status} />
        <button
          onClick={onClose}
          className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted"
        >
          <X size={14} />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-3 space-y-1">
          {/* Configuration summary */}
          <CollapsibleSection title="Configuration Summary">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pb-2 text-sm">
              <span className="text-muted-foreground text-xs">Content Type</span>
              <span className="text-xs">
                <Badge variant="outline">{job.target_content_type}</Badge>
              </span>
              <span className="text-muted-foreground text-xs">Prompt</span>
              <span className="text-xs truncate">{job.prompt_name ?? '—'}</span>
              <span className="text-muted-foreground text-xs">Priority</span>
              <span className="text-xs">{job.priority}</span>
              <span className="text-muted-foreground text-xs">Identity</span>
              <span className="text-xs">{job.identity_id ?? 'System'}</span>
              <span className="text-muted-foreground text-xs">Requested By</span>
              <span className="text-xs truncate">{job.requested_by}</span>
            </div>
          </CollapsibleSection>

          {/* Execution timeline */}
          <CollapsibleSection title="Execution Timeline">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pb-2 text-sm">
              <span className="text-muted-foreground text-xs">Created</span>
              <span className="text-xs">{fmt(job.created_at)}</span>
              <span className="text-muted-foreground text-xs">Started</span>
              <span className="text-xs">{fmt(job.started_at)}</span>
              <span className="text-muted-foreground text-xs">Completed</span>
              <span className="text-xs">{fmt(job.completed_at)}</span>
              <span className="text-muted-foreground text-xs">Duration</span>
              <span className="text-xs">{formatDuration(job.duration_ms)}</span>
            </div>
          </CollapsibleSection>

          {/* Output objects */}
          <CollapsibleSection title="Output">
            <div className="pb-2 text-xs">
              {job.output_object_ids.length > 0 ? (
                <span>{job.output_object_ids.length} article{job.output_object_ids.length !== 1 ? 's' : ''} generated</span>
              ) : (
                <span className="text-muted-foreground">No output objects.</span>
              )}
            </div>
          </CollapsibleSection>

          {/* Token usage */}
          <CollapsibleSection title="Token Usage">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 pb-2">
              <span className="text-muted-foreground text-xs">Input</span>
              <span className="text-xs">{tokenSrc.input_tokens > 0 ? tokenSrc.input_tokens.toLocaleString() : '—'}</span>
              <span className="text-muted-foreground text-xs">Output</span>
              <span className="text-xs">{tokenSrc.output_tokens > 0 ? tokenSrc.output_tokens.toLocaleString() : '—'}</span>
              <span className="text-muted-foreground text-xs">Total</span>
              <span className="text-xs">{tokenSrc.total_tokens > 0 ? tokenSrc.total_tokens.toLocaleString() : '—'}</span>
              <span className="text-muted-foreground text-xs">Cost</span>
              <span className="text-xs">—</span>
            </div>
          </CollapsibleSection>

          {/* Execution log */}
          <CollapsibleSection title="Execution Log" defaultOpen={false}>
            {job.execution_log_entries && job.execution_log_entries.length > 0 ? (
              <div className="space-y-0.5 max-h-60 overflow-auto pb-2">
                {job.execution_log_entries.map((entry, i) => (
                  <div key={i} className="flex gap-2 text-xs font-mono">
                    <span className="text-muted-foreground shrink-0">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                    <span className={entry.level === 'error' ? 'text-destructive' : entry.level === 'warn' ? 'text-amber-600' : ''}>
                      {entry.message}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="text-xs font-mono overflow-auto max-h-60 bg-muted rounded p-2 whitespace-pre-wrap break-all">
                {job.execution_log || 'No log available.'}
              </pre>
            )}
          </CollapsibleSection>

          {/* Error */}
          {job.error_message && (
            <CollapsibleSection title="Error">
              <pre className="text-xs text-destructive font-mono whitespace-pre-wrap break-all pb-2">
                {job.error_message}
              </pre>
            </CollapsibleSection>
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="flex items-center gap-2 px-4 py-3 border-t">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-xs font-medium border hover:bg-muted"
        >
          Close
        </button>
        {job.status === 'failed' && (
          <button
            onClick={handleRetry}
            disabled={retryJob.isPending}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {retryJob.isPending ? 'Retrying…' : 'Retry Job'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface AutomationJobPanelProps {
  /** 'new' to create a new job, otherwise a job UUID */
  jobId: string | null
  automationNodeId: string | null
  onClose: () => void
}

const READ_ONLY_STATUSES: AutomationJob['status'][] = ['completed', 'failed', 'cancelled']

export function AutomationJobPanel({
  jobId,
  automationNodeId,
  onClose,
}: AutomationJobPanelProps) {
  const isNew = jobId === 'new'
  const { data, isLoading } = useAutomationJob(isNew ? null : jobId)
  const job = data?.job ?? null

  if (!isNew && isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Loading…
      </div>
    )
  }

  if (!isNew && !job) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Job not found.
      </div>
    )
  }

  if (job && READ_ONLY_STATUSES.includes(job.status)) {
    return <ReadOnlyDetail job={job} onClose={onClose} />
  }

  return (
    <EditableForm
      job={isNew ? null : job}
      automationNodeId={automationNodeId}
      onClose={onClose}
    />
  )
}
