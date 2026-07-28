/**
 * AutomationJobsPanel.tsx — Center panel for the Automation workspace
 *
 * Tab switcher: Pending Jobs | Completed Jobs
 * Two different column sets depending on active tab.
 */

import * as React from 'react'
import { Plus } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { ScrollArea } from '../ui/ScrollArea'
import { useAutomationJobs } from '../../hooks/useAutomationJobs'
import { AutomationTemplatesPanel } from './AutomationTemplatesPanel'
import type { AutomationJob } from '../../lib/api'

interface AutomationJobsPanelProps {
  selectedNodeId: string | null
  selectedNodeTitle: string | null
  onJobSelect: (id: string) => void
  onNewJob: () => void
  isAdmin: boolean
}

// ── Status helpers ────────────────────────────────────────────────────────────

function PendingStatusBadge({ status }: { status: AutomationJob['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    queued:   { label: 'Queued',   cls: 'bg-muted text-muted-foreground' },
    running:  { label: 'Running',  cls: 'bg-blue-100 text-blue-700 animate-pulse' },
    paused:   { label: 'Paused',   cls: 'bg-amber-100 text-amber-700' },
    retrying: { label: 'Retrying', cls: 'bg-orange-100 text-orange-700' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground' }
  return (
    <span className={['inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', cls].join(' ')}>
      {label}
    </span>
  )
}

function CompletedStatusBadge({ status }: { status: AutomationJob['status'] }) {
  const map: Record<string, { label: string; variant: 'success' | 'destructive' | 'secondary' }> = {
    completed: { label: 'Completed', variant: 'success' },
    failed:    { label: 'Failed',    variant: 'destructive' },
    cancelled: { label: 'Cancelled', variant: 'secondary' },
  }
  const { label, variant } = map[status] ?? { label: status, variant: 'secondary' }
  return <Badge variant={variant}>{label}</Badge>
}

function PriorityBadge({ priority }: { priority: number }) {
  const map: Record<number, { label: string; cls: string }> = {
    1: { label: '1 Critical',   cls: 'text-red-600' },
    2: { label: '2 High',       cls: 'text-orange-500' },
    3: { label: '3 Normal',     cls: 'text-yellow-600' },
    4: { label: '4 Low',        cls: 'text-green-600' },
    5: { label: '5 Background', cls: 'text-gray-400' },
  }
  const { label, cls } = map[priority] ?? { label: String(priority), cls: '' }
  return <span className={['text-xs font-medium', cls].join(' ')}>{label}</span>
}

function formatRelative(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDuration(ms: number | null): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

// ── Pending grid ──────────────────────────────────────────────────────────────

function PendingJobsGrid({
  jobs,
  onJobSelect,
}: {
  jobs: AutomationJob[]
  onJobSelect: (id: string) => void
}) {
  if (jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No pending jobs.
      </div>
    )
  }
  return (
    <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
      <thead className="sticky top-0 bg-background z-10">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="text-left py-2 px-2 font-medium" style={{ width: 'auto' }}>Job Name</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '140px' }}>Node</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '110px' }}>Type</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '140px' }}>Prompt</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '100px' }}>Priority</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '130px' }}>Requested By</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '110px' }}>Status</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '65px' }}>Retries</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '100px' }}>Created</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map(job => (
          <tr
            key={job.id}
            className="border-b hover:bg-muted/50 cursor-pointer"
            onClick={() => onJobSelect(job.id)}
          >
            <td className="py-2 px-2 truncate font-medium">{job.name}</td>
            <td className="py-2 px-2 truncate text-xs text-muted-foreground">
              {job.automation_node_title ?? '—'}
            </td>
            <td className="py-2 px-2">
              <Badge variant="outline">{job.target_content_type}</Badge>
            </td>
            <td className="py-2 px-2 truncate text-xs text-muted-foreground">
              {job.prompt_name ?? '—'}
            </td>
            <td className="py-2 px-2">
              <PriorityBadge priority={job.priority} />
            </td>
            <td className="py-2 px-2 truncate text-xs text-muted-foreground">{job.requested_by}</td>
            <td className="py-2 px-2">
              <PendingStatusBadge status={job.status} />
            </td>
            <td className="py-2 px-2 text-xs text-muted-foreground">
              {job.retry_count}/{job.max_retries}
            </td>
            <td className="py-2 px-2 text-xs text-muted-foreground">
              {formatRelative(job.created_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ── Completed grid ────────────────────────────────────────────────────────────

function CompletedJobsGrid({
  jobs,
  onJobSelect,
}: {
  jobs: AutomationJob[]
  onJobSelect: (id: string) => void
}) {
  if (jobs.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
        No completed jobs.
      </div>
    )
  }
  return (
    <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
      <thead className="sticky top-0 bg-background z-10">
        <tr className="border-b text-xs text-muted-foreground">
          <th className="text-left py-2 px-2 font-medium" style={{ width: 'auto' }}>Job Name</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '110px' }}>Type</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '110px' }}>Status</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '120px' }}>Output</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '90px' }}>Duration</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '90px' }}>Tokens</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '70px' }}>Cost</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '70px' }}>Errors</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '100px' }}>Completed</th>
          <th className="text-left py-2 px-2 font-medium" style={{ width: '110px' }}>Run By</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map(job => {
          const totalTokens =
            (job.input_tokens ?? 0) + (job.output_tokens ?? 0)
          return (
            <tr
              key={job.id}
              className="border-b hover:bg-muted/50 cursor-pointer"
              onClick={() => onJobSelect(job.id)}
            >
              <td className="py-2 px-2 truncate font-medium">{job.name}</td>
              <td className="py-2 px-2">
                <Badge variant="outline">{job.target_content_type}</Badge>
              </td>
              <td className="py-2 px-2">
                <CompletedStatusBadge status={job.status} />
              </td>
              <td className="py-2 px-2 text-xs text-muted-foreground">
                {job.output_object_ids.length > 0
                  ? `${job.output_object_ids.length} articles`
                  : '—'}
              </td>
              <td className="py-2 px-2 text-xs text-muted-foreground">
                {formatDuration(job.duration_ms)}
              </td>
              <td className="py-2 px-2 text-xs text-muted-foreground">
                {totalTokens > 0 ? totalTokens.toLocaleString() : '—'}
              </td>
              <td className="py-2 px-2 text-xs text-muted-foreground">—</td>
              <td className="py-2 px-2">
                {job.error_message ? (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 font-medium">
                    Error
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
              <td className="py-2 px-2 text-xs text-muted-foreground">
                {formatRelative(job.completed_at)}
              </td>
              <td className="py-2 px-2 truncate text-xs text-muted-foreground">
                {job.identity_id ?? 'System'}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function AutomationJobsPanel({
  selectedNodeId,
  selectedNodeTitle,
  onJobSelect,
  onNewJob,
  isAdmin,
}: AutomationJobsPanelProps) {
  const [activeTab, setActiveTab] = React.useState<'pending' | 'completed' | 'templates'>('pending')

  const { data, isLoading } = useAutomationJobs(
    selectedNodeId,
    activeTab === 'pending' ? 'pending' : 'completed',
  )
  const jobs: AutomationJob[] = data?.jobs ?? []

  const title = selectedNodeTitle ? `Jobs — ${selectedNodeTitle}` : 'All Jobs'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b gap-4">
        <span className="text-sm font-semibold truncate">{title}</span>
        {activeTab !== 'templates' && (
          <button
            onClick={onNewJob}
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 shrink-0"
          >
            <Plus size={12} />
            New Job
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex border-b px-4">
        {(['pending', 'completed', 'templates'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'py-2 mr-4 text-xs font-medium border-b-2 -mb-px capitalize',
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {tab === 'pending' ? 'Pending Jobs' : tab === 'completed' ? 'Completed Jobs' : 'Templates'}
            {(tab === 'pending' || tab === 'completed') && activeTab === tab && data && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                {data.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'templates' ? (
        <AutomationTemplatesPanel isAdmin={isAdmin} selectedNodeId={selectedNodeId} />
      ) : (
        <ScrollArea className="flex-1">
          <div className="min-w-0">
            {isLoading ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                Loading…
              </div>
            ) : activeTab === 'pending' ? (
              <PendingJobsGrid jobs={jobs} onJobSelect={onJobSelect} />
            ) : (
              <CompletedJobsGrid jobs={jobs} onJobSelect={onJobSelect} />
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
