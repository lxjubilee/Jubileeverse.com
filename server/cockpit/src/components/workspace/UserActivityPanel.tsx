/**
 * UserActivityPanel.tsx — Part 3 Section 8 center panel
 *
 * Two-tab view for a selected CMS user:
 *   - Sessions tab: login/logout history with revoke action
 *   - Activity tab: audit log events with summary cards + filters + CSV export
 */

import * as React from 'react'
import { UserCheck, ChevronLeft, ChevronRight, X } from 'lucide-react'
import {
  useUserSessions,
  useUserActivity,
  useUserActivitySummary,
  useRevokeUserSession,
} from '../../hooks/useUsers'
import type { UserSessionRecord, AuditLogEntry } from '../../types/content-objects'

interface UserActivityPanelProps {
  userId:    number | null
  userEmail: string | null
  isAdmin:   boolean
}

type Tab = 'sessions' | 'activity'
type TimeRange = '24h' | '7d' | '30d' | '90d'

// ── helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function formatDuration(secs: number | null): string {
  if (!secs) return '—'
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

function parseDevice(raw: string | null): string {
  if (!raw) return '—'
  try {
    const d = JSON.parse(raw)
    return [d.browser, d.os].filter(Boolean).join(' / ')
  } catch { return raw }
}

// ── Sessions tab ──────────────────────────────────────────────────────────────

