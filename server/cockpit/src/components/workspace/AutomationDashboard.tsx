/**
 * AutomationDashboard.tsx — Section 10: Root-level automation aggregate view
 *
 * Rendered in the center panel of AutomationWorkspace when no tree node is selected.
 * Shows:
 *   1. Filter bar (time window, user, content type, identity)
 *   2. Four summary stat cards (Pending, Running, Failed, Completed)
 *   3. Activity feed (audit log entries for automation_* events) with Load More
 */

import * as React from 'react'
import {
  ListTodo,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ChevronDown,
} from 'lucide-react'
import { Badge } from '../ui/Badge'
import { ScrollArea } from '../ui/ScrollArea'
import { useAutomationDashboard } from '../../hooks/useAutomationDashboard'
import type { DashboardTimeWindow, AutomationActivityEntry } from '../../lib/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function eventLabel(eventType: string): { label: string; cls: string } {
  const map: Record<string, { label: string; cls: string }> = {
    'automation_job.created':        { label: 'Created',         cls: 'text-blue-600' },
    'automation_job.run':            { label: 'Started',         cls: 'text-indigo-600' },
    'automation_job.completed':      { label: 'Completed',       cls: 'text-green-600' },
    'automation_job.failed':         { label: 'Failed',          cls: 'text-red-600' },
    'automation_job.retried':        { label: 'Retried',         cls: 'text-orange-600' },
    'automation_job.updated':        { label: 'Updated',         cls: 'text-muted-foreground' },
    'automation_template.created':   { label: 'Template created', cls: 'text-purple-600' },
    'automation_template.applied':   { label: 'Template applied', cls: 'text-purple-600' },
  }
  return map[eventType] ?? { label: eventType, cls: 'text-muted-foreground' }
}

// ── Summary card ──────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string
  value: number
  icon: React.ReactNode
  bgCls: string
  textCls: string
  pulse?: boolean
}