function SessionsTab({ userId, isAdmin }: { userId: number; isAdmin: boolean }) {
  const [offset, setOffset] = React.useState(0)
  const limit = 50
  const { data, isLoading, refetch } = useUserSessions(userId, { limit, offset })
  const revokeSession = useRevokeUserSession()

  const sessions = data?.sessions ?? []
  const total    = data?.total ?? 0
  const pages    = Math.ceil(total / limit)
  const page     = Math.floor(offset / limit) + 1

  async function handleRevoke(s: UserSessionRecord) {
    if (!window.confirm('Revoke this session?')) return
    await revokeSession.mutateAsync({ userId, sessionId: s.id })
    refetch()
  }

  if (isLoading) return <div className="p-4 text-xs text-muted-foreground">Loading sessions…</div>
  if (sessions.length === 0) return <div className="p-4 text-xs text-muted-foreground">No sessions recorded.</div>

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-muted/50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Login</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Logout</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Duration</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">IP</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Device</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">Auth</th>
              <th className="text-left px-3 py-1.5 font-medium text-muted-foreground whitespace-nowrap">MFA</th>
              {isAdmin && <th className="px-2" />}
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => {
              const isActive = !s.logout_at && !s.revoked_at
              return (
                <tr
                  key={s.id}
                  className={`border-b hover:bg-accent/30 ${isActive ? 'border-l-2 border-l-blue-400' : ''}`}
                >
                  <td className="px-3 py-1.5 whitespace-nowrap" title={s.login_at}>
                    {relativeTime(s.login_at)}
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    {s.revoked_at
                      ? <span className="text-destructive text-[10px] font-medium">Revoked</span>
                      : s.logout_at
                        ? <span title={s.logout_at}>{relativeTime(s.logout_at)}</span>
                        : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-300">Active</span>
                    }
                  </td>
                  <td className="px-3 py-1.5">{formatDuration(s.duration_seconds)}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px]">{s.ip_address || '—'}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap">{parseDevice(s.device_parsed)}</td>
                  <td className="px-3 py-1.5">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      {s.auth_method}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">{s.mfa_satisfied ? '✓' : '✗'}</td>
                  {isAdmin && (
                    <td className="px-2 py-1.5">
                      {isActive && (
                        <button
                          className="text-muted-foreground hover:text-destructive"
                          title="Revoke session"
                          onClick={() => handleRevoke(s)}
                          disabled={revokeSession.isPending}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="flex items-center gap-2 px-3 py-2 border-t text-xs text-muted-foreground shrink-0">
          <button disabled={page <= 1} onClick={() => setOffset(o => o - limit)} className="disabled:opacity-40">
            <ChevronLeft size={14} />
          </button>
          <span>Page {page} of {pages} ({total} total)</span>
          <button disabled={page >= pages} onClick={() => setOffset(o => o + limit)} className="disabled:opacity-40">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Activity tab ──────────────────────────────────────────────────────────────

const SUMMARY_LABELS: { key: string; label: string }[] = [
  { key: 'content_created',    label: 'Content Created' },
  { key: 'content_edited',     label: 'Content Edited' },
  { key: 'reviews_performed',  label: 'Reviews' },
  { key: 'publish_actions',    label: 'Publishes' },
  { key: 'automation_jobs',    label: 'Automation Jobs' },
  { key: 'prompts_referenced', label: 'Prompts Used' },
]

function ActivityTab({ userId, isAdmin }: { userId: number; isAdmin: boolean }) {
  const [timeRange, setTimeRange]   = React.useState<TimeRange>('30d')
  const [eventType, setEventType]   = React.useState('')
  const [objectType, setObjectType] = React.useState('')
  const [offset, setOffset]         = React.useState(0)
  const limit = 50

  const filters: Record<string, string | number> = { time_range: timeRange, limit, offset }
  if (eventType)  filters.event_type  = eventType
  if (objectType) filters.object_type = objectType

  const { data: summaryData } = useUserActivitySummary(userId, timeRange)
  const { data: activityData, isLoading } = useUserActivity(userId, filters)

  const items = activityData?.items ?? []
  const total = activityData?.total ?? 0
  const pages = Math.ceil(total / limit)
  const page  = Math.floor(offset / limit) + 1

  function handleExport() {
    const params = new URLSearchParams({ time_range: timeRange })
    if (eventType)  params.set('event_type', eventType)
    if (objectType) params.set('object_type', objectType)
    window.open(`/api/admin/users/${userId}/activity/export?${params}`)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Summary cards */}
      {summaryData && (
        <div className="grid grid-cols-3 gap-2 px-3 py-2 border-b shrink-0">
          {SUMMARY_LABELS.map(({ key, label }) => (
            <div key={key} className="rounded border bg-muted/30 px-2 py-1.5 text-center">
              <div className="text-lg font-bold leading-tight">
                {(summaryData as unknown as Record<string, number>)[key] ?? 0}
              </div>
              <div className="text-[9px] text-muted-foreground leading-tight">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b shrink-0 flex-wrap">
        <select
          className="text-xs border rounded px-1 py-0.5 bg-background"
          value={timeRange}
          onChange={e => { setTimeRange(e.target.value as TimeRange); setOffset(0) }}
        >
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
        <input
          className="text-xs border rounded px-1 py-0.5 bg-background w-28"
          placeholder="Event type…"
          value={eventType}
          onChange={e => { setEventType(e.target.value); setOffset(0) }}
        />
        <input
          className="text-xs border rounded px-1 py-0.5 bg-background w-28"
          placeholder="Object type…"
          value={objectType}
          onChange={e => { setObjectType(e.target.value); setOffset(0) }}
        />
        {isAdmin && (
          <button
            className="ml-auto text-xs px-2 py-0.5 rounded border bg-background hover:bg-accent"
            onClick={handleExport}
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto">
        {isLoading && <div className="p-4 text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && items.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground">No activity in this time range.</div>
        )}
        {items.length > 0 && (
          <table className="w-full text-xs border-collapse">
            <thead className="bg-muted/50 sticky top-0">
              <tr>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Time</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Action</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Target Type</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Target ID</th>
                <th className="text-left px-3 py-1.5 font-medium text-muted-foreground">Details</th>
              </tr>
            </thead>
            <tbody>
              {(items as AuditLogEntry[]).map((item, i) => (
                <tr key={i} className="border-b hover:bg-accent/30">
                  <td className="px-3 py-1.5 whitespace-nowrap" title={item.created_at}>
                    {relativeTime(item.created_at)}
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border">
                      {item.event_type}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">{item.target_type ?? '—'}</td>
                  <td className="px-3 py-1.5 font-mono text-[10px] max-w-[120px] truncate" title={item.target_id ?? ''}>
                    {item.target_id ?? '—'}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground max-w-[200px] truncate">
                    {item.details ? JSON.stringify(item.details).slice(0, 80) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center gap-2 px-3 py-2 border-t text-xs text-muted-foreground shrink-0">
          <button disabled={page <= 1} onClick={() => setOffset(o => o - limit)} className="disabled:opacity-40">
            <ChevronLeft size={14} />
          </button>
          <span>Page {page} of {pages} ({total} total)</span>
          <button disabled={page >= pages} onClick={() => setOffset(o => o + limit)} className="disabled:opacity-40">
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function UserActivityPanel({ userId, userEmail, isAdmin }: UserActivityPanelProps) {
  const [activeTab, setActiveTab] = React.useState<Tab>('sessions')

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <UserCheck size={32} className="opacity-30" />
        <p className="text-sm">Select a user to view their account data</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b px-3 shrink-0">
        {(['sessions', 'activity'] as Tab[]).map(tab => (
          <button
            key={tab}
            className={`px-3 py-2 text-xs font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
        {userEmail && (
          <span className="ml-auto text-[10px] text-muted-foreground pr-1">{userEmail}</span>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'sessions' && <SessionsTab userId={userId} isAdmin={isAdmin} />}
        {activeTab === 'activity' && <ActivityTab userId={userId} isAdmin={isAdmin} />}
      </div>
    </div>
  )
}