function StatCard({ label, value, icon, bgCls, textCls, pulse }: StatCardProps) {
  return (
    <div className={['rounded-lg border p-4 flex items-start gap-3', bgCls].join(' ')}>
      <div className={['mt-0.5 shrink-0', textCls, pulse ? 'animate-pulse' : ''].join(' ')}>
        {icon}
      </div>
      <div>
        <div className={['text-2xl font-bold tabular-nums', textCls].join(' ')}>
          {value.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  )
}

// ── Activity row ──────────────────────────────────────────────────────────────

function ActivityRow({ entry }: { entry: AutomationActivityEntry }) {
  const { label, cls } = eventLabel(entry.event_type)
  const jobRef = entry.job_name
    ? <span className="font-medium text-foreground">{entry.job_name}</span>
    : <span className="italic text-muted-foreground">{entry.target_id?.slice(0, 8) ?? '—'}</span>

  return (
    <tr className="border-b hover:bg-muted/30">
      <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
        {formatRelative(entry.created_at)}
      </td>
      <td className="py-2 px-3 text-xs">
        <span className={['font-medium', cls].join(' ')}>{label}</span>
      </td>
      <td className="py-2 px-3 text-xs max-w-[200px] truncate">{jobRef}</td>
      <td className="py-2 px-3 text-xs text-muted-foreground truncate">
        {entry.target_content_type
          ? <Badge variant="outline">{entry.target_content_type}</Badge>
          : '—'
        }
      </td>
      <td className="py-2 px-3 text-xs text-muted-foreground truncate">
        {entry.actor_id ?? '—'}
      </td>
      <td className="py-2 px-3 text-xs text-muted-foreground">
        {entry.identity_type === 'user' ? (entry.identity_id ?? 'User') : 'System'}
      </td>
    </tr>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const TIME_WINDOW_LABELS: Record<DashboardTimeWindow, string> = {
  '24h': 'Last 24 hours',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
}

export function AutomationDashboard() {
  const [timeWindow,      setTimeWindow]      = React.useState<DashboardTimeWindow>('7d')
  const [userFilter,      setUserFilter]      = React.useState('')
  const [contentType,     setContentType]     = React.useState('')
  const [identityFilter,  setIdentityFilter]  = React.useState('')
  const [activityOffset,  setActivityOffset]  = React.useState(0)
  const [allActivity,     setAllActivity]     = React.useState<AutomationActivityEntry[]>([])

  const params = {
    time_window:     timeWindow,
    user_filter:     userFilter     || undefined,
    content_type:    contentType    || undefined,
    identity_filter: identityFilter || undefined,
    activity_offset: activityOffset,
  }

  const { data, isLoading, isFetching, refetch } = useAutomationDashboard(params)

  // Accumulate activity entries for "Load More"
  React.useEffect(() => {
    if (!data) return
    if (activityOffset === 0) {
      setAllActivity(data.activity)
    } else {
      setAllActivity(prev => {
        const existingIds = new Set(prev.map(e => e.id))
        const newEntries = data.activity.filter(e => !existingIds.has(e.id))
        return [...prev, ...newEntries]
      })
    }
  }, [data, activityOffset])

  // Reset accumulated list when filters change
  React.useEffect(() => {
    setActivityOffset(0)
    setAllActivity([])
  }, [timeWindow, userFilter, contentType, identityFilter])

  const summary     = data?.summary
  const filterOpts  = data?.filter_options ?? { users: [], content_types: [] }
  const totalEvents = data?.total ?? 0
  const hasMore     = allActivity.length < totalEvents

  function handleLoadMore() {
    setActivityOffset(allActivity.length)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <span className="text-sm font-semibold">Automation Overview</span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          title="Refresh dashboard"
        >
          <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          <span className="sr-only">Refresh</span>
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-4 py-4 space-y-5">

          {/* Filter bar */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Time window */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground shrink-0">Period:</label>
              <select
                className="rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={timeWindow}
                onChange={e => setTimeWindow(e.target.value as DashboardTimeWindow)}
              >
                {(Object.keys(TIME_WINDOW_LABELS) as DashboardTimeWindow[]).map(k => (
                  <option key={k} value={k}>{TIME_WINDOW_LABELS[k]}</option>
                ))}
              </select>
            </div>

            {/* User filter */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground shrink-0">User:</label>
              <select
                className="rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary max-w-[180px]"
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
              >
                <option value="">All users</option>
                {filterOpts.users.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            {/* Content type filter */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground shrink-0">Type:</label>
              <select
                className="rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={contentType}
                onChange={e => setContentType(e.target.value)}
              >
                <option value="">All types</option>
                {filterOpts.content_types.map(ct => (
                  <option key={ct} value={ct}>{ct}</option>
                ))}
              </select>
            </div>

            {/* Identity filter */}
            <div className="flex items-center gap-1">
              <label className="text-xs text-muted-foreground shrink-0">Identity:</label>
              <select
                className="rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                value={identityFilter}
                onChange={e => setIdentityFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="system">System</option>
                <option value="user">User</option>
              </select>
            </div>
          </div>

          {/* Summary cards */}
          {isLoading && !summary ? (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Pending (queued + paused)"
                value={summary?.pending ?? 0}
                icon={<ListTodo size={20} />}
                bgCls="bg-amber-50 border-amber-200"
                textCls="text-amber-700"
              />
              <StatCard
                label="Running"
                value={summary?.running ?? 0}
                icon={<Loader2 size={20} />}
                bgCls="bg-blue-50 border-blue-200"
                textCls="text-blue-700"
                pulse={Boolean(summary?.running)}
              />
              <StatCard
                label={`Failed (${TIME_WINDOW_LABELS[timeWindow]})`}
                value={summary?.failed_period ?? 0}
                icon={<AlertTriangle size={20} />}
                bgCls="bg-red-50 border-red-200"
                textCls="text-red-700"
              />
              <StatCard
                label={`Completed (${TIME_WINDOW_LABELS[timeWindow]})`}
                value={summary?.completed_period ?? 0}
                icon={<CheckCircle2 size={20} />}
                bgCls="bg-green-50 border-green-200"
                textCls="text-green-700"
              />
            </div>
          )}

          {/* Activity feed */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold">Activity Feed</h2>
              <span className="text-xs text-muted-foreground">
                {totalEvents > 0 ? `${allActivity.length} of ${totalEvents}` : ''}
              </span>
            </div>

            {isLoading && allActivity.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
                Loading activity…
              </div>
            ) : allActivity.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-muted-foreground border rounded-md">
                No automation activity in the selected period.
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <thead className="bg-muted/40">
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="text-left py-2 px-3 font-medium" style={{ width: '90px' }}>When</th>
                      <th className="text-left py-2 px-3 font-medium" style={{ width: '120px' }}>Action</th>
                      <th className="text-left py-2 px-3 font-medium" style={{ width: 'auto' }}>Job</th>
                      <th className="text-left py-2 px-3 font-medium" style={{ width: '110px' }}>Type</th>
                      <th className="text-left py-2 px-3 font-medium" style={{ width: '150px' }}>Actor</th>
                      <th className="text-left py-2 px-3 font-medium" style={{ width: '80px' }}>Identity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allActivity.map(entry => (
                      <ActivityRow key={entry.id} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {hasMore && (
              <div className="mt-3 flex justify-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isFetching}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs border hover:bg-muted disabled:opacity-50"
                >
                  <ChevronDown size={12} />
                  {isFetching ? 'Loading…' : `Load More (${totalEvents - allActivity.length} remaining)`}
                </button>
              </div>
            )}
          </div>

        </div>
      </ScrollArea>
    </div>
  )
}
